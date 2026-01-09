# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## 构建和测试命令

### 构建命令

- `npm run build` - 生产环境构建（使用 esbuild 压缩）
  - **用途**：发布到 VSCode 扩展市场前的最终构建
  - **特点**：启用代码压缩、禁用 source map、将所有依赖打包成单个文件 `out/extension.js`
  - **输出**：体积最小化的生产代码，适合发布
  - **相关命令**：`publish:minor`、`publish:patch`、`package` 都会调用此命令

- `npm run compile` - 开发环境编译（不压缩）
  - **用途**：日常开发调试
  - **特点**：不压缩代码、启用 source map、打包成单个文件
  - **输出**：可读性好的代码，便于调试

- `npm run compile-tsc` - 使用 TypeScript 编译器编译（不打包）
  - **用途**：开发调试和运行测试
  - **特点**：不压缩、启用 source map、按文件分别编译（不打包）
  - **输出**：`out/` 目录下多个 `.js` 文件，每个源文件对应一个编译文件
  - **相关命令**：`npm run test` 会先执行此命令

### 监听和测试命令

- `npm run watch` - esbuild 监听模式编译
  - **用途**：开发时自动监听文件变化并重新构建
  - **特点**：文件修改后自动触发 esbuild 重新编译

- `npm run watch-tsc` - TypeScript 编译器监听模式
  - **用途**：开发时自动监听文件变化并重新编译
  - **特点**：文件修改后自动触发 tsc 重新编译

- `npm run lint` - 运行 ESLint 检查
  - **用途**：代码质量检查
  - **特点**：检查 `src/` 目录下的所有 TypeScript 文件

- `npm run test` - 运行测试（先编译再执行 simpleRunner）
  - **用途**：执行单元测试和集成测试
  - **特点**：先执行 `compile-tsc` 编译测试代码，然后运行 `simpleRunner.js`
  - **测试位置**：单元测试在 `services/` 目录，集成测试在 `integration/` 目录

## 项目特定的非显而易见信息

### 核心架构模式

- VSCode 扩展，使用 OpenAI 兼容的 API 进行翻译
- 翻译决策基于文件哈希、时间间隔和配置的缓存机制
- 支持流式和标准两种翻译模式

### 关键约定和模式

#### 特殊返回码机制

- AI 返回`727d2eb8-8683-42bd-a1d0-f604fcd82163`表示"无需翻译"
- 此 UUID 硬编码在系统提示词中，用于 AI 指示不需要翻译的情况
- 检测到此返回码时，系统会直接复制原文件而不进行翻译

#### 缓存策略

- `translationDecisionCache`: 5 分钟有效的翻译决策缓存（避免重复检查）
- `noTranslateCache`: 会话级别的"无需翻译"文件缓存
- `vendorLastRequest`: 供应商 API 请求时间戳缓存（用于速率限制）
- 翻译数据库使用`.translation-cache`目录存储每种语言的翻译记录

#### 文件处理逻辑

- 二进制文件直接复制，不进行翻译
- 文本文件根据扩展名映射到相应的分词标记
- 支持 front matter 跳过机制（基于配置的标记）
- 大文件自动分块处理（基于 maxTokensPerSegment 配置）

#### 错误处理约定

- 使用`logMessage()`函数统一日志记录（支持不同级别）
- 所有错误都通过`vscode.window.showErrorMessage()`显示给用户
- 翻译失败时文件会被记录到`failedFilePaths`数组中
- 支持用户取消操作（通过 vscode.CancellationToken）

#### 配置系统特点

- 支持多个翻译供应商配置
- API 密钥支持环境变量注入（通过`apiKeyEnvVarName`）
- 默认供应商是 DeepSeek，配置了环境变量`DEEPSEEK_API_KEY`
- 系统提示词硬编码在 config.ts 中，包含严格的格式保持要求

#### 代码风格特定规则

- 使用 ESLint + TypeScript 严格模式
- 使用`@typescript-eslint/naming-convention`进行命名规范
- 忽略`out/`、`dist/`和`*.d.ts`文件的检查

#### 本地化处理

- 使用 VSCode 的 l10n 系统，支持多语言
- 语言代码验证：任何长度小于 10 字符的字符串都是有效语言代码
- 默认支持 11 种语言，但系统接受任意有效的语言代码
- 只需要关注英文(en-us)的本地化，其他语言的本地化不需要关注,其他语言的本地化由翻译供应商完成

#### 调试和日志

- 支持文件日志记录（通过`LogFileManager`）
- 日志文件默认位置：`.vscode/project-translator-logs/`
- 调试模式下会记录所有 API 请求和响应
- 使用表情符号前缀分类日志消息（🔄、⏭️、❌ 等）
