import { SupportedLanguage } from "../translationDatabase";

// Re-export SupportedLanguage
export { SupportedLanguage };

// Vendor configuration interface
export interface VendorConfig {
    name: string;
    apiEndpoint: string;
    apiKey: string;
    model: string;
    rpm?: number;
    maxTokensPerSegment?: number;
    timeout?: number;
    temperature?: number;
}

// Specified folder group for folder-level translation
export interface SpecifiedFolder {
    sourceFolder: {
        path: string;
        lang: SupportedLanguage;
    };
    destFolders: DestFolder[];
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
export interface DestFile {
    path: string;
    lang: SupportedLanguage;
}

// Specified file group for multi-file translation
export interface SpecifiedFile {
    sourceFile: {
        path: string;
        lang: SupportedLanguage;
    };
    destFiles: DestFile[];
}
