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

// Source file interface
export interface SourceFile {
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
    sourceFile: SourceFile;
    destFiles: DestFile[];
}

// Language name mapping
export const languageNameMap: Record<SupportedLanguage, string> = {
    "zh-cn": "Simplified Chinese",
    "zh-tw": "Traditional Chinese",
    "en-us": "English",
    "ja-jp": "Japanese",
    "ko-kr": "Korean", 
    "fr-fr": "French",
    "de-de": "German",
    "es-es": "Spanish",
    "pt-br": "Portuguese",
    "ru-ru": "Russian",
    "it-it": "Italian",
    "nl-nl": "Dutch",
    "pl-pl": "Polish",
    "tr-tr": "Turkish",
    "ar-sa": "Arabic",
    "hi-in": "Hindi",
    "vi-vn": "Vietnamese", 
    "th-th": "Thai",
    "id-id": "Indonesian",
};