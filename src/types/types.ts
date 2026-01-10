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

export interface Config {
  currentVendorName: string;
  currentVendor: VendorConfig;
  vendors: VendorConfig[];
  specifiedFiles: SpecifiedFile[];
  specifiedFolders: SpecifiedFolder[];
  translationIntervalDays: number;
  copyOnly: {
    paths: string[];
    extensions: string[];
  };
  ignore: {
    paths: string[];
    extensions: string[];
  };
  customPrompts: string[];
  segmentationMarkers: Record<string, string[]>; // TODO: This should be a map of language to array of strings
  debug: boolean;
  logFile: {
    enabled: boolean;
    maxSizeKB: number;
    maxFiles: number;
  };
}

export interface FrontMatterMarker {
    key: string;
    value: string;
}

export interface SkipFrontMatterConfig {
    enabled: boolean;
    markers: FrontMatterMarker[];
}


// Diff-apply configuration for differential translation
export type DiffApplyValidationLevel = 'normal' | 'strict'

export interface DiffApplyConfig {
    enabled: boolean;
    validationLevel?: DiffApplyValidationLevel; // default: 'normal'
    autoBackup?: boolean; // default: true
    maxOperationsPerFile?: number; // default: 100
}

