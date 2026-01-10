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
	vendor           *config.VendorConfig
	client           *http.Client
	lastRequestTime  time.Time
	mu               sync.Mutex
	totalInputTokens  int
	totalOutputTokens int
	systemPrompts    []string
	userPrompts      []string
}

// NewTranslator 创建翻译服务
func NewTranslator(vendor *config.VendorConfig, systemPrompts, userPrompts []string) *Translator {
	timeout := time.Duration(vendor.Timeout) * time.Second
	if timeout == 0 {
		timeout = 30 * time.Second
	}

	if systemPrompts == nil {
		systemPrompts = []string{}
	}
	if userPrompts == nil {
		userPrompts = []string{}
	}

	return &Translator{
		vendor:        vendor,
		client:        &http.Client{Timeout: timeout},
		systemPrompts: systemPrompts,
		userPrompts:   userPrompts,
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
	if temperature == 0 {
		temperature = 0.7
	}

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

	messages := []Message{
		{Role: "system", Content: mergedSystemPrompt},
		{Role: "user", Content: content},
	}

	// 添加用户自定义提示词
	for _, prompt := range t.userPrompts {
		messages = append(messages, Message{
			Role:    "user",
			Content: prompt,
		})
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
