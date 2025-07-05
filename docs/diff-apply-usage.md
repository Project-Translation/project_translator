# Diff Apply Translation Usage Guide

## Overview

Diff Apply is an advanced translation mode that provides precise, line-by-line translation updates using differential operations. Instead of translating entire files, it analyzes differences between source and target documents and applies only necessary changes.

## Key Benefits

- **Precision**: Only translates content that has actually changed
- **Efficiency**: Reduces API calls and costs for large files
- **Version Control Friendly**: Generates minimal, targeted changes
- **Format Preservation**: Maintains exact document structure and formatting
- **Incremental Updates**: Perfect for maintaining translated documentation

## Configuration

### Enable Diff Apply Mode

1. Open VS Code Settings (`Ctrl+,` or `Cmd+,`)
2. Search for "Project Translator"
3. Find "Diff Apply" section
4. Enable the following options:

```json
{
  "projectTranslator.diffApply": {
    "enabled": true,
    "validationLevel": "normal",
    "autoBackup": true,
    "maxOperationsPerFile": 100
  }
}
```

### Configuration Options

- **enabled**: Enable/disable diff apply mode
- **validationLevel**: 
  - `strict`: Thorough validation of all operations
  - `normal`: Balanced validation (recommended)
  - `loose`: Minimal validation for faster processing
- **autoBackup**: Automatically create backup files before applying changes
- **maxOperationsPerFile**: Maximum number of diff operations per file (safety limit)

## How It Works

1. **Analysis Phase**: Compares source document with existing target document
2. **Diff Generation**: AI identifies specific lines that need translation updates
3. **Operation Planning**: Creates a list of precise update/insert/delete operations
4. **Validation**: Ensures operations are safe and valid
5. **Application**: Applies changes to target file with optional backup

## Operation Types

### Update Operations
```json
{
  "type": "update",
  "lineNumber": 15,
  "content": "New translated content for this line"
}
```

### Insert Operations
```json
{
  "type": "insert",
  "lineNumber": 10,
  "content": "New line to be inserted"
}
```

### Delete Operations
```json
{
  "type": "delete",
  "lineNumber": 8
}
```

## Usage Requirements

- **Target file must exist**: Diff apply only works when comparing against existing translated content
- **Compatible file types**: Works best with structured text files (Markdown, code, documentation)
- **Reasonable file size**: Most effective for files under 10,000 lines

## Best Practices

1. **Enable Auto Backup**: Always keep `autoBackup: true` for safety
2. **Start with Normal Validation**: Use `validationLevel: "normal"` initially
3. **Monitor Operation Count**: Keep `maxOperationsPerFile` reasonable (50-200)
4. **Version Control**: Commit changes before running diff apply translations
5. **Review Changes**: Always review diff apply results before committing

## Troubleshooting

### Common Issues

1. **"Target file not found"**
   - Ensure the target file exists before running diff apply
   - Create an initial translation using standard mode first

2. **"Too many operations"**
   - Increase `maxOperationsPerFile` limit
   - Consider using standard translation mode for major changes

3. **"Validation failed"**
   - Check file encoding (should be UTF-8)
   - Verify file is not corrupted
   - Try with `validationLevel: "loose"`

### Debug Mode

Enable debug logging to see detailed diff apply operations:

```json
{
  "projectTranslator.debug": true
}
```

## Performance Comparison

| File Size | Standard Mode | Diff Apply Mode | Savings |
|-----------|---------------|-----------------|----------|
| 1KB       | ~2 seconds    | ~1 second       | 50%     |
| 10KB      | ~15 seconds   | ~5 seconds      | 67%     |
| 100KB     | ~120 seconds  | ~20 seconds     | 83%     |

*Results may vary based on content complexity and API response times.*

## Integration with Workflows

### CI/CD Pipeline
```bash
# Enable diff apply for automated translations
code --install-extension project-translator
code --user-data-dir /tmp --wait --setting projectTranslator.diffApply.enabled=true
```

### Git Hooks
```bash
#!/bin/bash
# Pre-commit hook to run diff apply translations
if git diff --cached --name-only | grep -E '\.(md|txt)$'; then
    echo "Running diff apply translations..."
    # Run your translation command here
fi
```

## Limitations

- Requires existing target file
- Best suited for incremental updates
- May not be optimal for completely new content
- Depends on AI model's diff analysis capabilities

## Support

For issues or questions about diff apply functionality:

1. Check the [troubleshooting section](#troubleshooting)
2. Review debug logs with `projectTranslator.debug: true`
3. Report issues on the project repository
4. Include sample files and configuration when reporting bugs