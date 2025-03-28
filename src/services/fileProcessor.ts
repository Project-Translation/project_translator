import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';
import { isBinaryFile } from "isbinaryfile";
import { minimatch } from "minimatch";
import { TranslationDatabase } from "../translationDatabase";
import { DestFolder, SupportedLanguage } from "../types/types";
import { TranslatorService } from "./translatorService";
import { estimateTokenCount, segmentText, combineSegments } from "../segmentationUtils";
import { getConfiguration } from "../config/config";

export class FileProcessor {
    private outputChannel: vscode.OutputChannel;
    private translationDb: TranslationDatabase;
    private translatorService: TranslatorService;
    private processedFilesCount = 0;
    private skippedFilesCount = 0;
    private failedFilesCount = 0;
    private failedFilePaths: string[] = [];
    private isPaused = false;
    private cancellationToken?: vscode.CancellationToken;
    private workspaceRoot: string;

    constructor(
        outputChannel: vscode.OutputChannel,
        translationDb: TranslationDatabase,
        translatorService: TranslatorService
    ) {
        this.outputChannel = outputChannel;
        this.translationDb = translationDb;
        this.translatorService = translatorService;
        // Get workspace root path
        this.workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
    }

    // Resolves a path that might be relative to workspace root
    private resolvePath(filePath: string): string {
        if (!filePath) {
            return filePath;
        }
        
        // If the path is already absolute, return it as is
        if (path.isAbsolute(filePath)) {
            return filePath;
        }
        
        // Otherwise, resolve it relative to workspace root
        const resolvedPath = path.resolve(this.workspaceRoot, filePath);
        return resolvedPath;
    }

    public setTranslationState(isPaused: boolean, token: vscode.CancellationToken) {
        this.isPaused = isPaused;
        this.cancellationToken = token;
    }

    public getProcessingStats() {
        return {
            processedFiles: this.processedFilesCount,
            skippedFiles: this.skippedFilesCount,
            failedFiles: this.failedFilesCount,
            failedPaths: this.failedFilePaths
        };
    }

    public async processDirectory(sourcePath: string, targetPaths: DestFolder[], sourceLang: SupportedLanguage) {
        // Resolve paths
        const resolvedSourcePath = this.resolvePath(sourcePath);
        
        this.outputChannel.appendLine("\n[Directory Processing] ----------------------------------------");
        this.outputChannel.appendLine(`📂 Starting to process directory: ${sourcePath}`);

        try {
            this.checkCancellation();

            const ignorePaths = vscode.workspace.getConfiguration("projectTranslator").get<string[]>("ignorePaths") || [];
            const sourceRoot = this.translationDb.getSourceRoot() || resolvedSourcePath;
            const relativePath = path.relative(sourceRoot, resolvedSourcePath).replace(/\\/g, "/");

            // Check if directory should be ignored
            for (const pattern of ignorePaths) {
                if (minimatch(relativePath, pattern) || minimatch(`${relativePath}/`, pattern)) {
                    this.outputChannel.appendLine(`⏭️ Skipping ignored directory: ${resolvedSourcePath} (matched pattern: ${pattern})`);
                    return;
                }
            }

            const files = fs.readdirSync(resolvedSourcePath);
            this.outputChannel.appendLine(`📊 Found ${files.length} files/directories`);

            for (const file of files) {
                this.checkCancellation();

                const fullPath = path.join(resolvedSourcePath, file);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    await this.processSubDirectory(fullPath, targetPaths, sourceRoot, ignorePaths, sourceLang);
                } else {
                    this.outputChannel.appendLine(`\n📄 File: ${file}`);
                    for (const target of targetPaths) {
                        // Resolve target path
                        const resolvedTargetPath = this.resolvePath(target.path);
                        const relativePath = path.relative(sourceRoot, fullPath);
                        const targetFilePath = path.join(resolvedTargetPath, relativePath);
                        await this.processFile(fullPath, targetFilePath, sourceLang, target.lang);
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.outputChannel.appendLine(`❌ Error processing directory: ${errorMessage}`);
            throw error;
        }
    }

    private checkCancellation() {
        if (this.cancellationToken?.isCancellationRequested) {
            this.outputChannel.appendLine("⛔ Translation cancelled");
            throw new vscode.CancellationError();
        }
    }

    private async processSubDirectory(fullPath: string, targetPaths: DestFolder[], sourceRoot: string, ignorePaths: string[], sourceLang: SupportedLanguage) {
        const relativeSubPath = path.relative(sourceRoot, fullPath).replace(/\\/g, "/");
        let shouldSkip = false;

        for (const pattern of ignorePaths) {
            if (minimatch(relativeSubPath, pattern) || minimatch(`${relativeSubPath}/`, pattern)) {
                this.outputChannel.appendLine(`⏭️ Skipping ignored subdirectory: ${fullPath} (matched pattern: ${pattern})`);
                shouldSkip = true;
                break;
            }
        }

        if (shouldSkip) {
            return;
        }

        this.outputChannel.appendLine(`\n📂 Processing subdirectory: ${path.basename(fullPath)}`);

        // Create corresponding directories for each target path
        for (const target of targetPaths) {
            // Resolve target path
            const resolvedTargetPath = this.resolvePath(target.path);
            const relativePath = path.relative(sourceRoot, fullPath);
            const targetDirPath = path.join(resolvedTargetPath, relativePath);
            if (!fs.existsSync(targetDirPath)) {
                this.outputChannel.appendLine(`Creating target directory: ${targetDirPath}`);
                try {
                    fs.mkdirSync(targetDirPath, { recursive: true });
                } catch (error) {
                    this.outputChannel.appendLine(`❌ Failed to create directory: ${targetDirPath}`);
                    this.outputChannel.appendLine(`❌ Error details: ${error instanceof Error ? error.message : String(error)}`);
                    throw error;
                }
            }
        }

        await this.processDirectory(fullPath, targetPaths, sourceLang);
    }

    public async processFile(sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage) {
        try {
            // Resolve paths
            const resolvedSourcePath = this.resolvePath(sourcePath);
            const resolvedTargetPath = this.resolvePath(targetPath);
            
            this.outputChannel.appendLine(`\nTranslating file: ${path.basename(sourcePath)} from ${sourceLang} to ${targetLang}`);
            
            // Validate paths
            if (!fs.existsSync(resolvedSourcePath)) {
                throw new Error(`Source file not found: ${sourcePath}`);
            }

            // Ensure target directory exists
            const targetDir = path.dirname(resolvedTargetPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            // Skip if file should be ignored
            if (await this.shouldSkipFile(resolvedSourcePath, resolvedTargetPath, targetLang)) {
                return;
            }

            // Handle different file types
            const ext = path.extname(resolvedSourcePath).toLowerCase();
            const ignoreExtensions = getConfiguration().ignoreTranslationExtensions;

            if (ignoreExtensions.includes(ext)) {
                await this.handleIgnoredFile(resolvedSourcePath, resolvedTargetPath);
                return;
            }

            if (await isBinaryFile(resolvedSourcePath)) {
                await this.handleBinaryFile(resolvedSourcePath, resolvedTargetPath);
                return;
            }

            await this.handleTextFile(resolvedSourcePath, resolvedTargetPath, sourceLang, targetLang);
        } catch (error) {
            this.outputChannel.appendLine(`❌ File translation failed: ${error instanceof Error ? error.message : String(error)}`);
            this.failedFilesCount++;
            this.failedFilePaths.push(sourcePath);
            throw error;
        }
    }

    private async shouldSkipFile(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<boolean> {
        const ignorePaths = vscode.workspace.getConfiguration("projectTranslator").get<string[]>("ignorePaths") || [];
        const sourceRoot = this.resolvePath(this.translationDb.getSourceRoot() || path.dirname(sourcePath));
        const relativePath = path.relative(sourceRoot, sourcePath).replace(/\\/g, "/");

        // Check ignore patterns
        for (const pattern of ignorePaths) {
            if (minimatch(relativePath, pattern)) {
                this.outputChannel.appendLine(`⏭️ Skipping ignored file: ${sourcePath} (matched pattern: ${pattern})`);
                return true;
            }
        }

        // Check translation interval
        const shouldTranslate = await this.translationDb.shouldTranslate(sourcePath, targetPath, targetLang);
        if (!shouldTranslate) {
            this.outputChannel.appendLine("⏭️ File is within translation interval, skipping translation");
            return true;
        }

        return false;
    }

    private async handleIgnoredFile(sourcePath: string, targetPath: string) {
        if (fs.existsSync(targetPath)) {
            const sourceContent = fs.readFileSync(sourcePath);
            const targetContent = fs.readFileSync(targetPath);
            if (Buffer.compare(sourceContent, targetContent) === 0) {
                this.outputChannel.appendLine("⏭️ Source file and target file content are the same, skipping copy");
                this.skippedFilesCount++;
                return;
            }
        }

        this.outputChannel.appendLine(`📦 Detected file type to ignore translation: ${path.extname(sourcePath)}`);
        this.outputChannel.appendLine("🔄 Performing file copy");
        fs.copyFileSync(sourcePath, targetPath);
        this.outputChannel.appendLine("✅ Ignored file copy completed");
        this.processedFilesCount++;
    }

    private async handleBinaryFile(sourcePath: string, targetPath: string) {
        this.outputChannel.appendLine("📦 Detected binary file, performing direct copy");
        fs.copyFileSync(sourcePath, targetPath);
        this.outputChannel.appendLine("✅ Binary file copy completed");
        this.processedFilesCount++;
    }

    private async handleTextFile(sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage) {
        // Set oldest translation time before starting
        await this.translationDb.setOldestTranslationTime(sourcePath, targetPath, targetLang);
        this.outputChannel.appendLine("🕒 Translation timestamp reset");

        // Handle pause state
        while (this.isPaused) {
            this.checkCancellation();
            await new Promise(resolve => globalThis.setTimeout(resolve, 500));
            this.outputChannel.appendLine("⏸️ Translation paused...");
        }

        // Start translation
        this.outputChannel.appendLine("🔄 Starting file content translation...");
        const content = fs.readFileSync(sourcePath, "utf8");
        const startTime = Date.now();

        try {
            const config = getConfiguration();
            const { maxTokensPerSegment = 4096 } = config;
            const estimatedTokens = estimateTokenCount(content);

            let translatedContent: string;
            if (estimatedTokens > maxTokensPerSegment) {
                translatedContent = await this.handleLargeFile(content, sourcePath, targetPath, sourceLang, targetLang);
            } else {
                this.checkCancellation();
                translatedContent = await this.translatorService.translateContent(
                    content, 
                    sourceLang,
                    targetLang, 
                    sourcePath, 
                    this.cancellationToken
                );
                this.checkCancellation();
                fs.writeFileSync(targetPath, translatedContent);
                this.outputChannel.appendLine("💾 Translation result written");
            }

            const endTime = Date.now();
            this.outputChannel.appendLine(`⌛ Translation time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);

            if (!this.isPaused) {
                await this.translationDb.updateTranslationTime(sourcePath, targetPath, targetLang);
                this.outputChannel.appendLine("✅ File processing completed, translation timestamp updated\n");
                this.processedFilesCount++;
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.outputChannel.appendLine(`❌ Translation failed: ${errorMessage}`);
            throw error;
        }
    }

    private async handleLargeFile(content: string, sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage): Promise<string> {
        const config = getConfiguration();
        const { maxTokensPerSegment } = config;
        const segments = segmentText(content, sourcePath, maxTokensPerSegment);
        const translatedSegments: string[] = [];

        this.outputChannel.appendLine(`📑 File too large, split into ${segments.length} segments`);

        for (let i = 0; i < segments.length; i++) {
            this.checkCancellation();

            const segment = segments[i];
            const segmentTokens = estimateTokenCount(segment);
            this.outputChannel.appendLine(
                `🔄 Translating segment ${i + 1}/${segments.length} (approximately ${segmentTokens} tokens)...`
            );

            try {
                const translatedSegment = await this.translatorService.translateContent(
                    segment,
                    sourceLang,
                    targetLang,
                    sourcePath,
                    this.cancellationToken
                );
                this.checkCancellation();
                translatedSegments.push(translatedSegment);

                // Write progress to file
                const currentContent = combineSegments(translatedSegments);
                fs.writeFileSync(targetPath, currentContent);
                this.outputChannel.appendLine(`💾 Written translation result for segment ${i + 1}/${segments.length}`);
            } catch (error) {
                if (error instanceof vscode.CancellationError) {
                    throw error;
                }
                const errorMessage = error instanceof Error ? error.message : "Unknown error";
                this.outputChannel.appendLine(`❌ Failed to translate segment ${i + 1}: ${errorMessage}`);
                throw error;
            }
        }

        return combineSegments(translatedSegments);
    }
}