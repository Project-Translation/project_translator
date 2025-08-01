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
    top_p?: number;
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

// Diff Apply Translation Types
export interface DiffOperation {
    type: 'update' | 'insert' | 'delete';
    line_number: number;
    old_content?: string;
    new_content?: string;
    content?: string;
}

export interface DiffApplyRequest {
    operation: 'diff_apply_translation';
    source_language: SupportedLanguage;
    target_language: SupportedLanguage;
    source_document: {
        path: string;
        content: string;
    };
    target_document: {
        path: string;
        content: string;
    };
}

export interface DiffApplyResponse {
    status: 'success' | 'error' | 'no_changes';
    operations?: DiffOperation[];
    error_message?: string;
    metadata?: {
        totalOperations: number;
        processingTime: number;
        estimated_changes?: 'minor' | 'major' | 'extensive';
    };
}

export interface DiffApplyConfig {
    enabled: boolean;
    validationLevel: 'strict' | 'normal' | 'loose';
    autoBackup: boolean;
    maxOperationsPerFile: number;
}

