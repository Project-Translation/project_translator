package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/project-translator/go-translator/internal/config"
)

// AddCommand 添加命令
type AddCommand struct {
	root *RootCommand
	fs   *flag.FlagSet
}

// NewAddCommand 创建添加命令
func NewAddCommand(root *RootCommand) *AddCommand {
	fs := flag.NewFlagSet("add", flag.ExitOnError)
	return &AddCommand{
		root: root,
		fs:   fs,
	}
}

// Run 执行添加命令
func (c *AddCommand) Run(args []string) error {
	// 检查帮助标志（在 flag 解析前）
	for _, arg := range args {
		if arg == "-h" || arg == "--help" {
			c.printUsage()
			return nil
		}
	}

	if err := c.fs.Parse(args); err != nil {
		return err
	}

	if c.fs.NArg() == 0 {
		c.printUsage()
		return nil
	}

	// 获取子命令
	action := c.fs.Arg(0)
	subArgs := c.fs.Args()[1:]

	switch action {
	case "file":
		return c.addFile(subArgs)
	case "folder":
		return c.addFolder(subArgs)
	case "help":
		c.printUsage()
	default:
		fmt.Fprintf(os.Stderr, "未知操作: %s\n\n", action)
		c.printUsage()
		return fmt.Errorf("unknown action: %s", action)
	}

	return nil
}

func (c *AddCommand) printUsage() {
	fmt.Printf("添加命令 - 将文件或文件夹添加到翻译配置\n\n")
	fmt.Printf("用法:\n")
	fmt.Printf("  translator add <操作> [选项]\n\n")
	fmt.Printf("操作:\n")
	fmt.Printf("  file    添加文件到翻译配置\n")
	fmt.Printf("  folder  添加文件夹到翻译配置\n\n")
	fmt.Printf("示例:\n")
	fmt.Printf("  translator add file README.md -source-lang en -target-lang zh\n")
	fmt.Printf("  translator add folder src/i18n -source-lang en -target-lang zh\n")
}

// addFile 添加文件到配置
func (c *AddCommand) addFile(args []string) error {
	fs := flag.NewFlagSet("file", flag.ExitOnError)
	sourceLang := fs.String("source-lang", "en-us", "源语言")
	targetLang := fs.String("target-lang", "zh-cn", "目标语言")
	targetPath := fs.String("target", "", "目标文件路径 (可选，默认为 i18n/{target-lang}/{source-path})")

	if err := fs.Parse(args); err != nil {
		return err
	}

	if fs.NArg() == 0 {
		fmt.Fprintf(os.Stderr, "错误: 请指定要添加的文件\n")
		c.printUsage()
		return fmt.Errorf("missing file argument")
	}

	filePath := fs.Arg(0)

	// 检查文件是否存在
	if _, err := os.Stat(filePath); err != nil {
		return fmt.Errorf("文件不存在: %s", filePath)
	}

	// 加载配置
	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}
	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	// 计算目标路径
	targetFile := *targetPath
	if targetFile == "" {
		targetFile = filepath.Join("i18n", *targetLang, filePath)
	}

	// 创建新条目
	entry := config.SpecifiedFile{
		SourceFile: config.SourceFileConfig{
			Path: filePath,
			Lang: *sourceLang,
		},
		TargetFiles: []config.TargetFile{
			{
				Path: targetFile,
				Lang: *targetLang,
			},
		},
	}

	// 检查是否已存在
	for i, existing := range cfg.SpecifiedFiles {
		if existing.SourceFile.Path == filePath {
			// 更新现有条目
			cfg.SpecifiedFiles[i] = entry
			fmt.Printf("更新文件配置: %s\n", filePath)
			goto save
		}
	}

	// 添加新条目
	cfg.SpecifiedFiles = append(cfg.SpecifiedFiles, entry)
	fmt.Printf("添加文件配置: %s -> %s\n", filePath, targetFile)

save:
	// 保存配置
	if err := config.SaveConfig(cfg, cfgPath); err != nil {
		return fmt.Errorf("保存配置失败: %w", err)
	}

	fmt.Printf("配置已保存到: %s\n", cfgPath)
	return nil
}

// addFolder 添加文件夹到配置
func (c *AddCommand) addFolder(args []string) error {
	fs := flag.NewFlagSet("folder", flag.ExitOnError)
	sourceLang := fs.String("source-lang", "en-us", "源语言")
	targetLang := fs.String("target-lang", "zh-tw", "目标语言")
	targetPath := fs.String("target", "", "目标文件夹路径 (可选，默认为 i18n/{target-lang}/{source-path})")

	if err := fs.Parse(args); err != nil {
		return err
	}

	if fs.NArg() == 0 {
		fmt.Fprintf(os.Stderr, "错误: 请指定要添加的文件夹\n")
		c.printUsage()
		return fmt.Errorf("missing folder argument")
	}

	folderPath := fs.Arg(0)

	// 规范化路径
	folderPath = filepath.Clean(folderPath)
	if folderPath == "." {
		folderPath = ""
	}

	// 检查文件夹是否存在
	if folderPath != "" {
		if info, err := os.Stat(folderPath); err != nil {
			return fmt.Errorf("文件夹不存在: %s", folderPath)
		} else if !info.IsDir() {
			return fmt.Errorf("不是文件夹: %s", folderPath)
		}
	}

	// 加载配置
	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}
	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	// 计算目标路径
	targetFolder := *targetPath
	if targetFolder == "" {
		targetFolder = filepath.Join("i18n", *targetLang, folderPath)
	}

	// 创建新条目
	entry := config.SpecifiedFolder{
		SourceFolder: config.SourceFolderConfig{
			Path: folderPath,
			Lang: *sourceLang,
		},
		TargetFolders: []config.DestFolder{
			{
				Path: targetFolder,
				Lang: *targetLang,
			},
		},
	}

	// 检查是否已存在
	for i, existing := range cfg.SpecifiedFolders {
		if existing.SourceFolder.Path == folderPath {
			// 更新现有条目
			cfg.SpecifiedFolders[i] = entry
			fmt.Printf("更新文件夹配置: %s\n", folderPath)
			goto save
		}
	}

	// 添加新条目
	cfg.SpecifiedFolders = append(cfg.SpecifiedFolders, entry)
	fmt.Printf("添加文件夹配置: %s -> %s\n", folderPath, targetFolder)

save:
	// 保存配置
	if err := config.SaveConfig(cfg, cfgPath); err != nil {
		return fmt.Errorf("保存配置失败: %w", err)
	}

	fmt.Printf("配置已保存到: %s\n", cfgPath)
	return nil
}

// listFiles 列出配置中的文件
func (c *AddCommand) listFiles() error {
	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}
	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	if len(cfg.SpecifiedFiles) == 0 {
		fmt.Println("没有配置的文件")
		return nil
	}

	fmt.Println("配置的文件:")
	for i, file := range cfg.SpecifiedFiles {
		fmt.Printf("  %d. %s (%s)\n", i+1, file.SourceFile.Path, file.SourceFile.Lang)
		for _, target := range file.TargetFiles {
			fmt.Printf("     -> %s (%s)\n", target.Path, target.Lang)
		}
	}

	return nil
}

// listFolders 列出配置中的文件夹
func (c *AddCommand) listFolders() error {
	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}
	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	if len(cfg.SpecifiedFolders) == 0 {
		fmt.Println("没有配置的文件夹")
		return nil
	}

	fmt.Println("配置的文件夹:")
	for i, folder := range cfg.SpecifiedFolders {
		path := folder.SourceFolder.Path
		if path == "" {
			path = "(项目根目录)"
		}
		fmt.Printf("  %d. %s (%s)\n", i+1, path, folder.SourceFolder.Lang)
		for _, target := range folder.TargetFolders {
			fmt.Printf("     -> %s (%s)\n", target.Path, target.Lang)
		}
	}

	return nil
}

// removeFile 从配置中移除文件
func (c *AddCommand) removeFile(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("请指定要移除的文件路径")
	}

	filePath := args[0]

	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}
	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	// 查找并移除
	found := false
	newFiles := make([]config.SpecifiedFile, 0, len(cfg.SpecifiedFiles))
	for _, file := range cfg.SpecifiedFiles {
		if file.SourceFile.Path == filePath {
			found = true
			fmt.Printf("移除文件配置: %s\n", filePath)
			continue
		}
		newFiles = append(newFiles, file)
	}

	if !found {
		return fmt.Errorf("文件未在配置中: %s", filePath)
	}

	cfg.SpecifiedFiles = newFiles

	if err := config.SaveConfig(cfg, cfgPath); err != nil {
		return fmt.Errorf("保存配置失败: %w", err)
	}

	fmt.Printf("配置已保存到: %s\n", cfgPath)
	return nil
}

// removeFolder 从配置中移除文件夹
func (c *AddCommand) removeFolder(args []string) error {
	if len(args) == 0 {
		return fmt.Errorf("请指定要移除的文件夹路径")
	}

	folderPath := args[0]
	folderPath = filepath.Clean(folderPath)
	if folderPath == "." {
		folderPath = ""
	}

	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}
	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	// 查找并移除
	found := false
	newFolders := make([]config.SpecifiedFolder, 0, len(cfg.SpecifiedFolders))
	for _, folder := range cfg.SpecifiedFolders {
		if folder.SourceFolder.Path == folderPath {
			found = true
			path := folderPath
			if path == "" {
				path = "(项目根目录)"
			}
			fmt.Printf("移除文件夹配置: %s\n", path)
			continue
		}
		newFolders = append(newFolders, folder)
	}

	if !found {
		return fmt.Errorf("文件夹未在配置中: %s", folderPath)
	}

	cfg.SpecifiedFolders = newFolders

	if err := config.SaveConfig(cfg, cfgPath); err != nil {
		return fmt.Errorf("保存配置失败: %w", err)
	}

	fmt.Printf("配置已保存到: %s\n", cfgPath)
	return nil
}
