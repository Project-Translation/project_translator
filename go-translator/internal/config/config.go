package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// VendorConfig AI 供应商配置
type VendorConfig struct {
	Name               string  `json:"name"`
	APIEndpoint        string  `json:"apiEndpoint"`
	APIKey             string  `json:"apiKey,omitempty"`
	APIKeyEnvVarName   string  `json:"apiKeyEnvVarName,omitempty"`
	Model              string  `json:"model"`
	RPM                int     `json:"rpm,omitempty"`
	MaxTokensPerSegment int    `json:"maxTokensPerSegment,omitempty"`
	Timeout            int     `json:"timeout,omitempty"`
	Temperature        float64 `json:"temperature,omitempty"`
	TopP              float64 `json:"top_p,omitempty"`
	StreamMode        bool    `json:"streamMode,omitempty"`
}

// TargetFile 目标文件配置
type TargetFile struct {
	Path string `json:"path"`
	Lang string `json:"lang"`
}

// SourceFileConfig 源文件配置
type SourceFileConfig struct {
	Path string `json:"path"`
	Lang string `json:"lang"`
}

// SpecifiedFile 指定文件配置
type SpecifiedFile struct {
	SourceFile SourceFileConfig `json:"sourceFile"`
	TargetFiles []TargetFile    `json:"targetFiles"`
}

// DestFolder 目标文件夹配置
type DestFolder struct {
	Path string `json:"path"`
	Lang string `json:"lang"`
}

// SourceFolderConfig 源文件夹配置
type SourceFolderConfig struct {
	Path string `json:"path"`
	Lang string `json:"lang"`
}

// SpecifiedFolder 指定文件夹配置
type SpecifiedFolder struct {
	SourceFolder SourceFolderConfig `json:"sourceFolder"`
	TargetFolders []DestFolder      `json:"targetFolders"`
}

// Config 翻译器配置
type Config struct {
	Vendors            []VendorConfig   `json:"vendors"`
	CurrentVendorName  string           `json:"currentVendor,omitempty"`
	SystemPrompts      []string         `json:"systemPrompts,omitempty"`
	UserPrompts        []string         `json:"userPrompts,omitempty"`
	Debug              bool             `json:"debug,omitempty"`
	Timeout            int              `json:"timeout,omitempty"`
	SpecifiedFiles     []SpecifiedFile  `json:"specifiedFiles,omitempty"`
	SpecifiedFolders   []SpecifiedFolder `json:"specifiedFolders,omitempty"`
}

// LoadConfig 从配置文件加载配置
func LoadConfig(configPath string) (*Config, error) {
	cfg := &Config{}

	// 如果配置文件存在，从文件加载
	if configPath != "" {
		data, err := os.ReadFile(configPath)
		if err == nil {
			if err := json.Unmarshal(data, cfg); err != nil {
				return nil, fmt.Errorf("解析配置文件失败: %w", err)
			}
			return cfg, nil
		}
	}

	// 返回默认配置
	return DefaultConfig(), nil
}

// DefaultConfig 返回默认配置
func DefaultConfig() *Config {
	return &Config{
		Vendors: []VendorConfig{
			{
				Name:               "deepseek",
				APIEndpoint:        "https://api.deepseek.com/v1",
				APIKeyEnvVarName:   "DEEPSEEK_API_KEY",
				Model:              "deepseek-chat",
				RPM:                20,
				MaxTokensPerSegment: 3000,
				Timeout:            30,
				Temperature:        0.7,
				TopP:               0.95,
				StreamMode:         true,
			},
		},
		CurrentVendorName: "deepseek",
		SystemPrompts:     []string{defaultSystemPromptPart1, defaultSystemPromptPart2},
		UserPrompts:       []string{},
		Debug:            false,
		Timeout:          30,
	}
}

// GetCurrentVendor 获取当前供应商配置
func (c *Config) GetCurrentVendor() (*VendorConfig, error) {
	vendorName := c.CurrentVendorName
	if vendorName == "" {
		vendorName = "deepseek"
	}

	for _, vendor := range c.Vendors {
		if vendor.Name == vendorName {
			return &vendor, nil
		}
	}

	// 如果没有找到，返回第一个供应商
	if len(c.Vendors) > 0 {
		return &c.Vendors[0], nil
	}

	return nil, fmt.Errorf("没有可用的供应商配置")
}

// GetAPIKey 获取 API Key
func (v *VendorConfig) GetAPIKey() (string, error) {
	// 优先使用直接配置的 API Key
	if v.APIKey != "" {
		return v.APIKey, nil
	}

	// 从环境变量获取
	if v.APIKeyEnvVarName != "" {
		apiKey := os.Getenv(v.APIKeyEnvVarName)
		if apiKey != "" {
			return apiKey, nil
		}
		return "", fmt.Errorf("环境变量 %s 未设置", v.APIKeyEnvVarName)
	}

	return "", fmt.Errorf("API Key 未配置")
}

// GetDefaultConfigPath 获取默认配置文件路径
func GetDefaultConfigPath() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, ".translator", "config.json")
}

const (
	defaultSystemPromptPart1 = `你是一个专业翻译 AI，严格遵守以下准则：

1. **格式绝对优先**：保持原始内容的完整格式(JSON/XML/Markdown 等)，所有格式标记(包括三个连续反引号代码块符号)必须原样保留，数量、位置和形式不得更改
2. **精准符号控制**：特别关注三重反引号的使用：
   - 禁止添加或删除任何反引号符号
   - 代码块内的文本仅当明确语言变化时才翻译
   - Markdown 中的代码块标识符(如三个反引号python)绝不翻译


## 严格禁令

1. 禁止解释判断逻辑
2. 禁止添加任何前缀/后缀
3. 禁止将固定 UUID 包裹在任何格式中
4. 禁止改动原始空白字符(制表符/缩进/空行)
5. 严格匹配反引号数量：
   - 如果输入含三个反引号 → 输出必须有相同数量的三个反引号
   - 如果输入无三个反引号 → 输出禁止添加三个反引号

## 执行样例

输入示例(XML)：

<article>
  <title>Hello World</title>
  <content>This needs translation</content>
</article>

输出(翻译后)：

<article>
  <title>你好世界</title>
  <content>这需要翻译</content>
</article>
`

	defaultSystemPromptPart2 = `**需要判断是否需要翻译**：
   - 需要翻译 → 保留格式进行翻译
   - 不需要翻译 → 返回固定 UUID：727d2eb8-8683-42bd-a1d0-f604fcd82163

## 翻译判断标准(按优先级)

| 判断依据                       | 处理方式             |
| ------------------------------ | -------------------- |
| **纯代码/数据**(无自然语言)    | 返回 UUID            |
| **Markdown 手稿**(draft: true) | 返回 UUID            |
| **混合语言内容**               | 翻译全部自然语言文本 |

## 响应协议

**不需要翻译**：

- 严格返回纯文本：727d2eb8-8683-42bd-a1d0-f604fcd82163
- 无任何额外字符/格式

输入示例(Markdown)：

---
draft: true
---

This is a draft.

输出: 727d2eb8-8683-42bd-a1d0-f604fcd82163
`
)

// SaveConfig 保存配置到文件
func SaveConfig(cfg *Config, configPath string) error {
	// 确保目录存在
	dir := filepath.Dir(configPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("编码配置失败: %w", err)
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		return fmt.Errorf("写入配置文件失败: %w", err)
	}

	return nil
}

