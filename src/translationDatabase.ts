import * as path from 'path';
import * as fs from 'fs';
import * as sqlite3 from 'sqlite3';
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

export class TranslationDatabase {
    private db: sqlite3.Database;
    private workspaceRoot: string;
    private sourceRoot: string | null = null;
    private targetRoots: Map<string, SupportedLanguage> = new Map();

    constructor(workspaceRoot: string) {
        this.workspaceRoot = workspaceRoot;
        this.db = new sqlite3.Database(path.join(workspaceRoot, '.translation-cache.db'));
        // Initialize database asynchronously
        this.initDatabase().catch(err => {
            vscode.window.showErrorMessage(`Failed to initialize database: ${err}`);
        });
    }

    private async initDatabase() {
        // Get configuration
        const config = vscode.workspace.getConfiguration('projectTranslator');
        // Import SpecifiedFolder from types
        
        const specifiedFolders = config.get<Array<SpecifiedFolder>>('specifiedFolders') || [];
        
        // Only create tables for languages specified in the configuration
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

        // Create tables for configured languages
        if (configuredLanguages.size > 0) {
            const createTablePromises = Array.from(configuredLanguages).map(lang => 
                this.createTableForLanguage(lang).catch(err => {
                    vscode.window.showErrorMessage(`Failed to create table for language ${lang}: ${err}`);
                })
            );
            await Promise.all(createTablePromises);
        } else {
            vscode.window.showWarningMessage('No valid target languages found in configuration');
        }
    }

    // Helper method to create a translation table for a specific language
    private createTableForLanguage(lang: SupportedLanguage): Promise<void> {
        return new Promise((resolve) => {
            if (!isValidLanguage(lang)) {
                vscode.window.showWarningMessage(`Cannot create table for invalid language code "${lang}"`);
                resolve();
                return;
            }
            
            // Sanitize the language code to create a valid table name
            const tableName = `translations_${lang.replace(/[^a-zA-Z0-9_]/g, '_')}`;
            this.db.run(`
                CREATE TABLE IF NOT EXISTS ${tableName} (
                    source_path TEXT PRIMARY KEY,
                    lastTranslationTime INTEGER
                )
            `, (err) => {
                if (err) {
                    vscode.window.showErrorMessage(`Error creating table for language ${lang}: ${err}`);
                    // No need to call reject since we're always resolving
                    resolve();
                } else {
                    // Log success
                    resolve();
                }
            });
        });
    }

    private initTargetRootsFromConfig(destFolders: Array<{ path: string; lang: SupportedLanguage }>) {
        this.clearTargetRoots();

        for (const folder of destFolders) {
            if (!folder.lang) {
                vscode.window.showWarningMessage(`Target folder "${folder.path}" has no language configured, skipped`);
                continue;
            }

            const normalizedPath = path.normalize(folder.path).replace(/\\/g, '/');
            this.targetRoots.set(normalizedPath, folder.lang);
        }
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

        if (isSource) {
            if (!this.sourceRoot) {
                throw new Error('Source root path not set');
            }
            const normalizedSourceRoot = normalizePath(this.sourceRoot);
            const relativePath = path.relative(normalizedSourceRoot, normalizedAbsolutePath);
            return relativePath.replace(/\\/g, '/');
        } else {
            // Start from the longest matching path
            const normalizedTargetRoots = Array.from(this.targetRoots.keys())
                .map(root => normalizePath(root))
                .sort((a, b) => b.length - a.length); // Sort by descending length

            for (const targetRoot of normalizedTargetRoots) {
                if (normalizedAbsolutePath.startsWith(targetRoot)) {
                    // Get full relative path from target root to file, including all subfolders
                    const fullRelativePath = path.relative(targetRoot, normalizedAbsolutePath);
                    const commonPath = fullRelativePath.replace(/\\/g, '/');

                    return commonPath;
                }
            }

            const error = new Error(`Target root path not set. File: ${absolutePath}\nAvailable roots: ${normalizedTargetRoots.join(', ')}`);
            vscode.window.showErrorMessage(error.message);
            throw error;
        }
    }

    public async updateTranslationTime(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<void> {
        const relativeSourcePath = this.getRelativePath(sourcePath, true);
        
        // Ensure table exists for this language
        await this.createTableForLanguage(targetLang);
        
        // Sanitize language code for table name
        const tableName = `translations_${targetLang.replace(/[^a-zA-Z0-9_]/g, '_')}`;

        return new Promise<void>((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO ${tableName} (source_path, lastTranslationTime) VALUES (?, ?)`,
                [relativeSourcePath, Date.now()],
                (err: Error | null) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Error updating translation time: ${err}`);
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    public async setOldestTranslationTime(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<void> {
        const relativeSourcePath = this.getRelativePath(sourcePath, true);
        
        // Ensure table exists for this language
        await this.createTableForLanguage(targetLang);
        
        // Sanitize language code for table name
        const tableName = `translations_${targetLang.replace(/[^a-zA-Z0-9_]/g, '_')}`;
        // Use Unix epoch start time (1970-01-01) as the oldest time
        const oldestTimestamp = 0;

        return new Promise<void>((resolve, reject) => {
            this.db.run(
                `INSERT OR REPLACE INTO ${tableName} (source_path, lastTranslationTime) VALUES (?, ?)`,
                [relativeSourcePath, oldestTimestamp],
                (err: Error | null) => {
                    if (err) {
                        vscode.window.showErrorMessage(`Error setting oldest translation time: ${err}`);
                        reject(err);
                    } else {
                        resolve();
                    }
                }
            );
        });
    }

    public async shouldTranslate(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<boolean> {
        // Always translate if target file doesn't exist
        if (!fs.existsSync(targetPath)) {
            return true;
        }

        const relativeSourcePath = this.getRelativePath(sourcePath, true);
        
        try {
            // Ensure table exists for this language
            await this.createTableForLanguage(targetLang);
            
            // Sanitize language code for table name
            const tableName = `translations_${targetLang.replace(/[^a-zA-Z0-9_]/g, '_')}`;
            const intervalDays = vscode.workspace.getConfiguration('projectTranslator').get<number>('translationIntervalDays') || 7;

            return new Promise((resolve) => {
                this.db.get(
                    `SELECT lastTranslationTime FROM ${tableName} WHERE source_path = ?`,
                    [relativeSourcePath],
                    (err: Error | null, result: { lastTranslationTime: number } | undefined) => {
                        if (err) {
                            vscode.window.showErrorMessage(`Error checking translation status: ${err}`);
                            resolve(true);
                            return;
                        }

                        if (!result) {
                            resolve(true);
                            return;
                        }

                        const daysSinceLastTranslation = (Date.now() - result.lastTranslationTime) / (1000 * 60 * 60 * 24);
                        resolve(daysSinceLastTranslation >= intervalDays);
                    }
                );
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error in shouldTranslate: ${error}`);
            return true; // If there's an error, proceed with translation
        }
    }

    public close(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.db.close((err) => {
                if (err) {
                    vscode.window.showErrorMessage(`Error closing database: ${err}`);
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}