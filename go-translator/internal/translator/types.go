package translator

// AI 返回码
const (
	ReturnCodeOK              = "OK"
	ReturnCodeNoNeedTranslate = "727d2eb8-8683-42bd-a1d0-f604fcd82163"
)

// Message 聊天消息
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest 聊天请求
type ChatRequest struct {
	Model          string          `json:"model"`
	Messages       []Message       `json:"messages"`
	Temperature    *float64        `json:"temperature,omitempty"`
	TopP           *float64        `json:"top_p,omitempty"`
	Stream         bool            `json:"stream,omitempty"`
	ResponseFormat *ResponseFormat `json:"response_format,omitempty"`
}

type ResponseFormat struct {
	Type string `json:"type"`
}

// ChatResponse 聊天响应
type ChatResponse struct {
	ID      string   `json:"id"`
	Object  string   `json:"object"`
	Created int64    `json:"created"`
	Model   string   `json:"model"`
	Choices []Choice `json:"choices"`
	Usage   Usage    `json:"usage,omitempty"`
}

// Choice 选择项
type Choice struct {
	Index        int          `json:"index"`
	Message      DeltaMessage `json:"message,omitempty"`
	Delta        DeltaMessage `json:"delta,omitempty"`
	FinishReason string       `json:"finish_reason,omitempty"`
}

// DeltaMessage 增量消息（用于流式响应）
type DeltaMessage struct {
	Role    string `json:"role,omitempty"`
	Content string `json:"content,omitempty"`
}

// Usage 使用量统计
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// StreamChunk 流式响应块
type StreamChunk struct {
	ID      string         `json:"id"`
	Object  string         `json:"object"`
	Created int64          `json:"created"`
	Model   string         `json:"model"`
	Choices []ChoiceStream `json:"choices"`
}

// ChoiceStream 流式选择项
type ChoiceStream struct {
	Index        int          `json:"index"`
	Delta        DeltaMessage `json:"delta"`
	FinishReason *string      `json:"finish_reason"`
}

// ProgressCallback 进度回调函数
type ProgressCallback func(chunk string)

// TranslationResult 翻译结果
type TranslationResult struct {
	ReturnCode   string
	Content      string
	InputTokens  int
	OutputTokens int
}

// JSONDiffChange/JSONDiffResult match the extension's diff JSON protocol.
type JSONDiffChange struct {
	StartLine int    `json:"start_line"`
	Search    string `json:"search"`
	Replace   string `json:"replace"`
}

type JSONDiffResult struct {
	HasChanges bool             `json:"has_changes"`
	Changes    []JSONDiffChange `json:"changes"`
}
