# Go Translator 测试文档

## 测试概览

本项目包含全面的单元测试和基准测试，覆盖核心功能和边界情况。

### 测试统计

```
ok  	github.com/project-translator/go-translator/cmd/translator
ok  	github.com/project-translator/go-translator/internal/config
ok  	github.com/project-translator/go-translator/internal/translator
```

## 测试模块

### 1. Config 模块测试 (`internal/config/config_test.go`)

#### 单元测试

- `TestLoadConfig_Default` - 测试默认配置加载
- `TestLoadConfig_FromFile` - 测试从文件加载配置
- `TestLoadConfig_InvalidJSON` - 测试无效 JSON 处理
- `TestGetCurrentVendor` - 测试获取当前供应商
- `TestGetCurrentVendor_NotFound` - 测试供应商不存在时的回退
- `TestGetCurrentVendor_NoVendors` - 测试无供应商配置
- `TestGetDefaultConfigPath` - 测试默认配置路径获取
- `TestSaveConfig` - 测试配置保存
- `TestGetAPIKey_FromEnvVar` - 测试从环境变量获取 API Key
- `TestGetAPIKey_FromConfig` - 测试从配置获取 API Key
- `TestGetAPIKey_ConfigPreferredOverEnv` - 测试 API Key 优先级
- `TestGetAPIKey_NotSet` - 测试 API Key 未设置
- `TestDefaultConfig` - 测试默认配置结构

#### 基准测试

```
BenchmarkLoadConfig-8   	   25234	     49437 ns/op	    8128 B/op	      25 allocs/op
BenchmarkSaveConfig-8   	    2456	    448855 ns/op	    8016 B/op	       7 allocs/op
```

### 2. Translator 模块测试 (`internal/translator/translator_test.go`)

#### 单元测试

- `TestTranslator_New` - 测试创建翻译器
- `TestTranslator_NewWithNilPrompts` - 测试使用 nil 提示词创建
- `TestTranslator_GetTokenCounts` - 测试获取 token 计数
- `TestTranslator_ResetTokenCounts` - 测试重置 token 计数
- `TestBuildMessages_FirstSegment` - 测试构建第一条消息
- `TestBuildMessages_SubsequentSegment` - 测试构建后续消息
- `TestBuildMessages_EmptyPrompts` - 测试空提示词时的消息构建
- `TestBuildMessages_WithUserPrompts` - 测试带用户提示词的消息构建
- `TestAIReturnCodes` - 测试 AI 返回码常量
- `TestMessageStructure` - 测试消息结构
- `TestChatRequestStructure` - 测试聊天请求结构
- `TestTranslationResult` - 测试翻译结果结构

#### 基准测试

```
BenchmarkBuildMessages-8    	 2315680	       500.9 ns/op	     336 B/op	       6 allocs/op
BenchmarkGetTokenCounts-8   	61322803	        18.91 ns/op	       0 B/op	       0 allocs/op
```

### 3. 命令行测试 (`cmd/translator/root_test.go`)

#### 单元测试

- `TestRootCommand_Version` - 测试版本显示
- `TestRootCommand_Help` - 测试帮助信息显示
- `TestRootCommand_UnknownCommand` - 测试未知命令处理
- `TestRootCommand_ConfigPath` - 测试配置路径设置
- `TestTranslateCommand_Help` - 测试翻译命令帮助
- `TestTranslateCommand_UnknownAction` - 测试翻译未知操作
- `TestAddCommand_Help` - 测试添加命令帮助
- `TestAddCommand_UnknownAction` - 测试添加未知操作
- `TestAddCommand_FileNotExists` - 测试添加不存在的文件
- `TestAddCommand_AddFile` - 测试成功添加文件
- `TestAddCommand_AddFolder` - 测试成功添加文件夹
- `TestConfigCommand_Help` - 测试配置命令帮助
- `TestConfigCommand_Path` - 测试配置路径显示
- `TestConfigCommand_Init` - 测试配置初始化
- `TestConfigCommand_InitForce` - 测试强制初始化
- `TestConfigCommand_Export` - 测试配置导出
- `TestWorkflow_CompleteTranslation` - 测试完整翻译工作流

#### 基准测试

```
BenchmarkRootCommandHelp-8    	    88953	     14283 ns/op	       0 B/op	       0 allocs/op
BenchmarkTranslateCommandHelp-8 	    75936	     16465 ns/op	       0 B/op	       0 allocs/op
BenchmarkAddCommandHelp-8       	 94933	     13078 ns/op	       0 B/op	       0 allocs/op
```

## 运行测试

### 运行所有测试

```bash
go test ./... -v
```

### 运行特定模块测试

```bash
# Config 模块
go test ./internal/config -v

# Translator 模块
go test ./internal/translator -v

# 命令行模块
go test ./cmd/translator -v
```

### 运行基准测试

```bash
go test ./... -bench=. -benchmem
```

### 运行特定测试

```bash
go test -run TestLoadConfig ./internal/config -v
```

### 测试覆盖率

```bash
go test ./... -cover
```

生成覆盖率报告：

```bash
go test ./... -coverprofile=coverage.out
go tool cover -html=coverage.out
```

## 测试覆盖率目标

| 模块 | 目标覆盖率 | 当前状态 |
|------|-----------|---------|
| config | >80% | ✅ |
| translator | >80% | ✅ |
| cmd/translator | >70% | ✅ |

## 性能基准

| 操作 | 性能 |
|------|------|
| 加载配置 | ~50μs/op |
| 保存配置 | ~450μs/op |
| 构建消息 | ~500ns/op |
| Token计数 | ~20ns/op |
| 命令行帮助 | ~15μs/op |

## 持续集成

测试应在以下情况下运行：

1. 每次代码提交前
2. Pull Request 创建时
3. 合并到主分支前

## 贡献指南

添加新功能时请确保：

1. 为新功能添加单元测试
2. 为边界情况添加测试
3. 更新此文档
4. 确保所有测试通过

```bash
# 运行完整测试套件
go test ./... -v -race -cover
```
