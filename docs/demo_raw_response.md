# OpenAI API Debug功能演示

本文档演示如何使用Project Translator扩展的debug功能来查看OpenAI API的原始请求和响应数据。

## 功能概述

当启用debug模式时，扩展会将所有发往OpenAI API的请求和从API返回的响应数据打印到Output Channel中，方便开发者调试和分析API交互过程。

## 启用Debug模式

### 方法1：通过VSCode设置界面

1. 打开VSCode设置 (Ctrl+,)
2. 搜索 "Project Translator"
3. 找到 "Debug" 选项
4. 勾选启用debug模式

### 方法2：通过settings.json

在VSCode的settings.json中添加：

```json
{
  "projectTranslator.debug": true
}
```

### 方法3：通过项目配置文件

在项目根目录的`project.translation.json`文件中添加：

```json
{
  "debug": true,
  "currentVendor": "grok",
  "vendors": [
    {
      "name": "grok",
      "apiEndpoint": "https://api.x.ai/v1",
      "apiKey": "your-api-key",
      "model": "grok-2"
    }
  ]
}
```

## Debug日志内容

启用debug模式后，在翻译过程中会在Output Channel中看到以下类型的日志：

### 1. 标准API请求日志

```
🐛 [DEBUG] OpenAI API Request:
🐛 [DEBUG] {
  "model": "grok-2",
  "messages": [
    {
      "role": "system",
      "content": "You are a professional translator..."
    },
    {
      "role": "user",
      "content": "Please translate the preceding content..."
    }
  ],
  "temperature": 0
}
```

### 2. 标准API响应日志

```
🐛 [DEBUG] OpenAI API Response:
🐛 [DEBUG] {
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "grok-2",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "翻译后的内容..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 200,
    "total_tokens": 350
  }
}
```

### 3. 流式API请求日志

```
🐛 [DEBUG] OpenAI Streaming API Request:
🐛 [DEBUG] {
  "model": "grok-2",
  "messages": [...],
  "temperature": 0,
  "stream": true
}
```

### 4. 流式API响应块日志

```
🐛 [DEBUG] Stream Chunk: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"grok-2","choices":[{"index":0,"delta":{"content":"翻"}}]}
🐛 [DEBUG] Stream Chunk: {"id":"chatcmpl-xxx","object":"chat.completion.chunk","created":1234567890,"model":"grok-2","choices":[{"index":0,"delta":{"content":"译"}}]}
```

### 5. 完整流式响应日志

```
🐛 [DEBUG] Complete Streaming Response Content:
🐛 [DEBUG] 翻译后的完整内容...
🐛 [DEBUG] Total Stream Chunks: 25
```

## 查看Debug日志

1. 在VSCode中打开Output面板 (Ctrl+Shift+U)
2. 在下拉菜单中选择 "Project Translator"
3. 启动翻译任务
4. 观察详细的API交互日志

## 使用场景

### 1. 调试翻译质量问题
- 查看发送给API的完整prompt
- 分析API返回的原始响应
- 检查是否有特殊字符或格式问题

### 2. 监控API使用情况
- 查看实际的token消耗
- 分析请求和响应的大小
- 监控API调用频率

### 3. 开发和测试
- 验证配置是否正确传递给API
- 测试不同参数对翻译结果的影响
- 排查网络或API相关问题

## 注意事项

1. **性能影响**：debug模式会产生大量日志输出，可能影响翻译性能，建议仅在需要时启用

2. **敏感信息**：debug日志包含完整的API请求和响应，可能包含敏感内容，请注意保护

3. **日志大小**：长时间启用debug模式会产生大量日志，注意清理Output Channel

4. **生产环境**：建议在生产环境中关闭debug模式，避免不必要的性能开销

## 关闭Debug模式

将配置中的`debug`选项设置为`false`或删除该配置项即可关闭debug模式：

```json
{
  "projectTranslator.debug": false
}
```

## 技术实现

debug功能通过以下方式实现：

1. 在`package.json`中添加了`projectTranslator.debug`配置项
2. 在`config.ts`的`Config`接口中添加了`debug`字段
3. 在`translatorService.ts`中的API调用前后添加了debug日志输出
4. 支持标准API调用和流式API调用的debug日志

这样的设计确保了debug功能的完整性和易用性，帮助开发者更好地理解和调试翻译过程。