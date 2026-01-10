package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/project-translator/go-translator/internal/config"
	"github.com/project-translator/go-translator/internal/fileprocessor"
	"github.com/project-translator/go-translator/internal/translationdb"
	"github.com/project-translator/go-translator/internal/translator"
)

// TranslateCommand 翻译命令
type TranslateCommand struct {
	root       *RootCommand
	fs         *flag.FlagSet
	source     string
	target     string
	noStream   bool
	showTokens bool
}

// NewTranslateCommand 创建翻译命令
func NewTranslateCommand(root *RootCommand) *TranslateCommand {
	fs := flag.NewFlagSet("translate", flag.ExitOnError)
	cmd := &TranslateCommand{
		root: root,
		fs:   fs,
	}
	fs.StringVar(&cmd.source, "from", "auto", "源语言")
	fs.StringVar(&cmd.target, "to", "zh-cn", "目标语言")
	fs.BoolVar(&cmd.noStream, "no-stream", false, "禁用流式输出")
	fs.BoolVar(&cmd.showTokens, "tokens", false, "显示 token 使用统计")
	return cmd
}

// Run 执行翻译命令
func (c *TranslateCommand) Run(args []string) error {
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
	case "text":
		return c.translateText(subArgs)
	case "file":
		return c.translateFile(subArgs)
	case "project":
		return c.translateProject(subArgs)
	case "folders":
		return c.translateFolders(subArgs)
	case "help":
		c.printUsage()
	default:
		fmt.Fprintf(os.Stderr, "未知操作: %s\n\n", action)
		c.printUsage()
		return fmt.Errorf("unknown action: %s", action)
	}

	return nil
}

func (c *TranslateCommand) printUsage() {
	fmt.Printf("翻译命令\n\n")
	fmt.Printf("用法:\n")
	fmt.Printf("  translator translate <操作> [选项]\n\n")
	fmt.Printf("操作:\n")
	fmt.Printf("  text     翻译文本内容\n")
	fmt.Printf("  file     翻译单个文件\n")
	fmt.Printf("  project  翻译配置中的所有文件和文件夹\n")
	fmt.Printf("  folders  翻译配置中的文件夹\n\n")
	fmt.Printf("选项:\n")
	c.fs.PrintDefaults()
	fmt.Printf("\n")
	fmt.Printf("示例:\n")
	fmt.Printf("  translator translate text \"Hello World\" -from en -to zh-cn\n")
	fmt.Printf("  translator translate file input.txt -output output.txt\n")
	fmt.Printf("  translator translate project\n")
	fmt.Printf("  translator translate folders\n")
	fmt.Printf("  echo \"Hello\" | translator translate text -\n")
}

// translateText 翻译文本
func (c *TranslateCommand) translateText(args []string) error {
	fs := flag.NewFlagSet("text", flag.ExitOnError)
	outputFile := fs.String("output", "", "输出文件路径")

	if err := fs.Parse(args); err != nil {
		return err
	}

	// 获取要翻译的内容
	var content string
	if fs.NArg() > 0 {
		text := fs.Arg(0)
		if text == "-" {
			// 从标准输入读取
			data, err := io.ReadAll(os.Stdin)
			if err != nil {
				return fmt.Errorf("读取标准输入失败: %w", err)
			}
			content = string(data)
		} else {
			content = text
		}
	} else {
		// 从标准输入读取
		data, err := io.ReadAll(os.Stdin)
		if err != nil {
			return fmt.Errorf("读取标准输入失败: %w", err)
		}
		content = string(data)
	}

	if strings.TrimSpace(content) == "" {
		return fmt.Errorf("输入内容为空")
	}

	return c.doTranslate(content, "文本", *outputFile)
}

// translateFile 翻译文件
func (c *TranslateCommand) translateFile(args []string) error {
	fs := flag.NewFlagSet("file", flag.ExitOnError)
	outputFile := fs.String("output", "", "输出文件路径")

	if err := fs.Parse(args); err != nil {
		return err
	}

	if fs.NArg() == 0 {
		fmt.Fprintf(os.Stderr, "错误: 请指定要翻译的文件\n")
		c.printUsage()
		return fmt.Errorf("missing file argument")
	}

	inputFile := fs.Arg(0)
	data, err := os.ReadFile(inputFile)
	if err != nil {
		return fmt.Errorf("读取文件失败: %w", err)
	}

	// 默认输出文件名
	if *outputFile == "" {
		// 如果没有指定输出文件，输出到标准输出
		*outputFile = "-"
	}

	content := string(data)
	return c.doTranslate(content, inputFile, *outputFile)
}

// doTranslate 执行翻译
func (c *TranslateCommand) doTranslate(content, sourceInfo, outputFile string) error {
	// 加载配置
	cfg, err := c.loadConfig()
	if err != nil {
		return err
	}

	// 获取供应商配置
	vendor, err := cfg.GetCurrentVendor()
	if err != nil {
		return fmt.Errorf("获取供应商配置失败: %w", err)
	}

	// 如果禁用流式输出
	if c.noStream {
		vendor.StreamMode = false
	}

	log.Printf("使用供应商: %s (模型: %s)", vendor.Name, vendor.Model)
	log.Printf("源语言: %s, 目标语言: %s", c.source, c.target)

	// 创建翻译器
	systemPrompts, customPrompts, err := c.loadPrompts(cfg)
	if err != nil {
		return err
	}
	tr := translator.NewTranslator(vendor, systemPrompts, customPrompts)
	defer func() {
		if c.showTokens {
			input, output, total := tr.GetTokenCounts()
			log.Printf("Token 统计: 输入=%d, 输出=%d, 总计=%d", input, output, total)
		}
	}()

	// 进度回调
	var outputBuilder strings.Builder
	progressCallback := func(chunk string) {
		fmt.Print(chunk)
		outputBuilder.WriteString(chunk)
	}

	// 执行翻译
	log.Printf("开始翻译...")
	result, err := tr.TranslateContent(
		content,
		c.source,
		c.target,
		true, // isFirstSegment
		progressCallback,
	)

	if err != nil {
		return fmt.Errorf("翻译失败: %w", err)
	}

	// 如果不是流式输出，打印结果
	if c.noStream || !vendor.StreamMode {
		fmt.Print(result.Content)
		outputBuilder.WriteString(result.Content)
	}

	log.Printf("") // 换行
	if result.ReturnCode == translator.ReturnCodeNoNeedTranslate {
		log.Printf("无需翻译")
	} else {
		log.Printf("翻译完成")
	}

	// 写入输出文件
	if outputFile != "" && outputFile != "-" {
		if err := os.WriteFile(outputFile, []byte(outputBuilder.String()), 0644); err != nil {
			return fmt.Errorf("写入输出文件失败: %w", err)
		}
		log.Printf("已保存到: %s", outputFile)
	}

	return nil
}

// loadConfig 加载配置
func (c *TranslateCommand) loadConfig() (*config.Config, error) {
	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}

	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return nil, fmt.Errorf("加载配置失败: %w", err)
	}

	return cfg, nil
}

// translateProject 翻译项目（所有配置的文件和文件夹）
func (c *TranslateCommand) translateProject(args []string) error {
	cfg, err := c.loadConfig()
	if err != nil {
		return err
	}

	log.Printf("开始项目翻译...")
	log.Printf("配置的文件数量: %d", len(cfg.SpecifiedFiles))
	log.Printf("配置的文件夹数量: %d", len(cfg.SpecifiedFolders))

	// 获取供应商配置
	vendor, err := cfg.GetCurrentVendor()
	if err != nil {
		return fmt.Errorf("获取供应商配置失败: %w", err)
	}

	if c.noStream {
		vendor.StreamMode = false
	}

	systemPrompts, customPrompts, err := c.loadPrompts(cfg)
	if err != nil {
		return err
	}
	tr := translator.NewTranslator(vendor, systemPrompts, customPrompts)
	defer func() {
		if c.showTokens {
			input, output, total := tr.GetTokenCounts()
			log.Printf("\nToken 统计: 输入=%d, 输出=%d, 总计=%d", input, output, total)
		}
	}()

	db, err := translationdb.New(cfg.WorkspaceRoot)
	if err != nil {
		return err
	}
	fp := fileprocessor.New(cfg, db, tr)
	fp.TranslateProject()

	st := fp.Stats()
	log.Printf("\n项目翻译完成!")
	log.Printf("处理: %d, 跳过: %d, 失败: %d", st.Processed, st.Skipped, st.Failed)

	return nil
}

// translateFolders 翻译配置的文件夹
func (c *TranslateCommand) translateFolders(args []string) error {
	cfg, err := c.loadConfig()
	if err != nil {
		return err
	}

	if len(cfg.SpecifiedFolders) == 0 {
		return fmt.Errorf("没有配置的文件夹，请先使用 'translator add folder' 添加文件夹")
	}

	log.Printf("开始翻译文件夹...")
	log.Printf("配置的文件夹数量: %d", len(cfg.SpecifiedFolders))

	// 获取供应商配置
	vendor, err := cfg.GetCurrentVendor()
	if err != nil {
		return fmt.Errorf("获取供应商配置失败: %w", err)
	}

	if c.noStream {
		vendor.StreamMode = false
	}

	systemPrompts, customPrompts, err := c.loadPrompts(cfg)
	if err != nil {
		return err
	}
	tr := translator.NewTranslator(vendor, systemPrompts, customPrompts)
	defer func() {
		if c.showTokens {
			input, output, total := tr.GetTokenCounts()
			log.Printf("\nToken 统计: 输入=%d, 输出=%d, 总计=%d", input, output, total)
		}
	}()

	db, err := translationdb.New(cfg.WorkspaceRoot)
	if err != nil {
		return err
	}
	fp := fileprocessor.New(cfg, db, tr)
	fp.TranslateSpecifiedFolders()

	st := fp.Stats()
	log.Printf("\n文件夹翻译完成!")
	log.Printf("处理: %d, 跳过: %d, 失败: %d", st.Processed, st.Skipped, st.Failed)

	return nil
}

func (c *TranslateCommand) loadPrompts(cfg *config.Config) ([]string, []string, error) {
	// Prefer shared prompt files under workspace root.
	if cfg != nil {
		if dir, ok := config.ResolvePromptsDir(cfg.WorkspaceRoot); ok {
			p1, p2, err := config.LoadSystemPromptParts(dir)
			if err == nil {
				custom := append([]string{}, cfg.CustomPrompts...)
				// Backward compatibility: treat old userPrompts as custom prompts
				if len(cfg.UserPrompts) > 0 {
					custom = append(custom, cfg.UserPrompts...)
				}
				return []string{p1, p2}, custom, nil
			}
		}
	}

	// Fallback: legacy config embeds system prompts
	if cfg != nil && len(cfg.SystemPrompts) > 0 {
		custom := append([]string{}, cfg.CustomPrompts...)
		if len(cfg.UserPrompts) > 0 {
			custom = append(custom, cfg.UserPrompts...)
		}
		return cfg.SystemPrompts, custom, nil
	}

	return nil, nil, fmt.Errorf("无法加载系统提示词：未找到 prompts 目录或提示词文件")
}

// translateFileToPath 翻译文件到指定路径
func (c *TranslateCommand) translateFileToPath(tr *translator.Translator, sourcePath, sourceLang, targetPath, targetLang string) error {
	// 读取源文件
	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return fmt.Errorf("读取源文件失败: %w", err)
	}

	// 创建目标目录
	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return fmt.Errorf("创建目标目录失败: %w", err)
	}

	// 执行翻译
	result, err := tr.TranslateContent(
		string(content),
		sourceLang,
		targetLang,
		true,
		nil,
	)

	if err != nil {
		return err
	}

	if result.ReturnCode == translator.ReturnCodeNoNeedTranslate {
		log.Printf("无需翻译，直接复制")
		return os.WriteFile(targetPath, content, 0644)
	}

	// 写入翻译结果
	return os.WriteFile(targetPath, []byte(result.Content), 0644)
}

// translateDirectory 翻译目录
func (c *TranslateCommand) translateDirectory(tr *translator.Translator, sourcePath, sourceLang, targetPath, targetLang string) (int, error) {
	processedCount := 0

	// 遍历源目录
	err := filepath.Walk(sourcePath, func(filePath string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		// 计算相对路径
		relPath, err := filepath.Rel(sourcePath, filePath)
		if err != nil {
			return err
		}

		// 计算目标路径
		destPath := filepath.Join(targetPath, relPath)

		log.Printf("翻译: %s -> %s", filePath, destPath)

		if err := c.translateFileToPath(tr, filePath, sourceLang, destPath, targetLang); err != nil {
			log.Printf("警告: %v", err)
			return nil // 继续处理其他文件
		}

		processedCount++
		return nil
	})

	return processedCount, err
}
