# Project Translator Memory Bank (Translation Cache)

The Project Translator extension includes a powerful feature called the Memory Bank, which is a translation cache designed to make the translation process more efficient and cost-effective. This document explains what the Memory Bank is, how it works, and how you can interact with it.

## User Guide

### What is the Memory Bank?

The Memory Bank is an intelligent cache that stores your translations. When you translate your project, the extension creates a unique signature (a hash) for each source file. If you run the translation again and a file has not changed, the extension will skip it, saving you time and reducing API costs.

### How It Works

The process is fully automatic:

1.  **First Translation**: When a file is translated for the first time, its contents are stored along with a hash of the source file.
2.  **Subsequent Translations**: Before translating a file, the extension calculates a new hash of the current source file and compares it to the stored hash. 
    - If the hashes match, the file has not changed, and the translation is skipped.
    - If the hashes do not match, the file has been modified and will be re-translated.

### Managing the Cache

If you ever need to force a full re-translation of your project, you can clear the cache by deleting the `.translation-cache` directory located in your project's root folder. The extension will automatically recreate it during the next translation.

## Technical Details

This section provides a deeper look into the technical implementation of the Memory Bank for developers or curious users.

### Cache Structure

The cache is stored in the `.translation-cache` directory at the root of your workspace. Inside this directory, you will find one JSON file for each target language, named according to the pattern `translations_<language_code>.json`.

Example:
```
.translation-cache/
├── translations_zh-cn.json
└── translations_ja-jp.json
```

### Data Format

Each `translations_*.json` file contains a single JSON object where the keys are the relative paths to the source files. The value for each key is an object containing metadata about the translation.

```json:Example from translations_zh-cn.json
{
  "src/commands/translate.ts": {
    "translate_datetime": "2023-10-27T10:00:00Z",
    "src_hash": "a1b2c3d4...e5f6"
  }
}
```

-   `translate_datetime`: An ISO 8601 timestamp indicating when the file was last successfully translated.
-   `src_hash`: A SHA256 hash of the source file's content at the time of translation. This is the key to detecting changes.

### Core Components

-   **`TranslationDatabase` (`src/translationDatabase.ts`)**: This class is the heart of the Memory Bank. It manages loading the cache from disk, checking if a file needs to be re-translated by comparing hashes, and saving updated cache information.
-   **`FileProcessor` (`src/services/fileProcessor.ts`)**: This service uses the `TranslationDatabase` to determine whether a file should be sent to the `TranslatorService` or skipped because it's already up-to-date in the cache.

## See Also

-   [Source Code: `src/translationDatabase.ts`](../src/translationDatabase.ts)
-   [Source Code: `src/services/fileProcessor.ts`](../src/services/fileProcessor.ts)