package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// VendorConfig AI 供应商配置（归一化后的有效配置）
type VendorConfig struct {
	Name                string  `json:"name"`
	APIEndpoint         string  `json:"apiEndpoint"`
	APIKey              string  `json:"apiKey,omitempty"`
	APIKeyEnvVarName    string  `json:"apiKeyEnvVarName,omitempty"`
	Model               string  `json:"model"`
	RPM                 int     `json:"rpm,omitempty"`
	MaxTokensPerSegment int     `json:"maxTokensPerSegment,omitempty"`
	Timeout             int     `json:"timeout,omitempty"`
	Temperature         float64 `json:"temperature,omitempty"`
	TopP                float64 `json:"top_p,omitempty"`
	StreamMode          bool    `json:"streamMode,omitempty"`
}

type rawVendorConfig struct {
	Name                string   `json:"name"`
	APIEndpoint         *string  `json:"apiEndpoint,omitempty"`
	APIKey              string   `json:"apiKey,omitempty"`
	APIKeyEnvVarName    *string  `json:"apiKeyEnvVarName,omitempty"`
	Model               *string  `json:"model,omitempty"`
	RPM                 *int     `json:"rpm,omitempty"`
	MaxTokensPerSegment *int     `json:"maxTokensPerSegment,omitempty"`
	Timeout             *int     `json:"timeout,omitempty"`
	Temperature         *float64 `json:"temperature,omitempty"`
	TopP                *float64 `json:"top_p,omitempty"`
	StreamMode          *bool    `json:"streamMode,omitempty"`
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
	SourceFile  SourceFileConfig `json:"sourceFile"`
	TargetFiles []TargetFile     `json:"targetFiles"`
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
	SourceFolder  SourceFolderConfig `json:"sourceFolder"`
	TargetFolders []DestFolder       `json:"targetFolders"`
}

// CopyOnlyConfig 完全复制（不翻译）的文件/目录配置
type CopyOnlyConfig struct {
	Paths      []string `json:"paths,omitempty"`
	Extensions []string `json:"extensions,omitempty"`
}

// IgnoreConfig 忽略（不复制、不翻译）的文件/目录配置
type IgnoreConfig struct {
	Paths      []string `json:"paths,omitempty"`
	Extensions []string `json:"extensions,omitempty"`
}

// FrontMatterMarker front matter 标记配置
type FrontMatterMarker struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// SkipFrontMatterConfig front matter 跳过配置
type SkipFrontMatterConfig struct {
	Enabled bool                `json:"enabled"`
	Markers []FrontMatterMarker `json:"markers,omitempty"`
}

// DiffApplyConfig 差异化翻译配置
type DiffApplyConfig struct {
	Enabled              bool   `json:"enabled"`
	ValidationLevel      string `json:"validationLevel,omitempty"`      // normal | strict
	AutoBackup           bool   `json:"autoBackup,omitempty"`           // default true
	MaxOperationsPerFile int    `json:"maxOperationsPerFile,omitempty"` // retained for compatibility
}

type rawDiffApplyConfig struct {
	Enabled              *bool   `json:"enabled,omitempty"`
	ValidationLevel      *string `json:"validationLevel,omitempty"`
	AutoBackup           *bool   `json:"autoBackup,omitempty"`
	MaxOperationsPerFile *int    `json:"maxOperationsPerFile,omitempty"`
}

// LogFileConfig 调试日志文件配置
type LogFileConfig struct {
	Enabled   bool   `json:"enabled"`
	Path      string `json:"path,omitempty"`
	MaxSizeKB int    `json:"maxSizeKB,omitempty"`
	MaxFiles  int    `json:"maxFiles,omitempty"`
}

type rawLogFileConfig struct {
	Enabled   *bool   `json:"enabled,omitempty"`
	Path      *string `json:"path,omitempty"`
	MaxSizeKB *int    `json:"maxSizeKB,omitempty"`
	MaxFiles  *int    `json:"maxFiles,omitempty"`
}

// Config 翻译器配置（对齐 VSCode 插件的 project.translation.json）
type Config struct {
	Vendors                 []VendorConfig        `json:"vendors"`
	CurrentVendorName       string                `json:"currentVendor,omitempty"`
	SpecifiedFiles          []SpecifiedFile       `json:"specifiedFiles,omitempty"`
	SpecifiedFolders        []SpecifiedFolder     `json:"specifiedFolders,omitempty"`
	TranslationIntervalDays int                   `json:"translationIntervalDays,omitempty"`
	CustomPrompts           []string              `json:"customPrompts,omitempty"`
	SegmentationMarkers     map[string][]string   `json:"segmentationMarkers,omitempty"`
	CopyOnly                CopyOnlyConfig        `json:"copyOnly,omitempty"`
	Ignore                  IgnoreConfig          `json:"ignore,omitempty"`
	DiffApply               DiffApplyConfig       `json:"diffApply,omitempty"`
	SkipFrontMatter         SkipFrontMatterConfig `json:"skipFrontMatter,omitempty"`
	Debug                   bool                  `json:"debug,omitempty"`
	LogFile                 LogFileConfig         `json:"logFile,omitempty"`
	SystemPromptLanguage    string                `json:"systemPromptLanguage,omitempty"`

	// Legacy fields (backward compatibility with early Go CLI configs)
	SystemPrompts []string `json:"systemPrompts,omitempty"`
	UserPrompts   []string `json:"userPrompts,omitempty"`

	// Runtime metadata (not serialized)
	ConfigPath    string `json:"-"`
	WorkspaceRoot string `json:"-"`
}

type rawConfig struct {
	Vendors                 []rawVendorConfig      `json:"vendors"`
	CurrentVendorName       string                 `json:"currentVendor,omitempty"`
	SpecifiedFiles          []SpecifiedFile        `json:"specifiedFiles,omitempty"`
	SpecifiedFolders        []SpecifiedFolder      `json:"specifiedFolders,omitempty"`
	TranslationIntervalDays *int                   `json:"translationIntervalDays,omitempty"`
	CustomPrompts           []string               `json:"customPrompts,omitempty"`
	SegmentationMarkers     map[string][]string    `json:"segmentationMarkers,omitempty"`
	CopyOnly                *CopyOnlyConfig        `json:"copyOnly,omitempty"`
	Ignore                  *IgnoreConfig          `json:"ignore,omitempty"`
	DiffApply               *rawDiffApplyConfig    `json:"diffApply,omitempty"`
	SkipFrontMatter         *SkipFrontMatterConfig `json:"skipFrontMatter,omitempty"`
	SkipFrontMatterMarkers  *SkipFrontMatterConfig `json:"skipFrontMatterMarkers,omitempty"`
	Debug                   bool                   `json:"debug,omitempty"`
	LogFile                 *rawLogFileConfig      `json:"logFile,omitempty"`
	SystemPromptLanguage    *string                `json:"systemPromptLanguage,omitempty"`

	// Legacy fields
	SystemPrompts []string `json:"systemPrompts,omitempty"`
	UserPrompts   []string `json:"userPrompts,omitempty"`
}

func normalizeConfigPath(p string) string {
	if p == "" {
		return p
	}
	return strings.ReplaceAll(p, "\\", "/")
}

func normalizeSystemPromptLanguage(v string) string {
	s := strings.ToLower(strings.TrimSpace(v))
	switch s {
	case "en", "en-us", "en_us", "english":
		return "en"
	case "zh", "zh-cn", "zh_cn", "zh-hans", "zh_hans", "chinese", "chs":
		return "zh-cn"
	default:
		return "en"
	}
}

func defaultVendorConfig() VendorConfig {
	return VendorConfig{
		Name:                "deepseek",
		APIEndpoint:         "https://api.deepseek.com/v1",
		APIKeyEnvVarName:    "DEEPSEEK_API_KEY",
		Model:               "deepseek-chat",
		RPM:                 20,
		MaxTokensPerSegment: 3000,
		Timeout:             180,
		Temperature:         0.1,
		TopP:                0.95,
		StreamMode:          true,
	}
}

func defaultCopyOnlyConfig() CopyOnlyConfig {
	return CopyOnlyConfig{
		Paths:      []string{},
		Extensions: []string{".svg"},
	}
}

func defaultIgnoreConfig() IgnoreConfig {
	return IgnoreConfig{
		Paths: []string{
			"**/node_modules/**",
			"**/.git/**",
			"**/.github/**",
			"**/.vscode/**",
			"**/.nuxt/**",
			"**/.next/**",
		},
		Extensions: []string{},
	}
}

func defaultDiffApplyConfig() DiffApplyConfig {
	return DiffApplyConfig{
		Enabled:              false,
		ValidationLevel:      "normal",
		AutoBackup:           true,
		MaxOperationsPerFile: 100,
	}
}

func defaultSkipFrontMatterConfig() SkipFrontMatterConfig {
	return SkipFrontMatterConfig{
		Enabled: false,
		Markers: []FrontMatterMarker{
			{Key: "draft", Value: "true"},
		},
	}
}

func defaultLogFileConfig() LogFileConfig {
	return LogFileConfig{
		Enabled:   false,
		MaxSizeKB: 10240,
		MaxFiles:  5,
	}
}

func normalizeEnvVarNameFromVendorName(name string) string {
	baseCandidate := strings.TrimSpace(name)
	if baseCandidate == "" {
		baseCandidate = "VENDOR"
	}
	var b strings.Builder
	for _, r := range baseCandidate {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteRune('_')
		}
	}
	return strings.ToUpper(b.String()) + "_API_KEY"
}

func normalizeVendors(vendors []rawVendorConfig) []VendorConfig {
	def := defaultVendorConfig()
	if len(vendors) == 0 {
		return []VendorConfig{def}
	}

	out := make([]VendorConfig, 0, len(vendors))
	for _, rv := range vendors {
		v := def
		if strings.TrimSpace(rv.Name) != "" {
			v.Name = strings.TrimSpace(rv.Name)
		}
		if rv.APIEndpoint != nil && strings.TrimSpace(*rv.APIEndpoint) != "" {
			v.APIEndpoint = strings.TrimSpace(*rv.APIEndpoint)
		}
		v.APIKey = rv.APIKey
		if rv.Model != nil && strings.TrimSpace(*rv.Model) != "" {
			v.Model = strings.TrimSpace(*rv.Model)
		}
		if rv.RPM != nil {
			v.RPM = *rv.RPM
		}
		if rv.MaxTokensPerSegment != nil {
			v.MaxTokensPerSegment = *rv.MaxTokensPerSegment
		}
		if rv.Timeout != nil {
			v.Timeout = *rv.Timeout
		}
		if rv.Temperature != nil {
			v.Temperature = *rv.Temperature
		}
		if rv.TopP != nil {
			v.TopP = *rv.TopP
		}
		if rv.StreamMode != nil {
			v.StreamMode = *rv.StreamMode
		}

		// Ensure apiKeyEnvVarName is present (even if user only provided name)
		if rv.APIKeyEnvVarName != nil && strings.TrimSpace(*rv.APIKeyEnvVarName) != "" {
			v.APIKeyEnvVarName = strings.TrimSpace(*rv.APIKeyEnvVarName)
		} else {
			v.APIKeyEnvVarName = normalizeEnvVarNameFromVendorName(v.Name)
		}

		out = append(out, v)
	}
	return out
}

func normalizeSpecifiedFiles(files []SpecifiedFile) []SpecifiedFile {
	if files == nil {
		return []SpecifiedFile{}
	}
	out := make([]SpecifiedFile, 0, len(files))
	for _, g := range files {
		g.SourceFile.Path = normalizeConfigPath(g.SourceFile.Path)
		for i := range g.TargetFiles {
			g.TargetFiles[i].Path = normalizeConfigPath(g.TargetFiles[i].Path)
		}
		out = append(out, g)
	}
	return out
}

func normalizeSpecifiedFolders(folders []SpecifiedFolder) []SpecifiedFolder {
	if folders == nil {
		return []SpecifiedFolder{}
	}
	out := make([]SpecifiedFolder, 0, len(folders))
	for _, g := range folders {
		g.SourceFolder.Path = normalizeConfigPath(g.SourceFolder.Path)
		for i := range g.TargetFolders {
			g.TargetFolders[i].Path = normalizeConfigPath(g.TargetFolders[i].Path)
		}
		out = append(out, g)
	}
	return out
}

func normalizeCopyOnly(cfg *CopyOnlyConfig) CopyOnlyConfig {
	if cfg == nil {
		return defaultCopyOnlyConfig()
	}
	out := CopyOnlyConfig{
		Paths:      cfg.Paths,
		Extensions: cfg.Extensions,
	}
	if out.Paths == nil {
		out.Paths = []string{}
	}
	if out.Extensions == nil {
		out.Extensions = []string{}
	}
	return out
}

func normalizeIgnore(cfg *IgnoreConfig) IgnoreConfig {
	if cfg == nil {
		return defaultIgnoreConfig()
	}
	out := IgnoreConfig{
		Paths:      cfg.Paths,
		Extensions: cfg.Extensions,
	}
	if out.Paths == nil {
		out.Paths = []string{}
	}
	if out.Extensions == nil {
		out.Extensions = []string{}
	}
	return out
}

func normalizeDiffApply(cfg *rawDiffApplyConfig) DiffApplyConfig {
	def := defaultDiffApplyConfig()
	if cfg == nil {
		return def
	}
	out := def
	if cfg.Enabled != nil {
		out.Enabled = *cfg.Enabled
	}
	if cfg.ValidationLevel != nil && strings.TrimSpace(*cfg.ValidationLevel) != "" {
		out.ValidationLevel = strings.TrimSpace(*cfg.ValidationLevel)
	}
	if cfg.AutoBackup != nil {
		out.AutoBackup = *cfg.AutoBackup
	}
	if cfg.MaxOperationsPerFile != nil {
		out.MaxOperationsPerFile = *cfg.MaxOperationsPerFile
	}
	return out
}

func normalizeSkipFrontMatter(cfg *SkipFrontMatterConfig, alias *SkipFrontMatterConfig) SkipFrontMatterConfig {
	def := defaultSkipFrontMatterConfig()
	if cfg == nil && alias == nil {
		return def
	}
	selected := cfg
	if selected == nil {
		selected = alias
	}
	if selected == nil {
		return def
	}
	out := *selected
	if out.Markers == nil {
		out.Markers = []FrontMatterMarker{}
	}
	return out
}

func normalizeLogFile(cfg *rawLogFileConfig) LogFileConfig {
	def := defaultLogFileConfig()
	if cfg == nil {
		return def
	}
	out := def
	if cfg.Enabled != nil {
		out.Enabled = *cfg.Enabled
	}
	if cfg.Path != nil {
		out.Path = *cfg.Path
	}
	if cfg.MaxSizeKB != nil {
		out.MaxSizeKB = *cfg.MaxSizeKB
	}
	if cfg.MaxFiles != nil {
		out.MaxFiles = *cfg.MaxFiles
	}
	return out
}

func normalizeRaw(raw rawConfig, configPath string, workspaceRoot string) *Config {
	cfg := &Config{
		Vendors:                 normalizeVendors(raw.Vendors),
		CurrentVendorName:       raw.CurrentVendorName,
		SpecifiedFiles:          normalizeSpecifiedFiles(raw.SpecifiedFiles),
		SpecifiedFolders:        normalizeSpecifiedFolders(raw.SpecifiedFolders),
		CustomPrompts:           raw.CustomPrompts,
		SegmentationMarkers:     raw.SegmentationMarkers,
		CopyOnly:                normalizeCopyOnly(raw.CopyOnly),
		Ignore:                  normalizeIgnore(raw.Ignore),
		DiffApply:               normalizeDiffApply(raw.DiffApply),
		SkipFrontMatter:         normalizeSkipFrontMatter(raw.SkipFrontMatter, raw.SkipFrontMatterMarkers),
		Debug:                   raw.Debug,
		LogFile:                 normalizeLogFile(raw.LogFile),
		SystemPromptLanguage:    "",
		SystemPrompts:           raw.SystemPrompts,
		UserPrompts:             raw.UserPrompts,
		ConfigPath:              configPath,
		WorkspaceRoot:           workspaceRoot,
		TranslationIntervalDays: -1,
	}

	if cfg.CurrentVendorName == "" {
		cfg.CurrentVendorName = defaultVendorConfig().Name
	}
	if raw.TranslationIntervalDays != nil {
		cfg.TranslationIntervalDays = *raw.TranslationIntervalDays
	}
	if cfg.CustomPrompts == nil {
		cfg.CustomPrompts = []string{}
	}
	if cfg.SegmentationMarkers == nil {
		cfg.SegmentationMarkers = map[string][]string{}
	}
	rawLang := ""
	if raw.SystemPromptLanguage != nil {
		rawLang = *raw.SystemPromptLanguage
	}
	cfg.SystemPromptLanguage = normalizeSystemPromptLanguage(rawLang)

	return cfg
}

// LoadConfig 从配置文件加载配置
// - 当 configPath 为空时，返回默认配置（不读取文件）
// - 当 configPath 指定但文件不存在/不可读时，返回默认配置
// - 当 JSON 无法解析时，返回错误
func LoadConfig(configPath string) (*Config, error) {
	workspaceRoot := ""
	absPath := ""
	if strings.TrimSpace(configPath) != "" {
		p := filepath.Clean(configPath)
		ap, err := filepath.Abs(p)
		if err != nil {
			absPath = p
		} else {
			absPath = ap
		}
		workspaceRoot = filepath.Dir(absPath)
	} else {
		wd, err := os.Getwd()
		if err == nil {
			workspaceRoot = wd
		}
	}

	if absPath != "" {
		data, err := os.ReadFile(absPath)
		if err == nil {
			var raw rawConfig
			if err := json.Unmarshal(data, &raw); err != nil {
				return nil, fmt.Errorf("解析配置文件失败: %w", err)
			}
			return normalizeRaw(raw, absPath, workspaceRoot), nil
		}
	}

	cfg := DefaultConfig()
	cfg.ConfigPath = absPath
	cfg.WorkspaceRoot = workspaceRoot
	return cfg, nil
}

// DefaultConfig 返回默认配置（对齐插件默认值）
func DefaultConfig() *Config {
	defVendor := defaultVendorConfig()
	return &Config{
		Vendors:                 []VendorConfig{defVendor},
		CurrentVendorName:       defVendor.Name,
		SpecifiedFiles:          []SpecifiedFile{},
		SpecifiedFolders:        []SpecifiedFolder{},
		TranslationIntervalDays: -1,
		CustomPrompts:           []string{},
		SegmentationMarkers:     map[string][]string{},
		CopyOnly:                defaultCopyOnlyConfig(),
		Ignore:                  defaultIgnoreConfig(),
		DiffApply:               defaultDiffApplyConfig(),
		SkipFrontMatter:         defaultSkipFrontMatterConfig(),
		Debug:                   false,
		LogFile:                 defaultLogFileConfig(),
		SystemPromptLanguage:    "en",
	}
}

// GetCurrentVendor 获取当前供应商配置
func (c *Config) GetCurrentVendor() (*VendorConfig, error) {
	vendorName := c.CurrentVendorName
	if strings.TrimSpace(vendorName) == "" {
		vendorName = defaultVendorConfig().Name
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
	if strings.TrimSpace(v.APIKey) != "" {
		return v.APIKey, nil
	}

	// 从环境变量获取
	if strings.TrimSpace(v.APIKeyEnvVarName) != "" {
		apiKey := os.Getenv(v.APIKeyEnvVarName)
		if apiKey != "" {
			return apiKey, nil
		}
		return "", fmt.Errorf("环境变量 %s 未设置", v.APIKeyEnvVarName)
	}

	return "", fmt.Errorf("API Key 未配置")
}

const ProjectConfigFileName = "project.translation.json"

// FindProjectConfigPath 查找就近的 project.translation.json（向上递归父目录）
func FindProjectConfigPath(startDir string) (string, bool) {
	dir := strings.TrimSpace(startDir)
	if dir == "" {
		if wd, err := os.Getwd(); err == nil {
			dir = wd
		}
	}
	if dir == "" {
		return "", false
	}

	if abs, err := filepath.Abs(dir); err == nil {
		dir = abs
	}

	for {
		candidate := filepath.Join(dir, ProjectConfigFileName)
		if st, err := os.Stat(candidate); err == nil && st.Mode().IsRegular() {
			return candidate, true
		}

		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", false
}

// GetLegacyConfigPath 获取旧版 Go CLI 默认配置路径（~/.translator/config.json）
func GetLegacyConfigPath() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, ".translator", "config.json")
}

// GetDefaultConfigPath 获取默认配置文件路径（优先使用项目级 project.translation.json）
func GetDefaultConfigPath() string {
	if wd, err := os.Getwd(); err == nil && wd != "" {
		if p, ok := FindProjectConfigPath(wd); ok {
			return p
		}
		return filepath.Join(wd, ProjectConfigFileName)
	}
	return ProjectConfigFileName
}

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

// ResolvePromptsDir tries to find the shared prompts directory.
// Preference:
// 1) workspaceRoot/prompts
// 2) current working directory/prompts
func ResolvePromptsDir(workspaceRoot string) (string, bool) {
	probeFiles := []string{
		"system_prompt_part1.en.md",
		"system_prompt_part1.md",
	}
	candidates := []string{}
	if strings.TrimSpace(workspaceRoot) != "" {
		candidates = append(candidates, filepath.Join(workspaceRoot, "prompts"))
	}
	if wd, err := os.Getwd(); err == nil && wd != "" {
		candidates = append(candidates, filepath.Join(wd, "prompts"))
	}

	for _, dir := range candidates {
		for _, probe := range probeFiles {
			if _, err := os.Stat(filepath.Join(dir, probe)); err == nil {
				return dir, true
			}
		}
	}
	return "", false
}

const (
	systemPromptPart1Base = "system_prompt_part1"
	systemPromptPart2Base = "system_prompt_part2"
	diffSystemPromptBase  = "diff_system_prompt"
)

func promptFileName(base string, lang string) string {
	if normalizeSystemPromptLanguage(lang) == "en" {
		return base + ".en.md"
	}
	return base + ".md"
}

func readPromptWithFallback(promptsDir string, base string, lang string) (string, error) {
	primary := promptFileName(base, lang)
	b, err := os.ReadFile(filepath.Join(promptsDir, primary))
	if err == nil && strings.TrimSpace(string(b)) != "" {
		return string(b), nil
	}
	// Fallback to the other language file
	fallbackLang := "zh-cn"
	if normalizeSystemPromptLanguage(lang) == "zh-cn" {
		fallbackLang = "en"
	}
	fallback := promptFileName(base, fallbackLang)
	b2, err2 := os.ReadFile(filepath.Join(promptsDir, fallback))
	if err2 != nil {
		// Prefer returning the primary error if it exists.
		if err != nil {
			return "", err
		}
		return "", err2
	}
	return string(b2), nil
}

func LoadSystemPromptPartsWithLanguage(promptsDir string, lang string) (part1 string, part2 string, err error) {
	p1, err := readPromptWithFallback(promptsDir, systemPromptPart1Base, lang)
	if err != nil {
		return "", "", err
	}
	p2, err := readPromptWithFallback(promptsDir, systemPromptPart2Base, lang)
	if err != nil {
		return "", "", err
	}
	return p1, p2, nil
}

// LoadSystemPromptParts 保持兼容：默认按英文加载（若缺失则回退到中文）。
func LoadSystemPromptParts(promptsDir string) (part1 string, part2 string, err error) {
	return LoadSystemPromptPartsWithLanguage(promptsDir, "en")
}

func LoadDiffSystemPromptWithLanguage(promptsDir string, lang string) (string, error) {
	return readPromptWithFallback(promptsDir, diffSystemPromptBase, lang)
}

// LoadDiffSystemPrompt 保持兼容：默认按英文加载（若缺失则回退到中文）。
func LoadDiffSystemPrompt(promptsDir string) (string, error) {
	return LoadDiffSystemPromptWithLanguage(promptsDir, "en")
}
