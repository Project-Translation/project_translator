import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { SpecifiedFolder } from './types/types';

// Example language codes, but system now accepts any string with length < 10
export const SUPPORTED_LANGUAGES = [
    'zh-cn', 'zh-tw', 'en-us', 'ja-jp', 'ko-kr',
    'fr-fr', 'de-de', 'es-es', 'pt-br', 'ru-ru'
];

// Any string with length under 10 characters is now a valid language code
export type SupportedLanguage = string;

// Validate if a string is a valid language code (under 10 characters)
export function isValidLanguage(lang: string): boolean {
    return typeof lang === 'string' && lang.length > 0 && lang.length < 10;
}

interface TranslationRecord {
    [sourcePath: string]: {
        timestamp: number;
        hash: string;
    };
}

export class TranslationDatabase {
    private translationCacheDir: string;
    private workspaceRoot: string;
    private sourceRoot: string | null = null;
    private targetRoots: Map<string, SupportedLanguage> = new Map();
    private translationCache: Map<string, TranslationRecord> = new Map();

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.translationCacheDir = path.join(workspaceRoot, '.translation-cache');

        // Initialize cache directory and load data
        this.initCache().catch(err => {
            vscode.window.showErrorMessage(`Failed to initialize translation cache: ${err}`);
        });
    }

    private async initCache() {
        // Create the cache directory if it doesn't exist
        if (!fs.existsSync(this.translationCacheDir)) {
            fs.mkdirSync(this.translationCacheDir, { recursive: true });
        }

        // Get configuration
        const config = vscode.workspace.getConfiguration('projectTranslator');
        const specifiedFolders = config.get<Array<SpecifiedFolder>>('specifiedFolders') || [];

        // Only create caches for languages specified in the configuration
        const configuredLanguages = new Set<SupportedLanguage>();

        if (specifiedFolders.length > 0) {
            specifiedFolders[0].destFolders?.forEach((folder: { lang: SupportedLanguage }) => {
                if (folder.lang && isValidLanguage(folder.lang)) {
                    configuredLanguages.add(folder.lang);
                } else if (folder.lang) {
                    vscode.window.showWarningMessage(`Invalid language code "${folder.lang}". Language codes must be non-empty strings with less than 10 characters.`);
                }
            });
        }

        // Load translation caches for configured languages
        if (configuredLanguages.size > 0) {
            const loadCachePromises = Array.from(configuredLanguages).map(lang =>
                this.loadCacheForLanguage(lang).catch(err => {
                    vscode.window.showErrorMessage(`Failed to load cache for language ${lang}: ${err}`);
                })
            );
            await Promise.all(loadCachePromises);
        } else {
            vscode.window.showWarningMessage('No valid target languages found in configuration');
        }
    }

    // Helper method to load or initialize a translation cache for a specific language
    private async loadCacheForLanguage(lang: SupportedLanguage): Promise<void> {
        if (!isValidLanguage(lang)) {
            vscode.window.showWarningMessage(`Cannot create cache for invalid language code "${lang}"`);
            return;
        }

        // Sanitize the language code to create a valid file name
        const cacheFileName = `translations_${lang.replace(/[^a-zA-Z0-9_]/g, '_')}.json`;
        const cacheFilePath = path.join(this.translationCacheDir, cacheFileName);

        try {
            if (fs.existsSync(cacheFilePath)) {
                const cacheContent = fs.readFileSync(cacheFilePath, 'utf8');
                this.translationCache.set(lang, JSON.parse(cacheContent));
            } else {
                // Initialize with empty record if file doesn't exist
                this.translationCache.set(lang, {});
                await this.saveCacheForLanguage(lang);
            }
        } catch (error) {
            // If there's an error reading or parsing the file, start with an empty cache
            this.translationCache.set(lang, {});
            vscode.window.showWarningMessage(`Error loading translation cache for ${lang}: ${error}. Starting with empty cache.`);
        }
    }

    // Helper method to save the cache for a specific language
    private async saveCacheForLanguage(lang: SupportedLanguage): Promise<void> {
        if (!isValidLanguage(lang)) {
            return;
        }

        const cacheFileName = `translations_${lang.replace(/[^a-zA-Z0-9_]/g, '_')}.json`;
        const cacheFilePath = path.join(this.translationCacheDir, cacheFileName);

        try {
            const cacheContent = JSON.stringify(this.translationCache.get(lang) || {}, null, 2);
            fs.writeFileSync(cacheFilePath, cacheContent, 'utf8');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to save translation cache for ${lang}: ${error}`);
        }
    }

    public getWorkspaceRoot(): string {
        return this.workspaceRoot;
    }

    public setSourceRoot(sourcePath: string) {
        this.sourceRoot = sourcePath;
    }

    public getSourceRoot(): string | null {
        return this.sourceRoot;
    }

    public setTargetRoot(targetPath: string, targetLang: SupportedLanguage) {
        // Validate the language code
        if (!isValidLanguage(targetLang)) {
            throw new Error(`Invalid language code: ${targetLang}. Language codes must be non-empty strings with less than 10 characters.`);
        }

        const normalizedPath = path.normalize(targetPath).replace(/\\/g, '/');
        this.targetRoots.set(normalizedPath, targetLang);
    }

    public clearTargetRoots() {
        this.targetRoots.clear();
    }

    private getRelativePath(absolutePath: string, isSource: boolean): string {
        const normalizePath = (p: string) => path.normalize(p).replace(/\\/g, '/');
        const normalizedAbsolutePath = normalizePath(absolutePath);

        const relativeToWorkspacePath = path.relative(this.workspaceRoot, normalizedAbsolutePath);
        return relativeToWorkspacePath.replace(/\\/g, '/');
    }

    public async updateTranslationTime(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<void> {
        const relativeSourcePath = this.getRelativePath(sourcePath, true);

        // Ensure cache exists for this language
        if (!this.translationCache.has(targetLang)) {
            await this.loadCacheForLanguage(targetLang);
        }

        // Get the translation record for this language
        const translationRecord = this.translationCache.get(targetLang) || {};

        // Get current file info
        const fileInfo = await this.getCurrentFileInfo(sourcePath);

        // Update the record
        translationRecord[relativeSourcePath] = fileInfo;

        // Save back to the cache
        this.translationCache.set(targetLang, translationRecord);

        // Save to file
        await this.saveCacheForLanguage(targetLang);
    }

    public async setOldestTranslationTime(sourcePath: string, targetLang: SupportedLanguage): Promise<void> {
        const relativeSourcePath = this.getRelativePath(sourcePath, true);

        // Ensure cache exists for this language
        if (!this.translationCache.has(targetLang)) {
            await this.loadCacheForLanguage(targetLang);
        }

        // Get the translation record for this language
        const translationRecord = this.translationCache.get(targetLang) || {};

        // Calculate current hash but use oldest timestamp
        const hash = this.calculateFileHash(sourcePath);
        const oldestTimestamp = 0; // Unix epoch start time (1970-01-01)

        // Update the record with current hash but oldest timestamp
        translationRecord[relativeSourcePath] = {
            timestamp: oldestTimestamp,
            hash: hash
        };

        // Save back to the cache
        this.translationCache.set(targetLang, translationRecord);

        // Save to file
        await this.saveCacheForLanguage(targetLang);
    }

    public async shouldTranslate(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<boolean> {
        // Always translate if target file doesn't exist
        if (!fs.existsSync(targetPath)) {
            return true;
        }

        const relativeSourcePath = this.getRelativePath(sourcePath, true);

        try {
            // Ensure cache exists for this language
            if (!this.translationCache.has(targetLang)) {
                await this.loadCacheForLanguage(targetLang);
            }

            // Get the translation record for this language
            const translationRecord = this.translationCache.get(targetLang) || {};

            // Get the interval in days from configuration
            const intervalDays = vscode.workspace.getConfiguration('projectTranslator').get<number>('translationIntervalDays') || 7;

            // If the source file has no record, it should be translated
            if (!translationRecord[relativeSourcePath]) {
                return true;
            }

            // Get current file info to compare
            const currentFileInfo = await this.getCurrentFileInfo(sourcePath);
            const cachedFileInfo = translationRecord[relativeSourcePath];
            // Check if both conditions are met: hash changed and past interval
            const hashChanged = currentFileInfo.hash !== cachedFileInfo.hash;
            const daysSinceLastTranslation = (Date.now() - cachedFileInfo.timestamp) / (1000 * 60 * 60 * 24);
            const isPastInterval = daysSinceLastTranslation >= intervalDays;

            return hashChanged && isPastInterval;

        } catch (error) {
            vscode.window.showErrorMessage(`Error in shouldTranslate: ${error}`);
            return true; // If there's an error, proceed with translation
        }
    }

    public close(): Promise<void> {
        // Save all caches before closing
        const savePromises = Array.from(this.translationCache.keys()).map(lang =>
            this.saveCacheForLanguage(lang)
        );

        return Promise.all(savePromises).then(() => {
            // Clear the cache to free up memory
            this.translationCache.clear();
        });
    }

    private calculateFileHash(filePath: string): string {
        const fileContent = fs.readFileSync(filePath);
        return crypto.createHash('md5').update(fileContent).digest('hex');
    }

    private async getCurrentFileInfo(sourcePath: string): Promise<{ timestamp: number; hash: string }> {
        const timestamp = Date.now();
        const hash = this.calculateFileHash(sourcePath);
        return { timestamp, hash };
    }
}