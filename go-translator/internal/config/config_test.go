package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig_Default(t *testing.T) {
	cfg, err := LoadConfig("")
	if err != nil {
		t.Fatalf("LoadConfig 失败: %v", err)
	}

	if cfg == nil {
		t.Fatal("配置不应为 nil")
	}

	if len(cfg.Vendors) == 0 {
		t.Error("应该有默认供应商")
	}

	if cfg.CurrentVendorName == "" {
		cfg.CurrentVendorName = "deepseek"
	}

	vendor, err := cfg.GetCurrentVendor()
	if err != nil {
		t.Fatalf("GetCurrentVendor 失败: %v", err)
	}

	if vendor.Name != "deepseek" {
		t.Errorf("期望供应商名称为 'deepseek'，实际为 '%s'", vendor.Name)
	}

	if vendor.Model != "deepseek-chat" {
		t.Errorf("期望模型为 'deepseek-chat'，实际为 '%s'", vendor.Model)
	}
}

func TestLoadConfig_FromFile(t *testing.T) {
	// 创建临时配置文件
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "test-config.json")

	testConfig := Config{
		CurrentVendorName: "test-vendor",
		Vendors: []VendorConfig{
			{
				Name:             "test-vendor",
				APIEndpoint:      "https://api.test.com/v1",
				APIKeyEnvVarName: "TEST_API_KEY",
				Model:            "test-model",
				RPM:              10,
				Temperature:      0.5,
				TopP:             0.9,
				StreamMode:       false,
			},
		},
		SpecifiedFiles: []SpecifiedFile{
			{
				SourceFile: SourceFileConfig{
					Path: "test.md",
					Lang: "en",
				},
				TargetFiles: []TargetFile{
					{
						Path: "i18n/zh/test.md",
						Lang: "zh",
					},
				},
			},
		},
	}

	data, err := json.MarshalIndent(testConfig, "", "  ")
	if err != nil {
		t.Fatalf("编码配置失败: %v", err)
	}

	if err := os.WriteFile(cfgPath, data, 0644); err != nil {
		t.Fatalf("写入配置文件失败: %v", err)
	}

	// 加载配置
	cfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("LoadConfig 失败: %v", err)
	}

	if cfg.CurrentVendorName != "test-vendor" {
		t.Errorf("期望当前供应商为 'test-vendor'，实际为 '%s'", cfg.CurrentVendorName)
	}

	if len(cfg.SpecifiedFiles) != 1 {
		t.Errorf("期望有 1 个指定文件，实际为 %d", len(cfg.SpecifiedFiles))
	}

	if cfg.SpecifiedFiles[0].SourceFile.Path != "test.md" {
		t.Errorf("期望源文件路径为 'test.md'，实际为 '%s'", cfg.SpecifiedFiles[0].SourceFile.Path)
	}
}

func TestLoadConfig_InvalidJSON(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "invalid-config.json")

	// 写入无效的 JSON
	if err := os.WriteFile(cfgPath, []byte("{invalid json"), 0644); err != nil {
		t.Fatalf("写入配置文件失败: %v", err)
	}

	// 应该返回错误
	_, err := LoadConfig(cfgPath)
	if err == nil {
		t.Error("期望解析无效 JSON 时返回错误")
	}
}

func TestGetCurrentVendor(t *testing.T) {
	cfg := &Config{
		CurrentVendorName: "vendor1",
		Vendors: []VendorConfig{
			{Name: "vendor1", Model: "model1"},
			{Name: "vendor2", Model: "model2"},
		},
	}

	vendor, err := cfg.GetCurrentVendor()
	if err != nil {
		t.Fatalf("GetCurrentVendor 失败: %v", err)
	}

	if vendor.Name != "vendor1" {
		t.Errorf("期望供应商名称为 'vendor1'，实际为 '%s'", vendor.Name)
	}
}

func TestGetCurrentVendor_NotFound(t *testing.T) {
	cfg := &Config{
		CurrentVendorName: "non-existent",
		Vendors: []VendorConfig{
			{Name: "vendor1", Model: "model1"},
		},
	}

	// 应该返回第一个供应商
	vendor, err := cfg.GetCurrentVendor()
	if err != nil {
		t.Fatalf("GetCurrentVendor 失败: %v", err)
	}

	if vendor.Name != "vendor1" {
		t.Errorf("期望返回第一个供应商 'vendor1'，实际为 '%s'", vendor.Name)
	}
}

func TestGetCurrentVendor_NoVendors(t *testing.T) {
	cfg := &Config{
		CurrentVendorName: "test",
		Vendors:           []VendorConfig{},
	}

	_, err := cfg.GetCurrentVendor()
	if err == nil {
		t.Error("期望没有供应商时返回错误")
	}
}

func TestGetDefaultConfigPath(t *testing.T) {
	path := GetDefaultConfigPath()
	if path == "" {
		t.Error("配置文件路径不应为空")
	}
	if filepath.Base(path) != ProjectConfigFileName {
		t.Errorf("期望默认配置文件名为 '%s'，实际为 '%s'", ProjectConfigFileName, filepath.Base(path))
	}
}

func TestSaveConfig(t *testing.T) {
	tmpDir := t.TempDir()
	cfgPath := filepath.Join(tmpDir, "save-test.json")

	cfg := &Config{
		CurrentVendorName: "test",
		Vendors: []VendorConfig{
			{
				Name:             "test",
				APIEndpoint:      "https://api.test.com",
				APIKeyEnvVarName: "TEST_KEY",
				Model:            "test-model",
			},
		},
		SpecifiedFiles: []SpecifiedFile{
			{
				SourceFile:  SourceFileConfig{Path: "test.txt", Lang: "en"},
				TargetFiles: []TargetFile{{Path: "test_zh.txt", Lang: "zh"}},
			},
		},
	}

	err := SaveConfig(cfg, cfgPath)
	if err != nil {
		t.Fatalf("SaveConfig 失败: %v", err)
	}

	// 验证文件存在
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		t.Error("配置文件应该存在")
	}

	// 重新加载验证内容
	loadedCfg, err := LoadConfig(cfgPath)
	if err != nil {
		t.Fatalf("加载保存的配置失败: %v", err)
	}

	if loadedCfg.CurrentVendorName != cfg.CurrentVendorName {
		t.Errorf("期望当前供应商为 '%s'，实际为 '%s'", cfg.CurrentVendorName, loadedCfg.CurrentVendorName)
	}

	if len(loadedCfg.SpecifiedFiles) != 1 {
		t.Errorf("期望有 1 个指定文件，实际为 %d", len(loadedCfg.SpecifiedFiles))
	}
}

func TestGetAPIKey_FromEnvVar(t *testing.T) {
	vendor := &VendorConfig{
		Name:             "test",
		APIKeyEnvVarName: "TEST_TRANSLATOR_API_KEY",
	}

	// 设置环境变量
	testKey := "test-api-key-12345"
	os.Setenv("TEST_TRANSLATOR_API_KEY", testKey)
	defer os.Unsetenv("TEST_TRANSLATOR_API_KEY")

	key, err := vendor.GetAPIKey()
	if err != nil {
		t.Fatalf("GetAPIKey 失败: %v", err)
	}

	if key != testKey {
		t.Errorf("期望 API Key 为 '%s'，实际为 '%s'", testKey, key)
	}
}

func TestGetAPIKey_FromConfig(t *testing.T) {
	vendor := &VendorConfig{
		Name:   "test",
		APIKey: "config-api-key-67890",
	}

	key, err := vendor.GetAPIKey()
	if err != nil {
		t.Fatalf("GetAPIKey 失败: %v", err)
	}

	if key != "config-api-key-67890" {
		t.Errorf("期望 API Key 为 'config-api-key-67890'，实际为 '%s'", key)
	}
}

func TestGetAPIKey_ConfigPreferredOverEnv(t *testing.T) {
	vendor := &VendorConfig{
		Name:             "test",
		APIKey:           "config-key",
		APIKeyEnvVarName: "TEST_API_KEY",
	}

	os.Setenv("TEST_API_KEY", "env-key")
	defer os.Unsetenv("TEST_API_KEY")

	key, err := vendor.GetAPIKey()
	if err != nil {
		t.Fatalf("GetAPIKey 失败: %v", err)
	}

	// 配置中的 API Key 优先
	if key != "config-key" {
		t.Errorf("期望优先使用配置中的 API Key 'config-key'，实际为 '%s'", key)
	}
}

func TestGetAPIKey_NotSet(t *testing.T) {
	vendor := &VendorConfig{
		Name:             "test",
		APIKeyEnvVarName: "NON_EXISTENT_KEY",
	}

	_, err := vendor.GetAPIKey()
	if err == nil {
		t.Error("期望 API Key 未设置时返回错误")
	}
}

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg == nil {
		t.Fatal("默认配置不应为 nil")
	}

	if len(cfg.Vendors) == 0 {
		t.Error("默认配置应该有供应商")
	}
	if cfg.TranslationIntervalDays != -1 {
		t.Errorf("默认 translationIntervalDays 应为 -1，实际为 %d", cfg.TranslationIntervalDays)
	}
	if len(cfg.CopyOnly.Extensions) == 0 || cfg.CopyOnly.Extensions[0] != ".svg" {
		t.Errorf("默认 copyOnly.extensions 应包含 '.svg'，实际为 %+v", cfg.CopyOnly.Extensions)
	}
	if len(cfg.Ignore.Paths) == 0 {
		t.Error("默认 ignore.paths 不应为空")
	}
	if cfg.DiffApply.AutoBackup != true {
		t.Errorf("默认 diffApply.autoBackup 应为 true，实际为 %v", cfg.DiffApply.AutoBackup)
	}
	if len(cfg.SkipFrontMatter.Markers) == 0 {
		t.Error("默认 skipFrontMatter.markers 不应为空")
	}
}

// 基准测试
func BenchmarkLoadConfig(b *testing.B) {
	tmpDir := b.TempDir()
	cfgPath := filepath.Join(tmpDir, "bench-config.json")

	testConfig := DefaultConfig()
	data, _ := json.MarshalIndent(testConfig, "", "  ")
	os.WriteFile(cfgPath, data, 0644)

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, _ = LoadConfig(cfgPath)
	}
}

func BenchmarkSaveConfig(b *testing.B) {
	tmpDir := b.TempDir()
	cfgPath := filepath.Join(tmpDir, "bench-save.json")

	cfg := DefaultConfig()

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = SaveConfig(cfg, cfgPath)
	}
}
