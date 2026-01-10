package main

import (
	"flag"
	"fmt"
	"os"
)

// RootCommand 根命令
type RootCommand struct {
	fs       *flag.FlagSet
	config   string
	debug    bool
	version  bool
}

// NewRootCommand 创建根命令
func NewRootCommand() *RootCommand {
	fs := flag.NewFlagSet("translator", flag.ExitOnError)
	cmd := &RootCommand{
		fs: fs,
	}
	fs.StringVar(&cmd.config, "config", "", "配置文件路径")
	fs.BoolVar(&cmd.debug, "debug", false, "启用调试模式")
	fs.BoolVar(&cmd.version, "version", false, "显示版本信息")
	return cmd
}

// Run 执行根命令
func (c *RootCommand) Run(args []string) error {
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

	if c.version {
		fmt.Printf("Translator CLI v%s\n", version)
		return nil
	}

	// 如果没有子命令，显示帮助
	if c.fs.NArg() == 0 {
		c.printUsage()
		return nil
	}

	// 获取子命令名称
	subcommand := c.fs.Arg(0)
	subArgs := c.fs.Args()[1:]

	// 路由到子命令
	switch subcommand {
	case "translate":
		return NewTranslateCommand(c).Run(subArgs)
	case "config":
		return NewConfigCommand(c).Run(subArgs)
	case "add":
		return NewAddCommand(c).Run(subArgs)
	case "help":
		c.printUsage()
	default:
		fmt.Fprintf(os.Stderr, "未知命令: %s\n\n", subcommand)
		c.printUsage()
		return fmt.Errorf("unknown command: %s", subcommand)
	}

	return nil
}

func (c *RootCommand) printUsage() {
	fmt.Printf("Translator CLI v%s\n\n", version)
	fmt.Printf("用法:\n")
	fmt.Printf("  translator [全局选项] <命令> [命令选项]\n\n")
	fmt.Printf("全局选项:\n")
	fmt.Printf("  -config string\n")
	fmt.Printf("        配置文件路径\n")
	fmt.Printf("  -debug\n")
	fmt.Printf("        启用调试模式\n")
	fmt.Printf("  -version\n")
	fmt.Printf("        显示版本信息\n\n")
	fmt.Printf("可用命令:\n")
	fmt.Printf("  translate    翻译文本或文件\n")
	fmt.Printf("  config       管理配置\n")
	fmt.Printf("  add          添加文件或文件夹到翻译配置\n")
	fmt.Printf("  help         显示帮助信息\n\n")
	fmt.Printf("使用 \"translator <命令> -help\" 查看具体命令的帮助\n\n")
	fmt.Printf("示例:\n")
	fmt.Printf("  translator translate text \"Hello World\" -from en -to zh-cn\n")
	fmt.Printf("  translator translate file input.txt -output output.txt\n")
	fmt.Printf("  translator config show\n")
	fmt.Printf("  translator add file README.md -source-lang en -target-lang zh\n")
	fmt.Printf("  translator add folder src/i18n -source-lang en -target-lang zh\n")
}
