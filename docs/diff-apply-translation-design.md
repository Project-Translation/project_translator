# Diff Apply Translation - Technical Design Document

## Overview

Diff Apply Translation is an advanced feature of the Project Translator extension that enables precise and efficient translation updates through a differential update mechanism. This document details the technical design and implementation principles of this feature.

## Core Concepts

### Differential Translation

Traditional translation methods typically send the entire file content to a translation service and then completely replace the target file with the translation results. This method has the following issues:

1. Consumes a large number of API tokens for large files
2. Difficult to maintain file format and structure
3. For partially translated files, already translated content is re-translated
4. Difficult to track specific changes in version control systems

Diff Apply Translation solves these problems by:

1. Sending only the source and target file content that needs to be translated
2. Requiring the AI to generate precise differential operations (additions, deletions, updates)
3. Applying these operations precisely to the target file

## System Architecture

### Component Relationship Diagram

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

### Core Components

1. **FileProcessor**: Handles the file translation process, deciding whether to use standard or differential translation
2. **TranslatorService**: Provides translation service interfaces, including standard and differential translation
3. **DiffApplyService**: A service specifically for differential translation, including creating requests, parsing responses, and applying diffs
4. **DiffApplyRequest**: Data structure for differential translation requests
5. **DiffApplyResponse**: Data structure for differential translation responses

## Data Flow

### Differential Translation Process

1. **Request Creation**:
   - Reads source and target file content
   - Creates a `DiffApplyRequest` containing the content and language information of both files

2. **Translation Processing**:
   - Sends the request to the AI service
   - AI analyzes the differences between the two files
   - AI generates a precise list of differential operations

3. **Diff Application**:
   - Parses the differential operations returned by the AI
   - Validates the effectiveness and security of the operations
   - Applies these operations to the target file
   - Generates the updated file content

## Data Structures

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

## AI Prompt Design

To obtain high-quality differential operations, we designed a specialized AI prompt template:

```
You are a professional translation assistant, skilled in precise file translation.

I will provide two files:
1. Source file (${sourceLanguage})
2. Target file (${targetLanguage})

The target file may be partially translated. Your task is to:
1. Analyze the source and target files
2. Identify parts in the target file that need translation or updating
3. Generate precise differential operations to make the target file a complete translated version of the source file

Please follow these rules:
- Keep code blocks, tags, and formatting unchanged
- Translate only natural language text
- Generate the minimum number of operations to achieve complete translation
- Return the differential operations list in JSON format

Source file content:
${sourceContent}

Target file content:
${targetContent}

Please return the response in the following JSON format:
{
  "status": "success",
  "operations": [
    { "type": "update", "lineNumber": line_number, "content": "updated_content" },
    { "type": "insert", "lineNumber": line_number, "content": "inserted_content" },
    { "type": "delete", "lineNumber": line_number }
  ],
  "metadata": {
    "totalOperations": total_operations,
    "processingTime": processing_time_ms
  }
}
```

## Validation Mechanism

To ensure the security and effectiveness of differential operations, we implemented multi-level validation:

### Validation Levels

1. **Strict**:
   - Validates whether all operation line numbers are within a valid range
   - Validates whether the file length change after operation is reasonable
   - Validates whether the operation will cause file structure damage
   - Limits the maximum number of operations per single file

2. **Normal**:
   - Validates whether all operation line numbers are within a valid range
   - Limits the maximum number of operations per single file

3. **Loose**:
   - Basic validation of operation effectiveness
   - Allows a wider range of operations

## Error Handling

The system is designed with a comprehensive error handling mechanism:

1. **Request Creation Errors**:
   - File read failure
   - File encoding issues

2. **AI Response Errors**:
   - Response format error
   - Incomplete response content

3. **Diff Application Errors**:
   - Operation validation failure
   - File write failure

For all errors, the system logs detailed information and provides fallback mechanisms to ensure that in case of differential translation failure, it can revert to the standard translation method.

## Performance Optimization

### Token Usage Optimization

Differential translation significantly reduces API token usage:

- Sends only necessary file content
- Returns only differential operations, not full translations
- For large files, savings can be up to 70-90% of tokens

### Processing Speed Optimization

- Parallel processing of multiple differential operations
- Caching intermediate results
- Optimizing file read/write operations

## Security Considerations

### File Backup

The system automatically creates backups of target files in the format `{filename}.backup.{timestamp}`, ensuring that the original file can be restored in case of operation failure.

### Operation Limits

By configuring `maxOperationsPerFile`, the maximum number of operations for a single file is limited, preventing malicious or erroneous large-scale operations.

## Extensibility

The system design considers future extensibility:

1. **Support for More Operation Types**:
   - Block-level operations
   - Formatting operations

2. **Integration of More AI Models**:
   - Support for different AI providers
   - Adaptation to different model characteristics

3. **Enhanced User Interface**:
   - Visual diff preview
   - Operation confirmation interface

## Conclusion

Diff Apply Translation significantly improves translation efficiency and quality through its precise differential update mechanism, especially suitable for large projects and continuously updated documents. The implementation of this feature fully considers performance, security, and user experience, providing powerful advanced translation capabilities for the Project Translator extension.