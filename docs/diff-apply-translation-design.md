# Diff Apply Translation - 技术设计文档

## 概述

Diff Apply Translation 是 Project Translator 扩展的一项高级功能，它通过差异化更新机制实现精确、高效的翻译更新。本文档详细说明了该功能的技术设计和实现原理。

## 核心概念

### 差异化翻译

传统翻译方法通常是将整个文件内容发送给翻译服务，然后用翻译结果完全替换目标文件。这种方法存在以下问题：

1. 对于大型文件，消耗大量 API token
2. 难以保持文件格式和结构
3. 对于已部分翻译的文件，会重复翻译已翻译内容
4. 版本控制系统中难以追踪具体变更

Diff Apply Translation 通过以下方式解决这些问题：

1. 仅发送需要翻译的源文件和目标文件内容
2. 要求 AI 生成精确的差异操作（增加、删除、更新）
3. 在目标文件上精确应用这些操作

## 系统架构

### 组件关系图

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  FileProcessor  │────▶│ TranslatorService│────▶│  OpenAI Service │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                        │
         ▼                       ▼                        ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ DiffApplyService │◀───│ DiffApplyRequest│────▶│DiffApplyResponse│
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

### 核心组件

1. **FileProcessor**: 处理文件翻译流程，决定是使用标准翻译还是差异化翻译
2. **TranslatorService**: 提供翻译服务接口，包括标准翻译和差异化翻译
3. **DiffApplyService**: 专门处理差异化翻译的服务，包括创建请求、解析响应和应用差异
4. **DiffApplyRequest**: 差异化翻译请求的数据结构
5. **DiffApplyResponse**: 差异化翻译响应的数据结构

## 数据流

### 差异化翻译流程

1. **请求创建**:
   - 读取源文件和目标文件内容
   - 创建包含两个文件内容和语言信息的 `DiffApplyRequest`

2. **翻译处理**:
   - 将请求发送给 AI 服务
   - AI 分析两个文件的差异
   - AI 生成精确的差异操作列表

3. **差异应用**:
   - 解析 AI 返回的差异操作
   - 验证操作的有效性和安全性
   - 在目标文件上应用这些操作
   - 生成更新后的文件内容

## 数据结构

### DiffApplyRequest

```typescript
interface DiffApplyRequest {
  sourceDocument: {
    content: string;
    language: string;
  };
  targetDocument: {
    content: string;
    language: string;
  };
  options?: {
    validationLevel?: 'strict' | 'normal' | 'loose';
    maxOperations?: number;
  };
}
```

### DiffApplyResponse

```typescript
interface DiffApplyResponse {
  status: 'success' | 'error';
  operations: DiffOperation[];
  metadata: {
    totalOperations: number;
    processingTime: number;
  };
  error?: {
    message: string;
    code: string;
  };
}
```

### DiffOperation

```typescript
type DiffOperation = 
  | { type: 'update'; lineNumber: number; content: string }
  | { type: 'insert'; lineNumber: number; content: string }
  | { type: 'delete'; lineNumber: number };
```

## AI 提示设计

为了获得高质量的差异操作，我们设计了专门的 AI 提示模板：

```
你是一个专业的翻译助手，擅长精确的文件翻译。

我将提供两个文件：
1. 源文件（${sourceLanguage}）
2. 目标文件（${targetLanguage}）

目标文件可能已经部分翻译。你的任务是：
1. 分析源文件和目标文件
2. 识别目标文件中需要翻译或更新的部分
3. 生成精确的差异操作，使目标文件成为源文件的完整翻译版本

请遵循以下规则：
- 保持代码块、标记和格式不变
- 只翻译自然语言文本
- 生成最少量的操作以实现完整翻译
- 返回 JSON 格式的差异操作列表

源文件内容：
${sourceContent}

目标文件内容：
${targetContent}

请返回以下 JSON 格式的响应：
{
  "status": "success",
  "operations": [
    { "type": "update", "lineNumber": 行号, "content": "更新后的内容" },
    { "type": "insert", "lineNumber": 行号, "content": "插入的内容" },
    { "type": "delete", "lineNumber": 行号 }
  ],
  "metadata": {
    "totalOperations": 操作总数,
    "processingTime": 处理时间(毫秒)
  }
}
```

## 验证机制

为确保差异操作的安全性和有效性，我们实现了多级验证：

### 验证级别

1. **严格 (strict)**:
   - 验证所有操作的行号是否在有效范围内
   - 验证操作后的文件长度变化是否合理
   - 验证操作是否会导致文件结构破坏
   - 限制单个文件的最大操作数

2. **普通 (normal)**:
   - 验证所有操作的行号是否在有效范围内
   - 限制单个文件的最大操作数

3. **宽松 (loose)**:
   - 基本验证操作的有效性
   - 允许更大范围的操作

## 错误处理

系统设计了完善的错误处理机制：

1. **请求创建错误**:
   - 文件读取失败
   - 文件编码问题

2. **AI 响应错误**:
   - 响应格式错误
   - 响应内容不完整

3. **差异应用错误**:
   - 操作验证失败
   - 文件写入失败

对于所有错误，系统会记录详细日志并提供回退机制，确保在差异化翻译失败时可以回退到标准翻译方法。

## 性能优化

### Token 使用优化

差异化翻译显著减少了 API token 使用：

- 只发送必要的文件内容
- 只返回差异操作，而非完整翻译
- 对于大型文件，节省可达 70-90% 的 token

### 处理速度优化

- 并行处理多个差异操作
- 缓存中间结果
- 优化文件读写操作

## 安全考虑

### 文件备份

系统自动创建目标文件的备份，格式为 `{filename}.backup.{timestamp}`，确保在操作失败时可以恢复原始文件。

### 操作限制

通过配置 `maxOperationsPerFile` 限制单个文件的最大操作数，防止恶意或错误的大量操作。

## 扩展性

系统设计考虑了未来扩展：

1. **支持更多操作类型**:
   - 块级操作
   - 格式化操作

2. **集成更多 AI 模型**:
   - 支持不同的 AI 提供商
   - 适配不同的模型特性

3. **增强用户界面**:
   - 可视化差异预览
   - 操作确认界面

## 结论

Diff Apply Translation 通过精确的差异化更新机制，显著提高了翻译效率和质量，特别适合大型项目和持续更新的文档。该功能的实现充分考虑了性能、安全性和用户体验，为 Project Translator 扩展提供了强大的高级翻译能力。