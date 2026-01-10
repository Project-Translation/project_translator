package translationdb

import (
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Any non-empty language code shorter than 10 chars is considered valid,
// matching the VSCode extension behavior.
func IsValidLanguage(lang string) bool {
	return len(lang) > 0 && len(lang) < 10
}

type TranslationFileInfo struct {
	TranslateDatetime string `json:"translate_datetime"`
	SrcHash           string `json:"src_hash"`
	SrcSize           *int64 `json:"src_size,omitempty"`
	SrcMtimeMs        *int64 `json:"src_mtime_ms,omitempty"`
}

type TranslationRecord map[string]TranslationFileInfo // relativeSourcePath -> info

type cachedSourceInfo struct {
	size      int64
	mtimeMs   int64
	hash      string
	checkedAt time.Time
}

type TranslationDatabase struct {
	workspaceRoot string
	cacheDir      string

	mu    sync.Mutex
	cache map[string]TranslationRecord // lang -> record

	sourceInfoCache    map[string]cachedSourceInfo // absolute source path -> info
	sourceInfoCacheTtl time.Duration
}

func New(workspaceRoot string) (*TranslationDatabase, error) {
	root := strings.TrimSpace(workspaceRoot)
	if root == "" {
		wd, err := os.Getwd()
		if err != nil {
			return nil, fmt.Errorf("获取工作目录失败: %w", err)
		}
		root = wd
	}

	cacheDir := filepath.Join(root, ".translation-cache")
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		return nil, fmt.Errorf("创建缓存目录失败: %w", err)
	}

	return &TranslationDatabase{
		workspaceRoot:      root,
		cacheDir:           cacheDir,
		cache:              map[string]TranslationRecord{},
		sourceInfoCache:    map[string]cachedSourceInfo{},
		sourceInfoCacheTtl: 2 * time.Second,
	}, nil
}

func (db *TranslationDatabase) WorkspaceRoot() string {
	return db.workspaceRoot
}

func sanitizeLanguageForFileName(lang string) string {
	var b strings.Builder
	for _, r := range lang {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			b.WriteRune(r)
			continue
		}
		b.WriteRune('_')
	}
	return b.String()
}

func (db *TranslationDatabase) cacheFilePath(lang string) string {
	safe := sanitizeLanguageForFileName(lang)
	return filepath.Join(db.cacheDir, fmt.Sprintf("translations_%s.json", safe))
}

func (db *TranslationDatabase) ensureLanguageLoaded(lang string) error {
	if !IsValidLanguage(lang) {
		return fmt.Errorf("无效语言代码: %s", lang)
	}

	db.mu.Lock()
	_, exists := db.cache[lang]
	db.mu.Unlock()
	if exists {
		return nil
	}

	p := db.cacheFilePath(lang)
	data, err := os.ReadFile(p)
	if err != nil {
		if os.IsNotExist(err) {
			db.mu.Lock()
			db.cache[lang] = TranslationRecord{}
			db.mu.Unlock()
			return db.saveLanguage(lang)
		}
		return fmt.Errorf("读取缓存文件失败: %w", err)
	}

	rec := TranslationRecord{}
	if len(strings.TrimSpace(string(data))) > 0 {
		if err := json.Unmarshal(data, &rec); err != nil {
			// Backward compatibility: if file is corrupted, treat as empty
			rec = TranslationRecord{}
		}
	}

	db.mu.Lock()
	db.cache[lang] = rec
	db.mu.Unlock()
	return nil
}

func (db *TranslationDatabase) saveLanguage(lang string) error {
	db.mu.Lock()
	rec, ok := db.cache[lang]
	db.mu.Unlock()
	if !ok {
		return nil
	}

	data, err := json.MarshalIndent(rec, "", "  ")
	if err != nil {
		return fmt.Errorf("编码缓存失败: %w", err)
	}

	p := db.cacheFilePath(lang)
	if err := os.WriteFile(p, data, 0644); err != nil {
		return fmt.Errorf("写入缓存文件失败: %w", err)
	}
	return nil
}

func (db *TranslationDatabase) relativeToWorkspace(absPath string) string {
	rel, err := filepath.Rel(db.workspaceRoot, absPath)
	if err != nil {
		return filepath.ToSlash(absPath)
	}
	return filepath.ToSlash(rel)
}

func (db *TranslationDatabase) formatDateTime(t time.Time) string {
	// Match extension format: yyyy-MM-dd:hh:mm
	return t.Format("2006-01-02:15:04")
}

func (db *TranslationDatabase) getCurrentSourceStat(absSourcePath string) (size int64, mtimeMs int64, err error) {
	now := time.Now()
	db.mu.Lock()
	cached, ok := db.sourceInfoCache[absSourcePath]
	db.mu.Unlock()
	if ok && now.Sub(cached.checkedAt) < db.sourceInfoCacheTtl {
		return cached.size, cached.mtimeMs, nil
	}

	st, err := os.Stat(absSourcePath)
	if err != nil {
		return 0, 0, err
	}
	size = st.Size()
	mtimeMs = st.ModTime().UnixNano() / int64(time.Millisecond)

	db.mu.Lock()
	prev := db.sourceInfoCache[absSourcePath]
	db.sourceInfoCache[absSourcePath] = cachedSourceInfo{
		size:      size,
		mtimeMs:   mtimeMs,
		hash:      prev.hash,
		checkedAt: now,
	}
	db.mu.Unlock()
	return size, mtimeMs, nil
}

func (db *TranslationDatabase) calculateFileHash(absPath string) (string, error) {
	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}
	sum := md5.Sum(data)
	return hex.EncodeToString(sum[:]), nil
}

func (db *TranslationDatabase) getSourceHashForStat(absSourcePath string, size int64, mtimeMs int64) (string, error) {
	db.mu.Lock()
	cached, ok := db.sourceInfoCache[absSourcePath]
	db.mu.Unlock()
	if ok && cached.hash != "" && cached.size == size && cached.mtimeMs == mtimeMs {
		return cached.hash, nil
	}

	h, err := db.calculateFileHash(absSourcePath)
	if err != nil {
		return "", err
	}

	db.mu.Lock()
	db.sourceInfoCache[absSourcePath] = cachedSourceInfo{
		size:      size,
		mtimeMs:   mtimeMs,
		hash:      h,
		checkedAt: time.Now(),
	}
	db.mu.Unlock()
	return h, nil
}

func parseTranslateDatetime(s string) (time.Time, bool) {
	if strings.TrimSpace(s) == "" {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation("2006-01-02:15:04", s, time.Local)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// ShouldTranslate replicates the extension logic:
// - translate if target doesn't exist
// - translate if past interval (intervalDays > 0)
// - translate if src_hash changed (fast-path using src_size/src_mtime_ms)
func (db *TranslationDatabase) ShouldTranslate(
	sourcePath string,
	targetPath string,
	targetLang string,
	intervalDays int,
) (bool, error) {
	absSource, err := filepath.Abs(sourcePath)
	if err != nil {
		absSource = sourcePath
	}
	absTarget, err := filepath.Abs(targetPath)
	if err != nil {
		absTarget = targetPath
	}

	// Always translate if target file doesn't exist
	if st, err := os.Stat(absTarget); err != nil || !st.Mode().IsRegular() {
		return true, nil
	}

	if err := db.ensureLanguageLoaded(targetLang); err != nil {
		return true, err
	}

	relSource := db.relativeToWorkspace(absSource)

	db.mu.Lock()
	rec := db.cache[targetLang]
	info, exists := rec[relSource]
	db.mu.Unlock()

	if !exists {
		return true, nil
	}

	// Interval check (days)
	if intervalDays > 0 {
		lastT, ok := parseTranslateDatetime(info.TranslateDatetime)
		if !ok {
			// Match extension behavior: parse failure -> treat as very old
			return true, nil
		}
		daysSince := time.Since(lastT).Hours() / 24
		if daysSince >= float64(intervalDays) {
			return true, nil
		}
	}

	// Hash check (fast path with stat fields)
	size, mtimeMs, err := db.getCurrentSourceStat(absSource)
	if err != nil {
		return true, err
	}

	hasCachedStat := info.SrcSize != nil && info.SrcMtimeMs != nil
	if hasCachedStat && *info.SrcSize == size && *info.SrcMtimeMs == mtimeMs {
		// unchanged; also populate in-memory cache hash for reuse
		db.mu.Lock()
		db.sourceInfoCache[absSource] = cachedSourceInfo{
			size:      size,
			mtimeMs:   mtimeMs,
			hash:      info.SrcHash,
			checkedAt: time.Now(),
		}
		db.mu.Unlock()
		return false, nil
	}

	currentHash, err := db.getSourceHashForStat(absSource, size, mtimeMs)
	if err != nil {
		return true, err
	}
	hashChanged := currentHash != info.SrcHash

	// Backfill stat fields when unchanged to speed up future scans (in-memory only, same as extension)
	if !hashChanged {
		ss := size
		mt := mtimeMs
		info.SrcSize = &ss
		info.SrcMtimeMs = &mt
		db.mu.Lock()
		rec := db.cache[targetLang]
		rec[relSource] = info
		db.cache[targetLang] = rec
		db.mu.Unlock()
	}

	return hashChanged, nil
}

func (db *TranslationDatabase) UpdateTranslationTime(sourcePath string, targetLang string) error {
	if err := db.ensureLanguageLoaded(targetLang); err != nil {
		return err
	}

	absSource, err := filepath.Abs(sourcePath)
	if err != nil {
		absSource = sourcePath
	}
	relSource := db.relativeToWorkspace(absSource)

	size, mtimeMs, err := db.getCurrentSourceStat(absSource)
	if err != nil {
		return err
	}
	h, err := db.getSourceHashForStat(absSource, size, mtimeMs)
	if err != nil {
		return err
	}

	ss := size
	mt := mtimeMs
	info := TranslationFileInfo{
		TranslateDatetime: db.formatDateTime(time.Now()),
		SrcHash:           h,
		SrcSize:           &ss,
		SrcMtimeMs:        &mt,
	}

	db.mu.Lock()
	rec := db.cache[targetLang]
	rec[relSource] = info
	db.cache[targetLang] = rec
	db.mu.Unlock()

	return db.saveLanguage(targetLang)
}
