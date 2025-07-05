# Debug模式使用说明

## 功能说明

项目翻译器提供详细的调试信息输出：

### Debug模式
当启用debug模式时，会打印详细的调试信息，但为了减少噪音，**不会打印Stream Chunk信息**。

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
  "vendors": [...]
}
```

## 输出示例

### Debug模式输出示例

启用debug模式后，会看到类似以下的输出：

```
🐛 [DEBUG] Translation request:
  - Source file: /path/to/source.md
  - Target file: /path/to/target.md
  - Vendor: openai
  - Model: gpt-4
  - Source language: en
  - Target language: zh-cn

🐛 [DEBUG] Translation response:
  - Status: success
  - Tokens used: 150
  - Response time: 2.3s
  - Content length: 500 chars
```

## 注意事项

1. **性能影响**：debug模式会产生大量日志输出，可能影响翻译性能，建议仅在需要时启用
2. **敏感信息**：debug日志包含完整的文件内容和翻译信息，请注意保护敏感内容
3. **日志量**：对于大文件或大量变更，debug输出可能会很多，建议在小范围测试时使用
4. **Stream Chunk**：为了减少噪音，debug模式下不会打印Stream Chunk信息，只会显示完整的响应内容

## 使用场景

### 1. 调试翻译问题
- 验证配置是否正确传递
- 查看翻译过程中的详细信息
- 排查翻译相关问题

### 2. 开发和测试
- 验证扩展功能是否正常工作
- 测试不同配置的效果
- 分析翻译性能和质量