# Debug模式使用说明

## 功能说明

项目翻译器提供两种模式的详细信息输出：

### Debug模式
当启用debug模式时，会打印详细的调试信息，但为了减少噪音，**不会打印Stream Chunk信息**。

### DiffApply模式
当启用diffApply功能时，会自动打印差异分析过程中的详细信息，包括：

1. **原始diff输出** - 显示git diff命令的原始输出
2. **解析后的diff信息** - 显示解析后的变更行详情
3. **差异翻译分析** - 显示差异翻译的详细过程
4. **提取的diff文本** - 显示需要翻译的具体文本内容

**注意**：当同时启用debug模式和diffApply时，diff信息会以debug格式显示（🐛 [DEBUG]前缀）；仅启用diffApply时，会以diff格式显示（📊 [DIFF]前缀）。

## 启用方法

### 方法1：通过VSCode设置界面

1. 打开VSCode设置 (Ctrl+,)
2. 搜索 "Project Translator"
3. 找到 "Debug" 选项
4. 勾选启用

### 方法2：通过settings.json

在VSCode的settings.json中添加：

```json
{
  "projectTranslator.debug": true
}
```

### 方法3：通过项目配置文件

在项目根目录的`project.translation.json`中添加：

```json
{
  "debug": true,
  "currentVendorName": "your-vendor",
  "vendors": [...],
  "diffApply": {
    "enabled": true,
    "strategy": "auto"
  }
}
```

## 输出示例

### Debug模式输出示例

启用debug模式后，在差异翻译过程中会看到类似以下的输出：

```
🐛 [DEBUG] Raw diff output:
--- DIFF START ---
@@ -1,3 +1,3 @@
 # Hello World
-This is old content
+This is new content
 Some unchanged line
--- DIFF END ---

🐛 [DEBUG] Parsed diff information:
  - Has changes: true
  - Changed lines count: 1
  - Context lines count: 2
  - Changed lines details:
    [1] Line 2: modified
        Old: "This is old content"
        New: "This is new content"

🐛 [DEBUG] Differential translation analysis:
  - Source file: /path/to/source.md
  - Target file: /path/to/target.md
  - Last commit ID: abc123
  - Diff strategy: auto
  - Has changes: true
  - Changed lines: 1

🐛 [DEBUG] Extracted diff text [1]:
  - Line 2: "This is new content"

🐛 [DEBUG] Total extracted diff texts: 1
```

### DiffApply模式输出示例

仅启用diffApply功能时，会看到类似以下的输出：

```
📊 [DIFF] Raw diff output:
--- DIFF START ---
@@ -1,3 +1,3 @@
 # Hello World
-This is old content
+This is new content
 Some unchanged line
--- DIFF END ---

📊 [DIFF] Parsed diff information:
  - Has changes: true
  - Changed lines count: 1
  - Context lines count: 2
  - Changed lines details:
    [1] Line 2: modified
        Old: "This is old content"
        New: "This is new content"

📊 [DIFF] Differential translation analysis:
  - Source file: /path/to/source.md
  - Target file: /path/to/target.md
  - Last commit ID: abc123
  - Diff strategy: auto
  - Has changes: true
  - Changed lines: 1

📊 [DIFF] Extracted diff text [1]:
  - Line 2: "This is new content"

📊 [DIFF] Total extracted diff texts: 1
```

## 注意事项

1. **性能影响**：debug模式会产生大量日志输出，可能影响翻译性能，建议仅在需要时启用
2. **敏感信息**：debug日志包含完整的文件内容和diff信息，请注意保护敏感内容
3. **日志量**：对于大文件或大量变更，debug输出可能会很多，建议在小范围测试时使用
4. **Stream Chunk**：为了减少噪音，debug模式下不会打印Stream Chunk信息，只会显示完整的响应内容
5. **DiffApply自动输出**：启用diffApply功能时会自动显示diff相关信息，无需额外配置debug模式

## 使用场景

### 1. 调试差异检测问题
- 验证git diff是否正确检测到文件变更
- 检查diff解析是否正确识别变更行

### 2. 优化翻译策略
- 查看实际提取的需要翻译的文本
- 验证差异翻译的范围是否合理

### 3. 开发和测试
- 验证配置是否正确传递
- 测试不同diff策略的效果
- 排查差异翻译相关问题