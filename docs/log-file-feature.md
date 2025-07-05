# Debug Log File Feature

This document describes the debug log file feature that allows you to save debug logs to files when debug mode is enabled.

## Overview

When both debug mode and log file feature are enabled, the extension will:
- Continue to output logs to the VS Code Output Channel
- Additionally write logs to rotating log files in the specified directory
- Automatically manage log file rotation based on size and count limits

## Configuration

The log file feature is configured through the `projectTranslator.logFile` setting:

```json
{
  "projectTranslator.debug": true,
  "projectTranslator.logFile": {
    "enabled": true,
    "path": "",
    "maxSizeKB": 10240,
    "maxFiles": 5
  }
}
```

### Configuration Options

- **enabled** (boolean, default: false): Enable writing debug logs to file when debug mode is active
- **path** (string, default: ""): Custom path for log files. Leave empty to use default location: `workspace/.vscode/project-translator-logs`
- **maxSizeKB** (number, default: 10240): Maximum size of each log file in KB (1MB - 100MB)
- **maxFiles** (number, default: 5): Maximum number of log files to keep (1-20)

## Default Log Location

When no custom path is specified, log files are stored in:
```
<workspace>/.vscode/project-translator-logs/
```

## Log File Naming

Log files follow this naming pattern:
```
project-translator-YYYY-MM-DD-HH-mm-ss.log
```

Example: `project-translator-2024-01-15-14-30-25.log`

## Log Rotation

The system automatically manages log files:

1. **Size-based rotation**: When a log file reaches the maximum size, a new file is created
2. **Count-based cleanup**: When the number of log files exceeds the maximum, the oldest files are deleted
3. **Automatic cleanup**: Old log files are cleaned up when the extension starts

## Usage Examples

### Basic Usage

1. Enable debug mode:
   ```json
   {
     "projectTranslator.debug": true
   }
   ```

2. Enable log file feature:
   ```json
   {
     "projectTranslator.logFile": {
       "enabled": true
     }
   }
   ```

3. Start using the extension - logs will be written to both Output Channel and log files

### Custom Log Directory

```json
{
  "projectTranslator.debug": true,
  "projectTranslator.logFile": {
    "enabled": true,
    "path": "/custom/log/directory",
    "maxSizeKB": 5120,
    "maxFiles": 10
  }
}
```

### Workspace-specific Configuration

Add to your workspace's `.vscode/settings.json`:

```json
{
  "projectTranslator.debug": true,
  "projectTranslator.logFile": {
    "enabled": true,
    "maxSizeKB": 20480,
    "maxFiles": 3
  }
}
```

## Log Format

Log entries include:
- Timestamp (ISO format)
- Log level (INFO, WARN, ERROR)
- Message content

Example log entry:
```
[2024-01-15T14:30:25.123Z] [INFO] Translation started for file: example.md
[2024-01-15T14:30:26.456Z] [DEBUG] API Request: POST /v1/chat/completions
[2024-01-15T14:30:27.789Z] [INFO] Translation completed successfully
```

## Benefits

1. **Persistent Logs**: Debug information is preserved even after VS Code is closed
2. **Better Debugging**: Easier to analyze issues with persistent log files
3. **Automatic Management**: No manual cleanup required - old logs are automatically removed
4. **Flexible Configuration**: Customize log location, size limits, and retention policy
5. **Non-intrusive**: Logs are only written when both debug mode and log file feature are enabled

## Troubleshooting

### Log Files Not Created

1. Ensure both `projectTranslator.debug` and `projectTranslator.logFile.enabled` are set to `true`
2. Check that the specified log directory is writable
3. Verify the workspace folder exists (required for default log location)

### Permission Issues

- Ensure the extension has write permissions to the log directory
- Try using a different log directory path
- Check VS Code's output channel for error messages

### Large Log Files

- Reduce the `maxSizeKB` setting
- Decrease the `maxFiles` setting
- Consider using a custom log directory with more available space

## Security Considerations

- Log files may contain sensitive information from API requests/responses
- Ensure log directories have appropriate access permissions
- Consider the retention policy for sensitive projects
- Log files are automatically cleaned up based on the configured limits