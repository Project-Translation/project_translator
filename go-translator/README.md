# Go Translator

一个基于 OpenAI 兼容 API 的命令行翻译工具，提取自 project-translator 项目的核心翻译逻辑，采用子命令设计。

## 特性

- 支持多种 AI 供应商（DeepSeek、OpenAI、Grok 等）
- 流式和非流式两种翻译模式
- 自动判断是否需要翻译
- RPM 速率限制控制
- 配置文件管理
- 子命令界面设计
- 项目级别翻译（支持文件和文件夹配置）
- 从文本、文件或标准输入读取内容

## 安装

### 从源码构建

```bash
cd go-translator
go build -o translator ./cmd/translator
sudo mv translator /usr/local/bin/
```

## 配置

### 方法 1: 环境变量（推荐）

```bash
# DeepSeek API
export DEEPSEEK_API_KEY="your_api_key_here"

# OpenAI API
export OPENAI_API_KEY="your_api_key_here"
```

### 方法 2: 配置文件

初始化配置文件：

```bash
translator config init
```

默认会在当前项目目录生成 `project.translation.json`（与 VSCode 插件完全兼容）。

也可以手动创建 `project.translation.json`：

```json
{
  "currentVendor": "deepseek",
  "vendors": [
    {
      "name": "deepseek",
      "apiEndpoint": "https://api.deepseek.com/v1",
      "apiKeyEnvVarName": "DEEPSEEK_API_KEY",
      "model": "deepseek-chat",
      "rpm": 20,
      "timeout": 180,
      "temperature": 0.1,
      "top_p": 0.95,
      "streamMode": true
    }
  ],
  "specifiedFiles": [
    {
      "sourceFile": {
        "path": "README.md",
        "lang": "en-us"
      },
      "targetFiles": [
        {
          "path": "i18n/zh-cn/README.md",
          "lang": "zh-cn"
        }
      ]
    }
  ],
  "specifiedFolders": [
    {
      "sourceFolder": {
        "path": "src",
        "lang": "en-us"
      },
      "targetFolders": [
        {
          "path": "i18n/zh-cn/src",
          "lang": "zh-cn"
        }
      ]
    }
  ]
}
```

> 兼容说明：旧版 `~/.translator/config.json` 仍可通过 `-config` 显式指定使用。

## 命令使用

### 全局选项

```
translator [全局选项] <命令> [命令选项]

全局选项:
  -config string   配置文件路径
  -debug           启用调试模式
  -version         显示版本信息
```

### translate 命令

翻译文本、文件或整个项目。

```bash
# 翻译文本
translator translate text "Hello World" -from en -to zh-cn

# 从标准输入翻译
echo "Hello World" | translator translate text
cat input.txt | translator translate text -from en -to zh-cn

# 翻译文件
translator translate file input.txt -output output.txt

# 翻译整个项目（所有配置的文件和文件夹）
translator translate project

# 翻译配置的文件夹
translator translate folders
```

**translate 选项：**

| 选项 | 说明 |
|------|------|
| `-from` | 源语言（默认: auto） |
| `-to` | 目标语言（默认: zh-cn） |
| `-no-stream` | 禁用流式输出 |
| `-tokens` | 显示 token 使用统计 |
| `-output` | 输出文件路径 |

### add 命令

添加文件或文件夹到翻译配置。

```bash
# 添加文件
translator add file README.md -source-lang en -target-lang zh-cn

# 添加文件夹
translator add folder src/i18n -source-lang en -target-lang zh-tw

# 指定自定义目标路径
translator add file README.md -source-lang en -target-lang zh -target docs/zh/README.md
```

**add 选项：**

| 选项 | 说明 |
|------|------|
| `-source-lang` | 源语言（默认: en-us） |
| `-target-lang` | 目标语言（文件默认: zh-cn，文件夹默认: zh-tw） |
| `-target` | 目标路径（可选） |

### config 命令

管理配置。

```bash
# 显示当前配置
translator config show

# 以 JSON 格式显示配置
translator config show -json

# 显示配置文件路径
translator config path

# 导出配置到文件
translator config export -o project.translation.json

# 初始化配置文件
translator config init
```

## 使用示例

### 基础翻译

```bash
# 翻译文本
translator translate text "Hello, how are you?" -from en -to zh-cn

# 翻译文件
translator translate file README.md -output README_zh.md

# 从管道读取
cat document.txt | translator translate text -from en -to ja
```

### 项目翻译

```bash
# 1. 添加要翻译的文件
translator add file README.md -source-lang en -target-lang zh-cn

# 2. 添加要翻译的文件夹
translator add folder src/docs -source-lang en -target-lang zh-cn

# 3. 翻译整个项目
translator translate project
```

### 高级用法

```bash
# 查看配置
translator config show

# 使用自定义配置文件
translator -config /path/to/config.json translate text "Hello"

# 显示 token 使用统计
translator translate text "Hello" -tokens

# 禁用流式输出（等待完成后一次性显示）
translator translate text "Hello" -no-stream

# 翻译并保存到文件
translator translate file input.txt -output output.txt
```

## 项目结构

```
go-translator/
├── cmd/
│   └── translator/
│       ├── main.go          # 主入口
│       ├── root.go          # 根命令
│       ├── translate.go     # 翻译子命令
│       ├── add.go           # 添加子命令
│       └── config_cmd.go    # 配置子命令
├── internal/
│   ├── config/
│   │   └── config.go        # 配置管理
│   └── translator/
│       ├── translator.go    # 翻译服务
│       └── types.go         # 类型定义
├── go.mod
└── README.md
```

## 命令对照表

| VSCode 插件命令 | Go CLI 命令 | 说明 |
|-----------------|-------------|------|
| `extension.translateProject` | `translator translate project` | 翻译项目 |
| `extension.translateFiles` | `translator translate project` | 翻译指定文件 |
| `extension.translateFolders` | `translator translate folders` | 翻译指定文件夹 |
| `extension.addFileToTranslationSettings` | `translator add file` | 添加文件到配置 |
| `extension.addFolderToTranslationSettings` | `translator add folder` | 添加文件夹到配置 |
| `extension.exportSettingsToConfig` | `translator config export` | 导出配置 |
| N/A | `translator config show` | 显示配置 |
| N/A | `translator config init` | 初始化配置 |

## 配置项说明

### VendorConfig 供应商配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `name` | string | 供应商名称 |
| `apiEndpoint` | string | API 端点 |
| `apiKey` | string | API Key（可选） |
| `apiKeyEnvVarName` | string | API Key 环境变量名 |
| `model` | string | 模型名称 |
| `rpm` | int | 每分钟请求数限制 |
| `timeout` | int | 请求超时时间（秒） |
| `temperature` | float64 | 温度参数 |
| `top_p` | float64 | Top-P 采样参数 |
| `streamMode` | bool | 是否启用流式模式 |

### SpecifiedFile 指定文件配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `sourceFile.path` | string | 源文件路径 |
| `sourceFile.lang` | string | 源语言 |
| `targetFiles` | array | 目标文件数组 |

### SpecifiedFolder 指定文件夹配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `sourceFolder.path` | string | 源文件夹路径（空字符串表示项目根目录） |
| `sourceFolder.lang` | string | 源语言 |
| `targetFolders` | array | 目标文件夹数组 |

## 开发

### 运行

```bash
go run ./cmd/translator translate text "Hello"
```

### 构建

VSCode 中可通过 `Terminal > Run Task...` 执行以下任务：

| 任务 | 说明 |
|------|------|
| `go: build` | 生产构建（从 VERSION 注入版本号） |
| `go: build (dev)` | 开发构建（不注入版本号） |
| `go: clean` | 清理构建产物 |

命令行：

```bash
cd go-translator
go build -o translator ./cmd/translator
```

## 版本与发布

- Go CLI 的版本号来源于 `go-translator/VERSION` 文件（内容为 `x.y.z`，不带 `v` 前缀）。
- CI 会在 `go-translator/VERSION` 发生变化并合并到 `main` 后自动：
  - 创建并推送 git tag：`go-translator/vx.y.z`
  - 基于该 tag 发布 GitHub Release（并附带各平台构建产物）
- VSCode 插件仍使用 tag：`vx.y.z`（与 Go CLI 的 tag 前缀不同，避免互相干扰）。

本地构建如需注入版本号：

```bash
cd go-translator
VERSION="$(cat VERSION)"
go build -ldflags "-X main.Version=${VERSION}" -o translator ./cmd/translator
./translator -version
```

### 测试

#### 单元测试

VSCode 任务或命令行：

| 任务 | 说明 |
|------|------|
| `go: test` | 运行所有单元测试 |
| `go: test (cover)` | 运行测试并显示覆盖率 |
| `go: test (bench)` | 运行基准测试 |

```bash
cd go-translator
go test ./... -v
```

#### 集成测试（sample 目录）

项目提供了 `sample/` 目录作为集成测试数据，包含多种格式的文件和预配置的翻译规则（`project.translation.json`）。

| 任务 | 说明 |
|------|------|
| `go: test sample (project)` | 翻译 sample 中所有配置的文件和文件夹 |
| `go: test sample (folders)` | 仅翻译 sample 中配置的文件夹 |

以上任务会自动先执行 `go: build (dev)` 编译。

命令行运行：

```bash
# 设置 API Key
export DEEPSEEK_API_KEY="your_api_key"

cd go-translator && go build -o translator ./cmd/translator
cd ../sample
../go-translator/translator -config project.translation.json -debug translate project
```

sample 目录的 `project.translation.json` 配置了：
- **指定文件**: `translate_source.json`、`long-stream/news1.md`、`resource.resx`、`structure/md/should_skip.md`
- **指定文件夹**: `embeded` → `embeded/zh-cn`、`structure/json` → `i18n/zh-cn/structure/json`

## 依赖

- Go 1.21+
- 仅使用标准库，无外部依赖

## 与原插件的对比

| 特性 | VSCode 插件 | Go CLI |
|------|------------|--------|
| 翻译核心 | ✅ | ✅ |
| 流式输出 | ✅ | ✅ |
| RPM 限制 | ✅ | ✅ |
| 配置管理 | ✅ | ✅ |
| 项目翻译 | ✅ | ✅ |
| 子命令 | ❌ | ✅ |
| VSCode 集成 | ✅ | ❌ |
| 工作区感知 | ✅ | ❌ |
| 暂停/恢复 | ✅ | ❌ |

## License

MIT
