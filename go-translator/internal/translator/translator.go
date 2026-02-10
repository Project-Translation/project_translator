package translator

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/project-translator/go-translator/internal/config"
)

// Translator 翻译服务
type Translator struct {
	vendor            *config.VendorConfig
	client            *http.Client
	lastRequestTime   time.Time
	mu                sync.Mutex
	totalInputTokens  int
	totalOutputTokens int
	systemPrompts     []string
	customPrompts     []string
	systemPromptLang  string
}

// NewTranslator 创建翻译服务
func NewTranslator(vendor *config.VendorConfig, systemPrompts []string, customPrompts []string, systemPromptLanguage string) *Translator {
	timeout := time.Duration(vendor.Timeout) * time.Second
	if timeout == 0 {
		timeout = 180 * time.Second
	}

	if systemPrompts == nil {
		systemPrompts = []string{}
	}
	if customPrompts == nil {
		customPrompts = []string{}
	}

	normalizeLang := func(v string) string {
		s := strings.ToLower(strings.TrimSpace(v))
		if s == "zh" || strings.HasPrefix(s, "zh-") || strings.HasPrefix(s, "zh_") || s == "chinese" || s == "chs" {
			return "zh-cn"
		}
		return "en"
	}

	return &Translator{
		vendor:           vendor,
		client:           &http.Client{Timeout: timeout},
		systemPrompts:    systemPrompts,
		customPrompts:    customPrompts,
		systemPromptLang: normalizeLang(systemPromptLanguage),
	}
}

// TranslateContent 翻译内容
func (t *Translator) TranslateContent(
	content string,
	sourceLang string,
	targetLang string,
	isFirstSegment bool,
	progressCallback ProgressCallback,
) (*TranslationResult, error) {
	apiKey, err := t.vendor.GetAPIKey()
	if err != nil {
		return nil, fmt.Errorf("获取 API Key 失败: %w", err)
	}

	// 处理 RPM 限制
	if err := t.handleRpmLimit(); err != nil {
		return nil, err
	}

	// 构建消息
	messages := t.buildMessages(content, sourceLang, targetLang, isFirstSegment)

	// 创建请求
	temperature := t.vendor.Temperature

	req := ChatRequest{
		Model:       t.vendor.Model,
		Messages:    messages,
		Temperature: &temperature,
	}

	if t.vendor.TopP > 0 {
		req.TopP = &t.vendor.TopP
	}

	// 流式或标准翻译
	if t.vendor.StreamMode && progressCallback != nil {
		return t.streamTranslate(req, apiKey, content, progressCallback)
	}

	return t.standardTranslate(req, apiKey, content)
}

func buildDiffUserPrompt(systemPromptLang string, sourceLang string, targetLang string, sourcePath string) string {
	lang := strings.ToLower(strings.TrimSpace(systemPromptLang))
	if lang == "" {
		lang = "en"
	}
	if lang == "en" {
		return fmt.Sprintf(`# Differential Translation Task

## File Info

- **Source (SOURCE)**: %s (%s)
- **Target (TARGET)**: %s (%s)
- **Source language**: %s
- **Target language**: %s

## Goal

Compare SOURCE and TARGET, identify differences, and output JSON-formatted SEARCH/REPLACE operations to sync changes.

## Notes

1. **Translation quality**: accurate, natural, target-language appropriate
2. **Formatting**: preserve all formatting markers, indentation, blank lines
3. **Code**: keep code unchanged; only translate comments and documentation
4. **Proper nouns**: keep proper nouns, API names, technical terms
5. **JSON only**: output valid JSON only; do not add markdown fences or explanations
`, sourcePath, sourceLang, sourcePath, targetLang, sourceLang, targetLang)
	}
	return fmt.Sprintf(`# 差异化翻译任务

## 文件信息

- **源文件（SOURCE）**：%s (%s)
- **目标文件（TARGET）**：%s (%s)
- **源语言**：%s
- **目标语言**：%s

## 任务目标

对比SOURCE和TARGET，识别差异并生成JSON格式的SEARCH/REPLACE操作来同步变更。

## 执行步骤

### 步骤1：内容对比

- 逐段对比SOURCE和TARGET的内容
- 识别三种差异类型：
  - **新增**：SOURCE有但TARGET没有的内容
  - **修改**：SOURCE和TARGET都有但内容不同的部分
  - **删除**：TARGET有但SOURCE没有的内容

### 步骤2：生成JSON差异对象

为每个差异生成change对象：

**新增内容**：
- 在TARGET中找到合适的插入位置
- search匹配插入位置附近的现有内容
- replace包含现有文本+新增内容的翻译

**修改内容**：
- search精确匹配TARGET中的现有内容
- replace包含SOURCE内容的正确翻译

**删除内容**：
- search匹配TARGET中需要删除的内容
- replace设为空字符串

### 步骤3：验证输出

检查生成的JSON：
- 是否符合指定的JSON格式
- search是否精确匹配TARGET（包括空格、缩进、换行）
- replace是否是正确的翻译
- 是否包含所有必要的差异

### 步骤4：返回结果

输出完整的JSON对象，包含：
- has_changes: 布尔值，表示是否有变化
- changes: change对象数组

## 注意事项

1. **翻译质量**：确保翻译准确、自然、符合目标语言习惯
2. **格式保持**：保留所有格式标记、缩进、空行
3. **代码处理**：代码部分保持不变，只翻译注释和说明
4. **专有名词**：保留专有名词、API名称、技术术语
5. **JSON格式**：确保输出是有效的JSON，不要添加markdown围栏或其他说明

现在开始对比SOURCE和TARGET，生成JSON格式的差异对象。
	`, sourcePath, sourceLang, sourcePath, targetLang, sourceLang, targetLang)
}

// GenerateDiffJSON requests a JSON diff object (has_changes + changes[]).
// It mirrors the VSCode extension diff-apply protocol.
func (t *Translator) GenerateDiffJSON(
	sourceContent string,
	targetContent string,
	sourcePath string,
	sourceLang string,
	targetLang string,
	diffSystemPrompt string,
) (*JSONDiffResult, error) {
	apiKey, err := t.vendor.GetAPIKey()
	if err != nil {
		return nil, fmt.Errorf("获取 API Key 失败: %w", err)
	}
	if err := t.handleRpmLimit(); err != nil {
		return nil, err
	}

	temperature := t.vendor.Temperature
	req := ChatRequest{
		Model: t.vendor.Model,
		Messages: []Message{
			{
				Role: "system",
				Content: func() string {
					base := strings.Join(t.systemPrompts, "\n")
					if strings.TrimSpace(diffSystemPrompt) != "" {
						base += "\n" + diffSystemPrompt
					}
					if len(t.customPrompts) > 0 {
						if t.systemPromptLang == "en" {
							base += "\n\n# User Custom Translation Requirements\n\n"
						} else {
							base += "\n\n# 用户自定义翻译要求\n\n"
						}
						base += strings.Join(t.customPrompts, "\n\n")
					}
					return base
				}(),
			},
			{Role: "system", Content: buildDiffUserPrompt(t.systemPromptLang, sourceLang, targetLang, sourcePath)},
			{Role: "user", Content: fmt.Sprintf("SOURCE BEGIN\n%s\nSOURCE END", sourceContent)},
			{Role: "user", Content: fmt.Sprintf("TARGET BEGIN\n%s\nTARGET END", targetContent)},
		},
		Temperature:    &temperature,
		ResponseFormat: &ResponseFormat{Type: "json_object"},
	}
	if t.vendor.TopP > 0 {
		req.TopP = &t.vendor.TopP
	}

	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("编码请求失败: %w", err)
	}

	httpReq, err := http.NewRequest("POST", t.vendor.APIEndpoint+"/chat/completions", bytes.NewReader(reqJSON))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	resp, err := t.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API 错误 (状态码 %d): %s", resp.StatusCode, string(body))
	}

	var chatResp ChatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	t.mu.Lock()
	t.lastRequestTime = time.Now()
	inputTokens := chatResp.Usage.PromptTokens
	outputTokens := chatResp.Usage.CompletionTokens
	t.totalInputTokens += inputTokens
	t.totalOutputTokens += outputTokens
	t.mu.Unlock()

	if len(chatResp.Choices) == 0 {
		return &JSONDiffResult{HasChanges: false, Changes: []JSONDiffChange{}}, nil
	}

	content := strings.TrimSpace(chatResp.Choices[0].Message.Content)
	if content == "" {
		return &JSONDiffResult{HasChanges: false, Changes: []JSONDiffChange{}}, nil
	}

	var diff JSONDiffResult
	if err := json.Unmarshal([]byte(content), &diff); err != nil {
		log.Printf("diff JSON 解析失败: %v", err)
		return nil, fmt.Errorf("diff JSON 解析失败: %w", err)
	}
	if diff.Changes == nil {
		diff.Changes = []JSONDiffChange{}
	}
	return &diff, nil
}

// buildMessages 构建消息列表
func (t *Translator) buildMessages(content, sourceLang, targetLang string, isFirstSegment bool) []Message {
	// 系统提示词
	var systemPrompts []string
	if isFirstSegment && len(t.systemPrompts) >= 2 {
		systemPrompts = t.systemPrompts
	} else if len(t.systemPrompts) > 0 {
		systemPrompts = []string{t.systemPrompts[0]}
	} else {
		systemPrompts = []string{}
	}

	mergedSystemPrompt := strings.Join(systemPrompts, "\n")
	if len(t.customPrompts) > 0 {
		if t.systemPromptLang == "en" {
			mergedSystemPrompt += "\n\n# User Custom Translation Requirements\n\n"
		} else {
			mergedSystemPrompt += "\n\n# 用户自定义翻译要求\n\n"
		}
		mergedSystemPrompt += strings.Join(t.customPrompts, "\n\n")
	}

	messages := []Message{
		{Role: "system", Content: mergedSystemPrompt},
		{Role: "user", Content: content},
	}

	// 添加翻译指令
	messages = append(messages, Message{
		Role:    "user",
		Content: fmt.Sprintf("Please translate the preceding content from %s to %s.", sourceLang, targetLang),
	})

	return messages
}

// standardTranslate 标准翻译
func (t *Translator) standardTranslate(req ChatRequest, apiKey, originalContent string) (*TranslationResult, error) {
	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("编码请求失败: %w", err)
	}

	httpReq, err := http.NewRequest("POST", t.vendor.APIEndpoint+"/chat/completions", bytes.NewReader(reqJSON))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	startTime := time.Now()
	resp, err := t.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("读取响应失败: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("API 错误 (状态码 %d): %s", resp.StatusCode, string(body))
	}

	log.Printf("请求耗时: %v", time.Since(startTime))

	var chatResp ChatResponse
	if err := json.Unmarshal(body, &chatResp); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}

	t.mu.Lock()
	t.lastRequestTime = time.Now()
	inputTokens := chatResp.Usage.PromptTokens
	outputTokens := chatResp.Usage.CompletionTokens
	t.totalInputTokens += inputTokens
	t.totalOutputTokens += outputTokens
	t.mu.Unlock()

	log.Printf("完成 (输入: %d tokens, 输出: %d tokens)", inputTokens, outputTokens)

	if len(chatResp.Choices) == 0 {
		return &TranslationResult{
			ReturnCode: ReturnCodeOK,
			Content:    originalContent,
		}, nil
	}

	translatedContent := chatResp.Choices[0].Message.Content

	// 检查是否需要翻译
	if strings.Contains(translatedContent, ReturnCodeNoNeedTranslate) {
		log.Println("AI 指示此文件无需翻译")
		return &TranslationResult{
			ReturnCode: ReturnCodeNoNeedTranslate,
			Content:    originalContent,
		}, nil
	}

	return &TranslationResult{
		ReturnCode:   ReturnCodeOK,
		Content:      translatedContent,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
	}, nil
}

// streamTranslate 流式翻译
func (t *Translator) streamTranslate(req ChatRequest, apiKey, originalContent string, progressCallback ProgressCallback) (*TranslationResult, error) {
	req.Stream = true
	reqJSON, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("编码请求失败: %w", err)
	}

	httpReq, err := http.NewRequest("POST", t.vendor.APIEndpoint+"/chat/completions", bytes.NewReader(reqJSON))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

	startTime := time.Now()
	resp, err := t.client.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("请求失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("API 错误 (状态码 %d): %s", resp.StatusCode, string(body))
	}

	t.mu.Lock()
	t.lastRequestTime = time.Now()
	t.mu.Unlock()

	log.Println("开始流式翻译...")

	var fullContent strings.Builder
	uuidFirstPart := ReturnCodeNoNeedTranslate[:20]
	foundNoNeedTranslate := false

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}

		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}

		var chunk StreamChunk
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}

		if len(chunk.Choices) == 0 {
			continue
		}

		content := chunk.Choices[0].Delta.Content
		if content == "" {
			continue
		}

		fullContent.WriteString(content)
		currentContent := fullContent.String()

		// 检查是否包含无需翻译标记
		if !foundNoNeedTranslate && (strings.Contains(currentContent, ReturnCodeNoNeedTranslate) || strings.Contains(currentContent, uuidFirstPart)) {
			foundNoNeedTranslate = true
			log.Println("AI 指示无需翻译")
			break
		}

		if !strings.Contains(content, ReturnCodeNoNeedTranslate) && !strings.Contains(content, uuidFirstPart) {
			progressCallback(content)
		} else {
			// 处理包含 UUID 的分块
			idx := strings.Index(content, ReturnCodeNoNeedTranslate)
			if idx == -1 {
				idx = strings.Index(content, uuidFirstPart)
			}
			if idx > 0 {
				progressCallback(content[:idx])
			}
			foundNoNeedTranslate = true
			log.Println("AI 指示无需翻译")
			break
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("读取流失败: %w", err)
	}

	log.Printf("流式翻译完成，耗时: %v", time.Since(startTime))

	finalContent := fullContent.String()

	if foundNoNeedTranslate || strings.Contains(finalContent, ReturnCodeNoNeedTranslate) || strings.Contains(finalContent, uuidFirstPart) {
		return &TranslationResult{
			ReturnCode: ReturnCodeNoNeedTranslate,
			Content:    originalContent,
		}, nil
	}

	// 估算 token 数量
	estimatedInputTokens := 0
	for _, msg := range req.Messages {
		estimatedInputTokens += len(msg.Content) / 4
	}
	estimatedOutputTokens := len(finalContent) / 4

	t.mu.Lock()
	t.totalInputTokens += estimatedInputTokens
	t.totalOutputTokens += estimatedOutputTokens
	t.mu.Unlock()

	return &TranslationResult{
		ReturnCode:   ReturnCodeOK,
		Content:      finalContent,
		InputTokens:  estimatedInputTokens,
		OutputTokens: estimatedOutputTokens,
	}, nil
}

// handleRpmLimit 处理 RPM 限制
func (t *Translator) handleRpmLimit() error {
	if t.vendor.RPM <= 0 {
		return nil
	}

	t.mu.Lock()
	lastRequest := t.lastRequestTime
	t.mu.Unlock()

	now := time.Now()
	minInterval := time.Minute / time.Duration(t.vendor.RPM)
	timeToWait := minInterval - now.Sub(lastRequest)

	if timeToWait > 0 {
		log.Printf("等待 RPM 限制... (%v)", timeToWait.Round(time.Millisecond))
		time.Sleep(timeToWait)
	}

	return nil
}

// GetTokenCounts 获取 token 统计
func (t *Translator) GetTokenCounts() (input, output, total int) {
	t.mu.Lock()
	defer t.mu.Unlock()
	return t.totalInputTokens, t.totalOutputTokens, t.totalInputTokens + t.totalOutputTokens
}

// ResetTokenCounts 重置 token 统计
func (t *Translator) ResetTokenCounts() {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.totalInputTokens = 0
	t.totalOutputTokens = 0
}
