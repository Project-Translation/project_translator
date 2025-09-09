# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 项目编码规则（仅非显而易见部分）

### 核心编码约定
- 使用`logMessage()`函数统一日志记录，而不是console.log（支持不同级别和表情符号前缀）
- 所有错误必须通过`vscode.window.showErrorMessage()`显示给用户
- 翻译失败时文件必须记录到`failedFilePaths`数组中

### 特殊返回码处理
- AI返回`727d2eb8-8683-42bd-a1d0-f604fcd82163`表示"无需翻译"
- 检测到此返回码时，必须直接复制原文件而不进行翻译
- 此UUID硬编码在系统提示词中，不能修改

### 缓存机制使用
- `translationDecisionCache`: 5分钟有效的翻译决策缓存，避免重复检查
- `noTranslateCache`: 会话级别的"无需翻译"文件缓存
- `vendorLastRequest`: 供应商API请求时间戳缓存，用于速率限制
- 翻译数据库使用`.translation-cache`目录存储每种语言的翻译记录

### 文件处理规则
- 二进制文件直接复制，不进行翻译（使用isBinaryFile检测）
- 文本文件根据扩展名映射到相应的分词标记（见segmentationUtils.ts）
- 支持front matter跳过机制（基于配置的标记）
- 大文件自动分块处理（基于maxTokensPerSegment配置）

### 错误处理模式
- 使用vscode.CancellationToken支持用户取消操作
- 在关键操作前调用`checkCancellation()`检查取消状态
- 所有异步操作必须正确处理CancellationError

### 配置系统使用
- API密钥支持环境变量注入（通过`apiKeyEnvVarName`）
- 默认供应商是DeepSeek，配置了环境变量`DEEPSEEK_API_KEY`
- 系统提示词硬编码在config.ts中，包含严格的格式保持要求

### 流式翻译处理
- 流式模式下需要检测部分UUID返回码（前20个字符）
- 必须处理流式响应中的分块内容
- 流式和非流式模式有不同的错误处理逻辑

### 测试特定规则
- 测试文件必须编译到`out/test/`目录才能运行
- 使用`simpleRunner.ts`提供无需VSCode GUI的测试运行方式
- 单元测试在services/目录，集成测试在integration/目录