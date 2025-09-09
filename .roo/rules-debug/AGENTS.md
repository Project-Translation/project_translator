# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 项目调试规则（仅非显而易见部分）

### 调试环境设置
- 启用调试模式：设置`projectTranslator.debug`为true
- 调试模式下会记录所有API请求和响应到输出通道
- 文件日志记录：通过`projectTranslator.logFile.enabled`启用

### 日志文件配置
- 日志文件默认位置：`.vscode/project-translator-logs/`
- 可通过`projectTranslator.logFile.path`自定义路径
- 支持日志轮转：`maxSizeKB`和`maxFiles`参数控制
- 调试信息会包含完整的API请求和响应JSON

### 输出通道使用
- 所有日志通过`logMessage()`函数输出到"Project Translator"输出通道
- 使用表情符号前缀分类日志消息（🔄、⏭️、❌等）
- 调试模式下会显示详细的token使用情况和处理时间

### 断点和调试技巧
- 在`translatorService.ts`中设置断点观察API调用
- 在`fileProcessor.ts`中观察文件处理流程
- 检查`translationDecisionCache`和`noTranslateCache`的缓存行为
- 监控`vendorLastRequest`的速率限制逻辑

### 常见调试场景
1. **翻译失败**：检查API密钥配置和网络连接
2. **文件跳过**：验证缓存机制和AI返回的UUID
3. **性能问题**：查看分块处理和token计数
4. **配置错误**：确认vendor配置和系统提示词

### 错误追踪
- 翻译失败的文件路径会记录到`failedFilePaths`数组
- 所有错误都会通过`vscode.window.showErrorMessage()`显示给用户
- 使用`LogFileManager`记录详细的错误堆栈和上下文

### 性能分析
- 查看每个文件的翻译耗时（日志中显示）
- 监控token使用效率（输入vs输出token比例）
- 分析缓存命中率以优化性能