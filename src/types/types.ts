import { SupportedLanguage } from "../translationDatabase";

// Re-export SupportedLanguage
export { SupportedLanguage };

// Vendor configuration interface
export interface VendorConfig {
    name: string;
    apiEndpoint: string;
    apiKey?: string;
    apiKeyEnvVarName?: string;
    model: string;
    rpm?: number;
    maxTokensPerSegment?: number;
    timeout?: number;
    temperature?: number;
    streamMode?: boolean;
}

// Specified folder group for folder-level translation
export interface SpecifiedFolder {
    sourceFolder: {
        path: string;
        lang: SupportedLanguage;
    };
    targetFolders: DestFolder[];
}

// Chat message interface
export interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

// Destination folder interface
export interface DestFolder {
    path: string;
    lang: SupportedLanguage;
}

// Destination file interface (same structure as DestFolder)
export interface TargetFile {
    path: string;
    lang: SupportedLanguage;
}

// Specified file group for multi-file translation
export interface SpecifiedFile {
    sourceFile: {
        path: string;
        lang: SupportedLanguage;
    };
    targetFiles: TargetFile[];
}

// Configuration interface for copy-only files
// and folders, which should not be translated but copied as-is
export interface CopyOnlyConfig {
    paths: string[];
    extensions: string[];
}

// Configuration interface for files and folders to ignore
// during translation, which should not be copied or translated
export interface IgnoreConfig {
    paths: string[];
    extensions: string[];
}

// Diff apply strategy options
export type DiffStrategy = 'auto' | 'vscode-api' | 'git-command';

// Diff granularity options
export type DiffGranularity = 'line' | 'block' | 'semantic';

// Configuration interface for diff apply functionality
export interface DiffApplyConfig {
    enabled: boolean;                    // Enable differential translation (default: false)
    strategy: DiffStrategy;              // Diff detection strategy (default: 'auto')
    granularity: DiffGranularity;        // Diff granularity (default: 'line')
    contextLines: number;                // Number of context lines (default: 3)
    fallbackToFullTranslation: boolean;  // Fallback to full translation on failure (default: true)
}

// Diff information interface
export interface DiffInfo {
    hasChanges: boolean;
    changedLines: {
        lineNumber: number;
        oldContent: string;
        newContent: string;
        changeType: 'added' | 'deleted' | 'modified';
    }[];
    contextLines: {
        lineNumber: number;
        content: string;
    }[];
}

// Translation diff result interface
export interface TranslationDiffResult {
    success: boolean;
    translatedChanges: {
        lineNumber: number;
        translatedContent: string;
        changeType: 'added' | 'deleted' | 'modified';
    }[];
    error?: string;
}

