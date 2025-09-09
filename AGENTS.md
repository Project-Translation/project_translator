# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 构建和测试命令

- `npm run build` - 生产环境构建（使用esbuild压缩）
- `npm run compile` - 开发环境编译（不压缩）
- `npm run watch` - 监听模式编译
- `npm run lint` - 运行ESLint检查
- `npm run test` - 运行测试（先编译再执行simpleRunner）
- `npm run compile-tsc` - 使用TypeScript编译器编译（不打包）
- `npm run watch-tsc` - TypeScript编译器监听模式

## 项目特定的非显而易见信息

### 核心架构模式
- VSCode扩展，使用OpenAI兼容的API进行翻译
- 翻译决策基于文件哈希、时间间隔和配置的缓存机制
- 支持流式和标准两种翻译模式

### 关键约定和模式

#### 特殊返回码机制
- AI返回`727d2eb8-8683-42bd-a1d0-f604fcd82163`表示"无需翻译"
- 此UUID硬编码在系统提示词中，用于AI指示不需要翻译的情况
- 检测到此返回码时，系统会直接复制原文件而不进行翻译

#### 缓存策略
- `translationDecisionCache`: 5分钟有效的翻译决策缓存（避免重复检查）
- `noTranslateCache`: 会话级别的"无需翻译"文件缓存
- `vendorLastRequest`: 供应商API请求时间戳缓存（用于速率限制）
- 翻译数据库使用`.translation-cache`目录存储每种语言的翻译记录

#### 文件处理逻辑
- 二进制文件直接复制，不进行翻译
- 文本文件根据扩展名映射到相应的分词标记
- 支持front matter跳过机制（基于配置的标记）
- 大文件自动分块处理（基于maxTokensPerSegment配置）

#### 错误处理约定
- 使用`logMessage()`函数统一日志记录（支持不同级别）
- 所有错误都通过`vscode.window.showErrorMessage()`显示给用户
- 翻译失败时文件会被记录到`failedFilePaths`数组中
- 支持用户取消操作（通过vscode.CancellationToken）

#### 配置系统特点
- 支持多个翻译供应商配置
- API密钥支持环境变量注入（通过`apiKeyEnvVarName`）
- 默认供应商是DeepSeek，配置了环境变量`DEEPSEEK_API_KEY`
- 系统提示词硬编码在config.ts中，包含严格的格式保持要求

#### 测试架构
- 使用Mocha测试框架
- 测试分为：纯单元测试（services/*.test.js）和集成测试
- `simpleRunner.ts`提供无需VSCode GUI的测试运行方式
- 测试文件必须编译到`out/test/`目录才能运行

#### 代码风格特定规则
- 使用ESLint + TypeScript严格模式
- 禁用分号（`semi: 'off'`）
- 强制花括号（`curly: 'warn'`）
- 使用`@typescript-eslint/naming-convention`进行命名规范
- 忽略`out/`、`dist/`和`*.d.ts`文件的检查

#### 本地化处理
- 使用VSCode的l10n系统，支持多语言
- 语言代码验证：任何长度小于10字符的字符串都是有效语言代码
- 默认支持11种语言，但系统接受任意有效的语言代码

#### 调试和日志
- 支持文件日志记录（通过`LogFileManager`）
- 日志文件默认位置：`.vscode/project-translator-logs/`
- 调试模式下会记录所有API请求和响应
- 使用表情符号前缀分类日志消息（🔄、⏭️、❌等）