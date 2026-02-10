package translator

import (
	"strings"
	"testing"

	"github.com/project-translator/go-translator/internal/config"
)

func TestTranslator_New(t *testing.T) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	tr := NewTranslator(vendor, []string{}, []string{}, "en")

	if tr == nil {
		t.Fatal("NewTranslator 不应返回 nil")
	}

	if tr.vendor == nil {
		t.Error("vendor 不应为 nil")
	}

	if tr.client == nil {
		t.Error("client 不应为 nil")
	}
}

func TestTranslator_NewWithNilPrompts(t *testing.T) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	tr := NewTranslator(vendor, nil, nil, "en")

	if tr == nil {
		t.Fatal("NewTranslator 不应返回 nil")
	}

	if len(tr.systemPrompts) != 0 {
		t.Errorf("当传入 nil 时，systemPrompts 应为空数组，实际长度为 %d", len(tr.systemPrompts))
	}

	if len(tr.customPrompts) != 0 {
		t.Errorf("当传入 nil 时，customPrompts 应为空数组，实际长度为 %d", len(tr.customPrompts))
	}
}

func TestTranslator_GetTokenCounts(t *testing.T) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	tr := NewTranslator(vendor, []string{}, []string{}, "en")

	input, output, total := tr.GetTokenCounts()

	if input != 0 {
		t.Errorf("初始输入 tokens 应为 0，实际为 %d", input)
	}

	if output != 0 {
		t.Errorf("初始输出 tokens 应为 0，实际为 %d", output)
	}

	if total != 0 {
		t.Errorf("初始总 tokens 应为 0，实际为 %d", total)
	}
}

func TestTranslator_ResetTokenCounts(t *testing.T) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	tr := NewTranslator(vendor, []string{}, []string{}, "en")

	// 手动设置一些值（模拟已使用）
	tr.totalInputTokens = 100
	tr.totalOutputTokens = 50

	tr.ResetTokenCounts()

	input, output, total := tr.GetTokenCounts()

	if input != 0 || output != 0 || total != 0 {
		t.Error("ResetTokenCounts 后所有 token 计数应为 0")
	}
}

func TestBuildMessages_FirstSegment(t *testing.T) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	systemPrompts := []string{
		"You are a translator.",
		"Translate accurately.",
	}
	customPrompts := []string{
		"Keep the format.",
	}

	tr := NewTranslator(vendor, systemPrompts, customPrompts, "en")

	messages := tr.buildMessages("Hello world", "en", "zh", true)

	// 应该有: system(2合并+custom) + user(content) + user(instruction) = 3
	if len(messages) != 3 {
		t.Errorf("期望 3 条消息，实际为 %d", len(messages))
	}

	if messages[0].Role != "system" {
		t.Errorf("第一条消息角色应为 'system'，实际为 '%s'", messages[0].Role)
	}

	// 检查系统提示词是否包含两部分
	systemContent := messages[0].Content
	if systemContent == "" {
		t.Error("系统提示词不应为空")
	}
	if !strings.Contains(systemContent, "You are a translator.") || !strings.Contains(systemContent, "Translate accurately.") {
		t.Error("系统提示词应包含两部分系统提示词")
	}
	if !strings.Contains(systemContent, "Keep the format.") {
		t.Error("系统提示词应包含自定义提示词内容")
	}
}

func TestBuildMessages_SubsequentSegment(t *testing.T) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	systemPrompts := []string{
		"You are a translator.",
		"Translate accurately.",
	}
	customPrompts := []string{}

	tr := NewTranslator(vendor, systemPrompts, customPrompts, "en")

	// 后续片段只使用第一个系统提示词
	messages := tr.buildMessages("Hello world", "en", "zh", false)

	// 应该有: system(1) + user(content) + user(instruction) = 3
	if len(messages) != 3 {
		t.Errorf("期望 3 条消息，实际为 %d", len(messages))
	}

	// 检查系统提示词只包含第一部分
	systemContent := messages[0].Content
	expectedSystem := "You are a translator."
	if systemContent != expectedSystem {
		t.Errorf("后续片段系统提示词应为第一部分，期望 '%s'，实际为 '%s'", expectedSystem, systemContent)
	}
}

func TestBuildMessages_EmptyPrompts(t *testing.T) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	tr := NewTranslator(vendor, []string{}, []string{}, "en")

	messages := tr.buildMessages("Hello world", "en", "zh", true)

	// 应该有: system(empty) + user(content) + user(instruction) = 3
	if len(messages) != 3 {
		t.Errorf("期望 3 条消息，实际为 %d", len(messages))
	}

	// 第一条应该是空的系统消息
	if messages[0].Role != "system" {
		t.Errorf("第一条消息角色应为 'system'，实际为 '%s'", messages[0].Role)
	}

	// 第二条应该是用户内容
	if messages[1].Role != "user" || messages[1].Content != "Hello world" {
		t.Error("第二条消息应为包含内容的用户消息")
	}

	// 最后一条应包含翻译指令
	lastMsg := messages[len(messages)-1]
	if lastMsg.Content != "Please translate the preceding content from en to zh." {
		t.Errorf("最后一条消息应包含翻译指令，实际为 '%s'", lastMsg.Content)
	}
}

func TestBuildMessages_WithUserPrompts(t *testing.T) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	customPrompts := []string{
		"Keep the formatting.",
		"Preserve code blocks.",
	}

	tr := NewTranslator(vendor, []string{}, customPrompts, "en")

	messages := tr.buildMessages("Hello world", "en", "zh", true)

	systemContent := messages[0].Content
	if !strings.Contains(systemContent, "Keep the formatting.") {
		t.Error("系统提示词应包含第一个自定义提示词")
	}
	if !strings.Contains(systemContent, "Preserve code blocks.") {
		t.Error("系统提示词应包含第二个自定义提示词")
	}
}

func TestAIReturnCodes(t *testing.T) {
	// 测试返回码常量是否正确设置
	if ReturnCodeOK != "OK" {
		t.Errorf("ReturnCodeOK 应为 'OK'，实际为 '%s'", ReturnCodeOK)
	}

	if ReturnCodeNoNeedTranslate != "727d2eb8-8683-42bd-a1d0-f604fcd82163" {
		t.Errorf("ReturnCodeNoNeedTranslate 值不正确")
	}
}

func TestMessageStructure(t *testing.T) {
	msg := Message{
		Role:    "user",
		Content: "test content",
	}

	if msg.Role != "user" {
		t.Errorf("Role 应为 'user'，实际为 '%s'", msg.Role)
	}

	if msg.Content != "test content" {
		t.Errorf("Content 应为 'test content'，实际为 '%s'", msg.Content)
	}
}

func TestChatRequestStructure(t *testing.T) {
	temp := 0.1
	topP := 0.9

	req := ChatRequest{
		Model:       "gpt-4",
		Messages:    []Message{{Role: "user", Content: "hello"}},
		Temperature: &temp,
		TopP:        &topP,
		Stream:      false,
	}

	if req.Model != "gpt-4" {
		t.Errorf("Model 应为 'gpt-4'，实际为 '%s'", req.Model)
	}

	if req.Temperature == nil || *req.Temperature != 0.1 {
		t.Error("Temperature 应设置正确")
	}

	if req.TopP == nil || *req.TopP != 0.9 {
		t.Error("TopP 应设置正确")
	}

	if req.Stream {
		t.Error("Stream 应为 false")
	}
}

func TestTranslationResult(t *testing.T) {
	result := TranslationResult{
		ReturnCode:   ReturnCodeOK,
		Content:      "翻译内容",
		InputTokens:  10,
		OutputTokens: 20,
	}

	if result.ReturnCode != ReturnCodeOK {
		t.Errorf("ReturnCode 应为 '%s'，实际为 '%s'", ReturnCodeOK, result.ReturnCode)
	}

	if result.Content != "翻译内容" {
		t.Errorf("Content 应为 '翻译内容'，实际为 '%s'", result.Content)
	}

	if result.InputTokens != 10 {
		t.Errorf("InputTokens 应为 10，实际为 %d", result.InputTokens)
	}

	if result.OutputTokens != 20 {
		t.Errorf("OutputTokens 应为 20，实际为 %d", result.OutputTokens)
	}
}

// 基准测试
func BenchmarkBuildMessages(b *testing.B) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	systemPrompts := []string{
		"You are a translator.",
		"Translate accurately.",
	}

	tr := NewTranslator(vendor, systemPrompts, []string{}, "en")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tr.buildMessages("Test content for benchmarking the message building functionality.", "en", "zh", true)
	}
}

func BenchmarkGetTokenCounts(b *testing.B) {
	vendor := &config.VendorConfig{
		Name:    "test",
		Model:   "test-model",
		Timeout: 30,
	}

	tr := NewTranslator(vendor, []string{}, []string{}, "en")

	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		tr.GetTokenCounts()
	}
}
