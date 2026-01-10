package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/project-translator/go-translator/internal/config"
)

func TestRootCommand_Version(t *testing.T) {
	cmd := NewRootCommand()
	err := cmd.Run([]string{"-version"})
	if err != nil {
		t.Fatalf("Run 失败: %v", err)
	}
}

func TestRootCommand_Help(t *testing.T) {
	testCases := []struct {
		name string
		args []string
	}{
		{"help flag", []string{"help"}},
		{"short help", []string{"-h"}},
		{"long help", []string{"--help"}},
		{"no args", []string{}},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			cmd := NewRootCommand()
			err := cmd.Run(tc.args)
			if err != nil {
				t.Fatalf("Run 失败: %v", err)
			}
		})
	}
}

func TestRootCommand_UnknownCommand(t *testing.T) {
	cmd := NewRootCommand()
	err := cmd.Run([]string{"unknown-command"})

	if err == nil {
		t.Error("期望未知命令返回错误")
	}

	if !strings.Contains(err.Error(), "unknown command") {
		t.Errorf("错误信息应包含 'unknown command'，实际为 '%v'", err)
	}
}

func TestRootCommand_ConfigPath(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "test-config.json")

	cmd := NewRootCommand()
	cmd.config = cfgPath

	// 这应该不会报错，只是显示帮助
	err := cmd.Run([]string{})
	if err != nil {
		t.Fatalf("Run 失败: %v", err)
	}
}

// 测试 Translate 命令帮助
func TestTranslateCommand_Help(t *testing.T) {
	root := NewRootCommand()
	transCmd := NewTranslateCommand(root)

	testCases := [][]string{
		{"help"},
		{"-h"},
		{"--help"},
		{},
	}

	for _, args := range testCases {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			err := transCmd.Run(args)
			if err != nil {
				t.Fatalf("Run 失败: %v", err)
			}
		})
	}
}

// 测试 Translate 命令未知操作
func TestTranslateCommand_UnknownAction(t *testing.T) {
	root := NewRootCommand()
	transCmd := NewTranslateCommand(root)

	err := transCmd.Run([]string{"unknown-action"})
	if err == nil {
		t.Error("期望未知操作返回错误")
	}
}

// 测试 Add 命令帮助
func TestAddCommand_Help(t *testing.T) {
	root := NewRootCommand()
	addCmd := NewAddCommand(root)

	testCases := [][]string{
		{"help"},
		{"-h"},
		{"--help"},
		{},
	}

	for _, args := range testCases {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			err := addCmd.Run(args)
			if err != nil {
				t.Fatalf("Run 失败: %v", err)
			}
		})
	}
}

// 测试 Add 命令未知操作
func TestAddCommand_UnknownAction(t *testing.T) {
	root := NewRootCommand()
	addCmd := NewAddCommand(root)

	err := addCmd.Run([]string{"unknown-action"})
	if err == nil {
		t.Error("期望未知操作返回错误")
	}
}

// 测试 Add 文件不存在
func TestAddCommand_FileNotExists(t *testing.T) {
	root := NewRootCommand()
	addCmd := NewAddCommand(root)

	// 使用不存在的文件
	err := addCmd.addFile([]string{"/nonexistent/file.txt"})
	if err == nil {
		t.Error("期望文件不存在时返回错误")
	}

	if !strings.Contains(err.Error(), "不存在") {
		t.Errorf("错误信息应包含 '不存在'，实际为 '%v'", err)
	}
}

// 测试 Add 文件成功
func TestAddCommand_AddFile(t *testing.T) {
	root := NewRootCommand()
	root.config = filepath.Join(t.TempDir(), "test-config.json")

	addCmd := NewAddCommand(root)

	// 创建临时文件
	tmpFile := filepath.Join(t.TempDir(), "test.txt")
	if err := os.WriteFile(tmpFile, []byte("test content"), 0644); err != nil {
		t.Fatalf("创建测试文件失败: %v", err)
	}

	// 添加文件
	err := addCmd.addFile([]string{tmpFile, "-source-lang", "en", "-target-lang", "zh"})
	if err != nil {
		t.Fatalf("addFile 失败: %v", err)
	}

	// 验证配置文件已创建
	if _, err := os.Stat(root.config); os.IsNotExist(err) {
		t.Error("配置文件应该已创建")
	}
}

// 测试 Add 文件夹成功
func TestAddCommand_AddFolder(t *testing.T) {
	root := NewRootCommand()
	root.config = filepath.Join(t.TempDir(), "test-config.json")

	addCmd := NewAddCommand(root)

	// 使用当前目录作为测试文件夹
	tmpDir := t.TempDir()

	err := addCmd.addFolder([]string{tmpDir, "-source-lang", "en", "-target-lang", "zh"})
	if err != nil {
		t.Fatalf("addFolder 失败: %v", err)
	}

	// 验证配置文件已创建
	if _, err := os.Stat(root.config); os.IsNotExist(err) {
		t.Error("配置文件应该已创建")
	}
}

// 测试 Config 命令帮助
func TestConfigCommand_Help(t *testing.T) {
	root := NewRootCommand()
	cfgCmd := NewConfigCommand(root)

	testCases := [][]string{
		{"help"},
		{"-h"},
		{"--help"},
		{},
	}

	for _, args := range testCases {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			err := cfgCmd.Run(args)
			if err != nil {
				t.Fatalf("Run 失败: %v", err)
			}
		})
	}
}

// 测试 Config path 命令
func TestConfigCommand_Path(t *testing.T) {
	root := NewRootCommand()
	cfgCmd := NewConfigCommand(root)

	// 捕获输出
	old := os.Stdout
	r, w, _ := os.Pipe()
	os.Stdout = w

	err := cfgCmd.showPath([]string{})
	if err != nil {
		t.Fatalf("showPath 失败: %v", err)
	}

	w.Close()
	os.Stdout = old

	var buf bytes.Buffer
	io.Copy(&buf, r)

	output := buf.String()
	if output == "" {
		t.Error("showPath 应该输出路径")
	}

	if !strings.Contains(output, config.ProjectConfigFileName) {
		t.Errorf("输出路径应包含 '%s'，实际为 '%s'", config.ProjectConfigFileName, output)
	}
}

// 测试 Config init 命令
func TestConfigCommand_Init(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "test-config.json")

	root := NewRootCommand()
	root.config = cfgPath

	cfgCmd := NewConfigCommand(root)

	err := cfgCmd.initConfig([]string{})
	if err != nil {
		t.Fatalf("initConfig 失败: %v", err)
	}

	// 验证配置文件已创建
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		t.Error("配置文件应该已创建")
	}

	// 再次初始化应该报错（文件已存在）
	err = cfgCmd.initConfig([]string{})
	if err == nil {
		t.Error("配置文件已存在时不使用 -f 应该返回错误")
	}
}

// 测试 Config init -f 命令（覆盖）
func TestConfigCommand_InitForce(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "test-config.json")

	root := NewRootCommand()
	root.config = cfgPath

	cfgCmd := NewConfigCommand(root)

	// 第一次初始化
	err := cfgCmd.initConfig([]string{})
	if err != nil {
		t.Fatalf("第一次 initConfig 失败: %v", err)
	}

	// 使用 -f 强制覆盖
	err = cfgCmd.initConfig([]string{"-f"})
	if err != nil {
		t.Fatalf("第二次 initConfig 失败: %v", err)
	}
}

// 测试 Config export 命令
func TestConfigCommand_Export(t *testing.T) {
	tmpDir := t.TempDir()
	exportPath := filepath.Join(tmpDir, "exported-config.json")

	root := NewRootCommand()
	root.config = filepath.Join(t.TempDir(), "source-config.json")

	// 先创建源配置
	cfg := NewConfigCommand(root)
	_ = cfg.initConfig([]string{})

	// 导出配置
	err := cfg.exportConfig([]string{"-o", exportPath})
	if err != nil {
		t.Fatalf("exportConfig 失败: %v", err)
	}

	// 验证导出的文件存在
	if _, err := os.Stat(exportPath); os.IsNotExist(err) {
		t.Error("导出的配置文件应该存在")
	}
}

// 测试完整的工作流
func TestWorkflow_CompleteTranslation(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "workflow-config.json")

	// 1. 初始化配置
	root := NewRootCommand()
	root.config = cfgPath

	cfgCmd := NewConfigCommand(root)
	err := cfgCmd.initConfig([]string{})
	if err != nil {
		t.Fatalf("初始化配置失败: %v", err)
	}

	// 2. 添加文件
	addCmd := NewAddCommand(root)
	testFile := filepath.Join(t.TempDir(), "test.txt")
	_ = os.WriteFile(testFile, []byte("Hello World"), 0644)

	err = addCmd.addFile([]string{testFile, "-source-lang", "en", "-target-lang", "zh"})
	if err != nil {
		t.Fatalf("添加文件失败: %v", err)
	}

	// 3. 验证配置
	loadedCfg, err := loadConfigFromFile(cfgPath)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}

	if len(loadedCfg.SpecifiedFiles) != 1 {
		t.Errorf("期望配置中有 1 个文件，实际为 %d", len(loadedCfg.SpecifiedFiles))
	}
}

// 辅助函数：从文件加载配置
func loadConfigFromFile(path string) (*config.Config, error) {
	return config.LoadConfig(path)
}

// 基准测试
func BenchmarkRootCommandHelp(b *testing.B) {
	cmd := NewRootCommand()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cmd.Run([]string{})
	}
}

func BenchmarkTranslateCommandHelp(b *testing.B) {
	root := NewRootCommand()
	cmd := NewTranslateCommand(root)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cmd.Run([]string{})
	}
}

func BenchmarkAddCommandHelp(b *testing.B) {
	root := NewRootCommand()
	cmd := NewAddCommand(root)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = cmd.Run([]string{})
	}
}
