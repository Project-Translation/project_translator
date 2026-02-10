package fileprocessor

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/project-translator/go-translator/internal/config"
	"github.com/project-translator/go-translator/internal/globmatch"
	"github.com/project-translator/go-translator/internal/segmentation"
	"github.com/project-translator/go-translator/internal/translationdb"
	"github.com/project-translator/go-translator/internal/translator"
)

type decisionEntry struct {
	shouldTranslate bool
	timestamp       time.Time
}

type Stats struct {
	Processed   int
	Skipped     int
	Failed      int
	FailedPaths []string
}

type Processor struct {
	cfg *config.Config
	db  *translationdb.TranslationDatabase
	tr  *translator.Translator

	workspaceRoot    string
	diffSystemPrompt string

	decisionCache    map[string]decisionEntry
	decisionCacheTtl time.Duration
	noTranslateCache map[string]bool

	stats Stats
}

func New(cfg *config.Config, db *translationdb.TranslationDatabase, tr *translator.Translator) *Processor {
	root := ""
	if cfg != nil && strings.TrimSpace(cfg.WorkspaceRoot) != "" {
		root = cfg.WorkspaceRoot
	} else if db != nil && strings.TrimSpace(db.WorkspaceRoot()) != "" {
		root = db.WorkspaceRoot()
	} else if wd, err := os.Getwd(); err == nil {
		root = wd
	}

	diffPrompt := ""
	if dir, ok := config.ResolvePromptsDir(root); ok {
		lang := "en"
		if cfg != nil && strings.TrimSpace(cfg.SystemPromptLanguage) != "" {
			lang = cfg.SystemPromptLanguage
		}
		if s, err := config.LoadDiffSystemPromptWithLanguage(dir, lang); err == nil {
			diffPrompt = s
		}
	}

	return &Processor{
		cfg:              cfg,
		db:               db,
		tr:               tr,
		workspaceRoot:    root,
		diffSystemPrompt: diffPrompt,
		decisionCache:    map[string]decisionEntry{},
		decisionCacheTtl: 5 * time.Minute,
		noTranslateCache: map[string]bool{},
		stats:            Stats{FailedPaths: []string{}},
	}
}

func (p *Processor) Stats() Stats {
	return p.stats
}

func (p *Processor) resolvePath(maybeRelative string) string {
	s := strings.TrimSpace(maybeRelative)
	if s == "" || s == "." {
		return p.workspaceRoot
	}
	if filepath.IsAbs(s) {
		return s
	}
	return filepath.Join(p.workspaceRoot, s)
}

func (p *Processor) decisionCacheKey(sourcePath string, targetPath string, targetLang string) string {
	norm := func(v string) string {
		v = filepath.Clean(v)
		return filepath.ToSlash(v)
	}
	return norm(sourcePath) + "::" + norm(targetPath) + "::" + strings.TrimSpace(targetLang)
}

func (p *Processor) shouldSkipByDecision(sourcePath string, targetPath string, targetLang string) (bool, error) {
	if p.cfg == nil || p.db == nil {
		return false, nil
	}

	key := p.decisionCacheKey(sourcePath, targetPath, targetLang)
	if p.noTranslateCache[key] {
		p.stats.Skipped++
		return true, nil
	}

	if entry, ok := p.decisionCache[key]; ok {
		if time.Since(entry.timestamp) < p.decisionCacheTtl {
			if !entry.shouldTranslate {
				p.noTranslateCache[key] = true
				p.stats.Skipped++
				return true, nil
			}
			return false, nil
		}
	}

	shouldTranslate, err := p.db.ShouldTranslate(sourcePath, targetPath, targetLang, p.cfg.TranslationIntervalDays)
	if err != nil {
		// Fail open (translate) if decision errors
		p.decisionCache[key] = decisionEntry{shouldTranslate: true, timestamp: time.Now()}
		return false, nil
	}

	p.decisionCache[key] = decisionEntry{shouldTranslate: shouldTranslate, timestamp: time.Now()}
	if !shouldTranslate {
		p.noTranslateCache[key] = true
		p.stats.Skipped++
		return true, nil
	}
	return false, nil
}

func (p *Processor) relToWorkspace(absPath string) string {
	rel, err := filepath.Rel(p.workspaceRoot, absPath)
	if err != nil {
		return filepath.ToSlash(absPath)
	}
	return filepath.ToSlash(rel)
}

func (p *Processor) matchAny(patterns []string, relPath string) bool {
	for _, pat := range patterns {
		if globmatch.Match(pat, relPath) {
			return true
		}
	}
	return false
}

func (p *Processor) shouldIgnore(absSourcePath string) bool {
	if p.cfg == nil {
		return false
	}
	rel := p.relToWorkspace(absSourcePath)
	if p.matchAny(p.cfg.Ignore.Paths, rel) {
		return true
	}
	ext := strings.ToLower(filepath.Ext(absSourcePath))
	for _, e := range p.cfg.Ignore.Extensions {
		if strings.ToLower(e) == ext {
			return true
		}
	}
	return false
}

func (p *Processor) shouldCopyOnly(absSourcePath string) bool {
	if p.cfg == nil {
		return false
	}
	rel := p.relToWorkspace(absSourcePath)
	if p.matchAny(p.cfg.CopyOnly.Paths, rel) {
		return true
	}
	ext := strings.ToLower(filepath.Ext(absSourcePath))
	for _, e := range p.cfg.CopyOnly.Extensions {
		if strings.ToLower(e) == ext {
			return true
		}
	}
	return false
}

func isBinaryFile(absPath string) (bool, error) {
	f, err := os.Open(absPath)
	if err != nil {
		return false, err
	}
	defer f.Close()

	buf := make([]byte, 8000)
	n, err := f.Read(buf)
	if err != nil && err != io.EOF {
		return false, err
	}
	sample := buf[:n]
	if bytes.IndexByte(sample, 0) >= 0 {
		return true, nil
	}
	if !utf8.Valid(sample) {
		return true, nil
	}
	return false, nil
}

func (p *Processor) copyFileIfDifferent(absSourcePath string, absTargetPath string) (bool, error) {
	// Ensure target dir exists
	if err := os.MkdirAll(filepath.Dir(absTargetPath), 0755); err != nil {
		return false, err
	}

	// If target exists, avoid rewriting identical content
	if st, err := os.Stat(absTargetPath); err == nil && st.Mode().IsRegular() {
		srcBytes, err1 := os.ReadFile(absSourcePath)
		if err1 != nil {
			return false, err1
		}
		dstBytes, err2 := os.ReadFile(absTargetPath)
		if err2 != nil {
			return false, err2
		}
		if bytes.Equal(srcBytes, dstBytes) {
			return false, nil
		}
	}

	data, err := os.ReadFile(absSourcePath)
	if err != nil {
		return false, err
	}
	if err := os.WriteFile(absTargetPath, data, 0644); err != nil {
		return false, err
	}
	return true, nil
}

func (p *Processor) shouldSkipByFrontMatter(absSourcePath string) (bool, error) {
	if p.cfg == nil || !p.cfg.SkipFrontMatter.Enabled {
		return false, nil
	}
	ext := strings.ToLower(filepath.Ext(absSourcePath))
	if ext != ".md" && ext != ".markdown" {
		return false, nil
	}

	data, err := os.ReadFile(absSourcePath)
	if err != nil {
		return false, err
	}
	content := string(data)
	if !strings.HasPrefix(content, "---") {
		return false, nil
	}

	frontMatterEnd := strings.Index(content[3:], "---")
	if frontMatterEnd == -1 {
		return false, nil
	}
	frontMatterEnd += 3
	frontMatter := strings.TrimSpace(content[3:frontMatterEnd])
	lines := strings.Split(frontMatter, "\n")
	kv := map[string]string{}
	for _, line := range lines {
		colon := strings.Index(line, ":")
		if colon <= 0 {
			continue
		}
		k := strings.TrimSpace(line[:colon])
		v := strings.TrimSpace(line[colon+1:])
		v = strings.Trim(v, `"'`)
		if k != "" {
			kv[k] = v
		}
	}

	for _, m := range p.cfg.SkipFrontMatter.Markers {
		if kv[m.Key] == m.Value {
			return true, nil
		}
	}
	return false, nil
}

func (p *Processor) ProcessFile(sourcePath string, targetPath string, sourceLang string, targetLang string) error {
	absSource := p.resolvePath(sourcePath)
	absTarget := p.resolvePath(targetPath)

	st, err := os.Stat(absSource)
	if err != nil || !st.Mode().IsRegular() {
		return fmt.Errorf("源文件不存在或不可读: %s", sourcePath)
	}

	// Ensure target dir exists
	if err := os.MkdirAll(filepath.Dir(absTarget), 0755); err != nil {
		return err
	}

	// Skip unchanged files early
	if skip, err := p.shouldSkipByDecision(absSource, absTarget, targetLang); err != nil {
		return err
	} else if skip {
		return nil
	}

	// Front matter skip (copy)
	if skipFM, err := p.shouldSkipByFrontMatter(absSource); err != nil {
		return err
	} else if skipFM {
		copied, err := p.copyFileIfDifferent(absSource, absTarget)
		if err != nil {
			return err
		}
		if copied {
			p.stats.Processed++
		} else {
			p.stats.Skipped++
		}
		return nil
	}

	// Ignore
	if p.shouldIgnore(absSource) {
		p.stats.Skipped++
		return nil
	}

	// Copy-only
	if p.shouldCopyOnly(absSource) {
		copied, err := p.copyFileIfDifferent(absSource, absTarget)
		if err != nil {
			return err
		}
		if copied {
			p.stats.Processed++
		} else {
			p.stats.Skipped++
		}
		return nil
	}

	// Binary
	isBin, err := isBinaryFile(absSource)
	if err != nil {
		return err
	}
	if isBin {
		// Always copy binary files
		data, err := os.ReadFile(absSource)
		if err != nil {
			return err
		}
		if err := os.WriteFile(absTarget, data, 0644); err != nil {
			return err
		}
		p.stats.Processed++
		return nil
	}

	// Text translation
	if p.tr == nil || p.cfg == nil || p.db == nil {
		return fmt.Errorf("翻译器未初始化")
	}

	data, err := os.ReadFile(absSource)
	if err != nil {
		return err
	}
	if !utf8.Valid(data) {
		// Treat invalid UTF-8 as binary-ish and copy
		if err := os.WriteFile(absTarget, data, 0644); err != nil {
			return err
		}
		p.stats.Processed++
		return nil
	}

	content := string(data)

	maxTokens := 4096
	if vendor, err := p.cfg.GetCurrentVendor(); err == nil && vendor != nil {
		if vendor.MaxTokensPerSegment > 0 {
			maxTokens = vendor.MaxTokensPerSegment
		}
	}
	estimated := segmentation.EstimateTokenCount(content)

	// Diff-apply (experimental): if enabled and target exists, try minimal edits first
	if p.cfg.DiffApply.Enabled && strings.TrimSpace(p.diffSystemPrompt) != "" {
		if st, err := os.Stat(absTarget); err == nil && st.Mode().IsRegular() {
			targetBytes, err := os.ReadFile(absTarget)
			if err == nil && utf8.Valid(targetBytes) {
				targetText := string(targetBytes)
				diff, err := p.tr.GenerateDiffJSON(content, targetText, sourcePath, sourceLang, targetLang, p.diffSystemPrompt)
				if err == nil && diff != nil {
					updated, appliedCount, ok := applyJSONDiff(targetText, diff)
					if ok && appliedCount > 0 {
						if p.cfg.DiffApply.AutoBackup {
							ts := time.Now().UTC().Format("20060102150405")
							backupPath := absTarget + ".bak." + ts
							_, _ = p.copyFileIfDifferent(absTarget, backupPath)
						}
						if err := os.WriteFile(absTarget, []byte(updated), 0644); err == nil {
							_ = p.db.UpdateTranslationTime(absSource, targetLang)
							p.stats.Processed++
							return nil
						}
					}
					if ok && appliedCount == 0 && !diff.HasChanges {
						// In sync; update record to avoid repeated work
						_ = p.db.UpdateTranslationTime(absSource, targetLang)
						p.stats.Skipped++
						return nil
					}
				}
				// Fallback to full translation on any diff failure
			}
		}
	}

	translated := ""
	returnCode := translator.ReturnCodeOK

	if estimated > maxTokens {
		segments := segmentation.SegmentText(content, absSource, maxTokens, p.cfg.SegmentationMarkers)
		outSegs := make([]string, 0, len(segments))
		for i, seg := range segments {
			res, err := p.tr.TranslateContent(seg, sourceLang, targetLang, i == 0, nil)
			if err != nil {
				return err
			}
			if res.ReturnCode == translator.ReturnCodeNoNeedTranslate {
				// Keep original segment
				outSegs = append(outSegs, seg)
				continue
			}
			outSegs = append(outSegs, res.Content)
		}
		translated = segmentation.CombineSegments(outSegs)
	} else {
		res, err := p.tr.TranslateContent(content, sourceLang, targetLang, true, nil)
		if err != nil {
			return err
		}
		returnCode = res.ReturnCode
		translated = res.Content
	}

	// NO_NEED_TRANSLATE: copy original and mark session cache
	if returnCode == translator.ReturnCodeNoNeedTranslate {
		_, err := p.copyFileIfDifferent(absSource, absTarget)
		if err != nil {
			return err
		}
		_ = p.db.UpdateTranslationTime(absSource, targetLang)
		key := p.decisionCacheKey(absSource, absTarget, targetLang)
		p.noTranslateCache[key] = true
		p.decisionCache[key] = decisionEntry{shouldTranslate: false, timestamp: time.Now()}
		p.stats.Processed++
		return nil
	}

	// Write result
	if err := os.WriteFile(absTarget, []byte(translated), 0644); err != nil {
		return err
	}

	if translated != content {
		_ = p.db.UpdateTranslationTime(absSource, targetLang)
	}

	p.stats.Processed++
	return nil
}

func indexOfLineStart(text string, lineNumber int) int {
	if lineNumber <= 1 {
		return 0
	}
	if lineNumber < 1 {
		return -1
	}
	line := 1
	for i := 0; i < len(text); i++ {
		if text[i] == '\n' {
			line++
			if line == lineNumber {
				return i + 1
			}
		}
	}
	return -1
}

func applyJSONDiff(targetText string, diff *translator.JSONDiffResult) (updated string, appliedCount int, ok bool) {
	if diff == nil || len(diff.Changes) == 0 {
		return targetText, 0, true
	}
	text := targetText
	allApplied := true
	applied := 0

	for _, ch := range diff.Changes {
		search := ch.Search
		replace := ch.Replace
		if search == "" {
			allApplied = false
			continue
		}

		start := indexOfLineStart(text, ch.StartLine)
		if start >= 0 && strings.HasPrefix(text[start:], search) {
			text = text[:start] + replace + text[start+len(search):]
			applied++
			continue
		}

		if idx := strings.Index(text, search); idx >= 0 {
			text = text[:idx] + replace + text[idx+len(search):]
			applied++
			continue
		}

		allApplied = false
	}

	return text, applied, allApplied
}
