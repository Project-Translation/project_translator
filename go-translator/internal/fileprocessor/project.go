package fileprocessor

import (
	"io/fs"
	"path/filepath"
)

func (p *Processor) TranslateSpecifiedFiles() {
	if p.cfg == nil {
		return
	}
	for _, fileCfg := range p.cfg.SpecifiedFiles {
		sourcePath := fileCfg.SourceFile.Path
		sourceLang := fileCfg.SourceFile.Lang
		for _, target := range fileCfg.TargetFiles {
			if err := p.ProcessFile(sourcePath, target.Path, sourceLang, target.Lang); err != nil {
				p.stats.Failed++
				p.stats.FailedPaths = append(p.stats.FailedPaths, sourcePath)
			}
		}
	}
}

func (p *Processor) TranslateSpecifiedFolders() {
	if p.cfg == nil {
		return
	}
	for _, folderCfg := range p.cfg.SpecifiedFolders {
		sourceRoot := p.resolvePath(folderCfg.SourceFolder.Path)
		sourceLang := folderCfg.SourceFolder.Lang
		for _, target := range folderCfg.TargetFolders {
			targetRoot := p.resolvePath(target.Path)
			if err := p.translateDirectory(sourceRoot, sourceLang, targetRoot, target.Lang); err != nil {
				p.stats.Failed++
				p.stats.FailedPaths = append(p.stats.FailedPaths, folderCfg.SourceFolder.Path)
			}
		}
	}
}

func (p *Processor) TranslateProject() {
	p.TranslateSpecifiedFiles()
	p.TranslateSpecifiedFolders()
}

func (p *Processor) translateDirectory(
	absSourceRoot string,
	sourceLang string,
	absTargetRoot string,
	targetLang string,
) error {
	// Walk the source root; skip ignored directories using workspace-relative globs.
	return filepath.WalkDir(absSourceRoot, func(current string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			rel := p.relToWorkspace(current)
			if p.cfg != nil && p.matchAny(p.cfg.Ignore.Paths, rel) {
				return filepath.SkipDir
			}
			return nil
		}

		relToSource, err := filepath.Rel(absSourceRoot, current)
		if err != nil {
			return err
		}
		dest := filepath.Join(absTargetRoot, relToSource)
		if err := p.ProcessFile(current, dest, sourceLang, targetLang); err != nil {
			p.stats.Failed++
			p.stats.FailedPaths = append(p.stats.FailedPaths, current)
			// continue walking
			return nil
		}
		return nil
	})
}
