package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"

	"github.com/project-translator/go-translator/internal/config"
)

// ConfigCommand 配置命令
type ConfigCommand struct {
	root *RootCommand
	fs   *flag.FlagSet
}

// NewConfigCommand 创建配置命令
func NewConfigCommand(root *RootCommand) *ConfigCommand {
	fs := flag.NewFlagSet("config", flag.ExitOnError)
	return &ConfigCommand{
		root: root,
		fs:   fs,
	}
}

// Run 执行配置命令
func (c *ConfigCommand) Run(args []string) error {
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
	case "show":
		return c.showConfig(subArgs)
	case "export":
		return c.exportConfig(subArgs)
	case "init":
		return c.initConfig(subArgs)
	case "path":
		return c.showPath(subArgs)
	case "help":
		c.printUsage()
	default:
		fmt.Fprintf(os.Stderr, "未知操作: %s\n\n", action)
		c.printUsage()
		return fmt.Errorf("unknown action: %s", action)
	}

	return nil
}

func (c *ConfigCommand) printUsage() {
	fmt.Printf("配置管理命令\n\n")
	fmt.Printf("用法:\n")
	fmt.Printf("  translator config <操作> [选项]\n\n")
	fmt.Printf("操作:\n")
	fmt.Printf("  show     显示当前配置\n")
	fmt.Printf("  export   导出配置到文件\n")
	fmt.Printf("  init     初始化配置文件\n")
	fmt.Printf("  path     显示配置文件路径\n\n")
	fmt.Printf("示例:\n")
	fmt.Printf("  translator config show\n")
	fmt.Printf("  translator config export -o project.translation.json\n")
	fmt.Printf("  translator config init\n")
	fmt.Printf("  translator config path\n")
}

// showConfig 显示配置
func (c *ConfigCommand) showConfig(args []string) error {
	fs := flag.NewFlagSet("show", flag.ExitOnError)
	jsonFormat := fs.Bool("json", false, "以 JSON 格式输出")

	if err := fs.Parse(args); err != nil {
		return err
	}

	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}

	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	// 获取当前供应商
	vendor, err := cfg.GetCurrentVendor()
	if err != nil {
		return fmt.Errorf("获取供应商配置失败: %w", err)
	}

	// 获取 API Key
	apiKey, _ := vendor.GetAPIKey()
	maskedKey := ""
	if apiKey != "" {
		if len(apiKey) > 8 {
			maskedKey = apiKey[:4] + "..." + apiKey[len(apiKey)-4:]
		} else {
			maskedKey = "****"
		}
	}

	if *jsonFormat {
		data, _ := json.MarshalIndent(cfg, "", "  ")
		fmt.Println(string(data))
	} else {
		fmt.Printf("配置文件: %s\n\n", cfgPath)
		fmt.Printf("当前供应商: %s\n", cfg.CurrentVendorName)
		fmt.Printf("API 端点: %s\n", vendor.APIEndpoint)
		fmt.Printf("模型: %s\n", vendor.Model)
		fmt.Printf("API Key: %s\n", maskedKey)
		fmt.Printf("温度: %.2f\n", vendor.Temperature)
		fmt.Printf("Top P: %.2f\n", vendor.TopP)
		fmt.Printf("流式模式: %v\n", vendor.StreamMode)
		fmt.Printf("RPM 限制: %d\n", vendor.RPM)
		fmt.Printf("超时: %d 秒\n", vendor.Timeout)
	}

	return nil
}

// exportConfig 导出配置
func (c *ConfigCommand) exportConfig(args []string) error {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	outputPath := fs.String("o", "", "输出文件路径")

	if err := fs.Parse(args); err != nil {
		return err
	}

	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}

	cfg, err := config.LoadConfig(cfgPath)
	if err != nil {
		return fmt.Errorf("加载配置失败: %w", err)
	}

	// 确定输出路径
	outPath := *outputPath
	if outPath == "" {
		outPath = config.GetDefaultConfigPath()
	}

	// 确保目录存在
	dir := filepath.Dir(outPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	// 导出配置（移除敏感信息）
	exportCfg := *cfg
	for i := range exportCfg.Vendors {
		exportCfg.Vendors[i].APIKey = ""
	}

	data, err := json.MarshalIndent(exportCfg, "", "  ")
	if err != nil {
		return fmt.Errorf("编码配置失败: %w", err)
	}

	if err := os.WriteFile(outPath, data, 0644); err != nil {
		return fmt.Errorf("写入配置文件失败: %w", err)
	}

	fmt.Printf("配置已导出到: %s\n", outPath)
	return nil
}

// initConfig 初始化配置
func (c *ConfigCommand) initConfig(args []string) error {
	fs := flag.NewFlagSet("init", flag.ExitOnError)
	force := fs.Bool("f", false, "覆盖已存在的配置文件")

	if err := fs.Parse(args); err != nil {
		return err
	}

	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}

	// 检查文件是否存在
	if _, err := os.Stat(cfgPath); err == nil && !*force {
		return fmt.Errorf("配置文件已存在: %s (使用 -f 覆盖)", cfgPath)
	}

	// 创建默认配置
	cfg := config.DefaultConfig()

	// 确保目录存在
	dir := filepath.Dir(cfgPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	// 移除 API Key（使用环境变量）
	for i := range cfg.Vendors {
		cfg.Vendors[i].APIKey = ""
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("编码配置失败: %w", err)
	}

	if err := os.WriteFile(cfgPath, data, 0644); err != nil {
		return fmt.Errorf("写入配置文件失败: %w", err)
	}

	fmt.Printf("配置文件已创建: %s\n", cfgPath)
	fmt.Printf("\n请设置环境变量: %s\n", cfg.Vendors[0].APIKeyEnvVarName)
	return nil
}

// showPath 显示配置文件路径
func (c *ConfigCommand) showPath(args []string) error {
	cfgPath := c.root.config
	if cfgPath == "" {
		cfgPath = config.GetDefaultConfigPath()
	}

	fmt.Println(cfgPath)
	return nil
}
