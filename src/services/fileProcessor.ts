import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';
import { isBinaryFile } from "isbinaryfile";
import * as glob from 'glob';
import { TranslationDatabase } from "../translationDatabase";
import { DestFolder, SupportedLanguage } from "../types/types";
import { TranslatorService, AI_RETURN_CODE } from "./translatorService";
import { DiffApplyService } from "./diffApplyService";

import { estimateTokenCount, segmentText, combineSegments } from "../segmentationUtils";
import { getConfiguration } from "../config/config";
import { logMessage } from '../extension';

export class FileProcessor {
    private outputChannel: vscode.OutputChannel;
    private translationDb: TranslationDatabase;
    private translatorService: TranslatorService;
    private diffApplyService: DiffApplyService;

    private processedFilesCount = 0;
    private skippedFilesCount = 0;
    private failedFilesCount = 0;
    private failedFilePaths: string[] = [];
    private isPaused = false;
    private cancellationToken?: vscode.CancellationToken;
    private workspaceRoot: string;    constructor(
        outputChannel: vscode.OutputChannel,
        translationDb: TranslationDatabase,
        translatorService: TranslatorService
    ) {
        this.outputChannel = outputChannel;
        this.translationDb = translationDb;
        this.translatorService = translatorService;
        this.diffApplyService = new DiffApplyService(outputChannel);
        

        
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

        logMessage("\n[Directory Processing] ----------------------------------------");
        logMessage(`📂 Starting to process directory: ${sourcePath}`); try {
            this.checkCancellation();

            const config = getConfiguration();
            const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
            const sourceRoot = this.translationDb.getSourceRoot() || resolvedSourcePath;
            const relativeToWorkspacePath = path.relative(workspaceRoot, resolvedSourcePath).replace(/\\/g, "/");            // Check if directory should be ignored using glob
            if (config.ignore?.paths) {
                for (const pattern of config.ignore.paths) {
                    if (glob.sync(pattern, { cwd: workspaceRoot }).includes(relativeToWorkspacePath)) {
                        logMessage(`⏭️ Skipping ignored directory: ${resolvedSourcePath} (matched pattern: ${pattern})`);
                        return;
                    }
                }
            }

            const files = fs.readdirSync(resolvedSourcePath);
            logMessage(`📊 Found ${files.length} files/directories`);

            for (const file of files) {
                this.checkCancellation();

                const fullPath = path.join(resolvedSourcePath, file);
                const stat = fs.statSync(fullPath); if (stat.isDirectory()) {
                    await this.processSubDirectory(fullPath, targetPaths, sourceRoot, config.ignore?.paths || [], sourceLang);
                } else {
                    logMessage(`\n📄 File: ${file}`);
                    for (const target of targetPaths) {
                        // Resolve target path
                        const resolvedTargetPath = this.resolvePath(target.path);
                        const relativeToSourcePath = path.relative(sourceRoot, fullPath);
                        const targetFilePath = path.join(resolvedTargetPath, relativeToSourcePath);
                        await this.processFile(fullPath, targetFilePath, sourceLang, target.lang);
                    }
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logMessage(`❌ Error processing directory: ${errorMessage}`);
            throw error;
        }
    }

    private checkCancellation() {
        if (this.cancellationToken?.isCancellationRequested) {
            logMessage("⛔ Translation cancelled");
            throw new vscode.CancellationError();
        }
    }

    private async processSubDirectory(fullPath: string, targetPaths: DestFolder[], sourceRoot: string, ignorePaths: string[], sourceLang: SupportedLanguage) {
        const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
        const relativeToWorkspacePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
        let shouldSkip = false;

        for (const pattern of ignorePaths) {
            if (glob.sync(pattern, { cwd: workspaceRoot }).includes(relativeToWorkspacePath)) {
                logMessage(`⏭️ Skipping ignored subdirectory: ${fullPath} (matched pattern: ${pattern})`);
                shouldSkip = true;
                break;
            }
        }

        if (shouldSkip) {
            return;
        }

        logMessage(`\n📂 Processing subdirectory: ${path.basename(fullPath)}`);

        // Create corresponding directories for each target path
        for (const target of targetPaths) {
            // Resolve target path
            const resolvedTargetPath = this.resolvePath(target.path);
            if (!fs.existsSync(resolvedTargetPath)) {
                logMessage(`Creating target directory: ${resolvedTargetPath}`);
                try {
                    fs.mkdirSync(resolvedTargetPath, { recursive: true });
                } catch (error) {
                    logMessage(`❌ Failed to create directory: ${resolvedTargetPath}`);
                    logMessage(`❌ Error details: ${error instanceof Error ? error.message : String(error)}`);
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

            logMessage(`\n🔄 Translating file: ${path.basename(sourcePath)} from ${sourceLang} to ${targetLang}`);

            // Validate paths
            if (!fs.existsSync(resolvedSourcePath)) {
                throw new Error(`Source file not found: ${sourcePath}`);
            }

            // Ensure target directory exists
            const targetDir = path.dirname(resolvedTargetPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }            // Skip if file should be ignored
            if (await this.shouldSkipFile(resolvedSourcePath, resolvedTargetPath, targetLang)) {
                return;
            }

            // Handle different file types
            const ext = path.extname(resolvedSourcePath).toLowerCase();
            const config = getConfiguration();

            // Check if file should be completely ignored
            if (this.shouldIgnoreFile(resolvedSourcePath, ext, config)) {
                logMessage(`⏭️ Skipping ignored file: ${resolvedSourcePath}`);
                return;
            }

            // Check if file should be copied only (not translated)
            if (this.shouldCopyOnly(resolvedSourcePath, ext, config)) {
                await this.handleCopyOnlyFile(resolvedSourcePath, resolvedTargetPath);
                return;
            }

            if (await isBinaryFile(resolvedSourcePath)) {
                await this.handleBinaryFile(resolvedSourcePath, resolvedTargetPath);
                return;
            }

            await this.handleTextFile(resolvedSourcePath, resolvedTargetPath, sourceLang, targetLang);
        } catch (error) {
            logMessage(`❌ File translation failed: ${error instanceof Error ? error.message : String(error)}`);
            this.failedFilesCount++;
            this.failedFilePaths.push(sourcePath);
            throw error;
        }
    } private async shouldSkipFile(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<boolean> {
        // Check translation interval
        const shouldTranslate = await this.translationDb.shouldTranslate(sourcePath, targetPath, targetLang);
        if (!shouldTranslate) {
            logMessage("⏭️ Skipping translation");
            return true;
        }
        return false;
    }

    private shouldIgnoreFile(sourcePath: string, ext: string, config: any): boolean {
        const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
        const relativeToWorkspacePath = path.relative(workspaceRoot, sourcePath).replace(/\\/g, "/");        // Check ignore paths
        if (config.ignore?.paths) {
            for (const pattern of config.ignore.paths) {
                if (glob.sync(pattern, { cwd: workspaceRoot }).includes(relativeToWorkspacePath)) {
                    return true;
                }
            }
        }

        // Check ignore extensions
        return config.ignore.extensions.includes(ext);
    }

    private shouldCopyOnly(sourcePath: string, ext: string, config: any): boolean {
        const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
        const relativeToWorkspacePath = path.relative(workspaceRoot, sourcePath).replace(/\\/g, "/");

        // Check copyOnly paths
        for (const pattern of config.copyOnly.paths) {
            if (glob.sync(pattern, { cwd: workspaceRoot }).includes(relativeToWorkspacePath)) {
                return true;
            }
        }

        // Check copyOnly extensions
        return config.copyOnly.extensions.includes(ext);
    }

    private async handleCopyOnlyFile(sourcePath: string, targetPath: string) {
        if (fs.existsSync(targetPath)) {
            const sourceContent = fs.readFileSync(sourcePath);
            const targetContent = fs.readFileSync(targetPath);
            if (Buffer.compare(sourceContent, targetContent) === 0) {
                logMessage("⏭️ Source file and target file content are the same, skipping copy");
                this.skippedFilesCount++;
                return;
            }
        }

        logMessage(`📦 Detected file type for copy-only: ${path.extname(sourcePath)}`);
            logMessage("🔄 Performing file copy");
            fs.copyFileSync(sourcePath, targetPath);
            logMessage("✅ Copy-only file copy completed");
        this.processedFilesCount++;
    } private async handleBinaryFile(sourcePath: string, targetPath: string) {
        logMessage("📦 Detected binary file, performing direct copy");
            fs.copyFileSync(sourcePath, targetPath);
            logMessage("✅ Binary file copy completed");
        this.processedFilesCount++;
    }    private async handleTextFile(sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage) {
        // Handle pause state
        while (this.isPaused) {
            this.checkCancellation();
            await new Promise(resolve => globalThis.setTimeout(resolve, 500));
            logMessage("⏸️ Translation paused...");
        }



        // Start translation
        logMessage("🔄 Starting file content translation...");
        const content = fs.readFileSync(sourcePath, "utf8");
        const startTime = Date.now();

        try {
            const config = getConfiguration();
            const { maxTokensPerSegment = 4096, streamMode } = config.currentVendor;
            const estimatedTokens = estimateTokenCount(content);

            let returnCode: string;
            let translatedContent: string;

            // Check if diff apply mode is enabled and target file exists
            const diffApplyConfig = config.diffApply;
            const shouldUseDiffApply = diffApplyConfig?.enabled && fs.existsSync(targetPath);

            if (shouldUseDiffApply) {
                logMessage("🔄 Using Diff Apply translation mode...");
                [returnCode, translatedContent] = await this.handleDiffApplyTranslation(
                    sourcePath, targetPath, sourceLang, targetLang
                );
                
                if (returnCode === AI_RETURN_CODE.OK) {
                    logMessage("💾 Diff Apply translation completed");
                } else if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                    logMessage("🔄 No translation needed via Diff Apply");
                }
            } else if (estimatedTokens > maxTokensPerSegment) {
                [returnCode, translatedContent] = await this.handleLargeFile(content, sourcePath, targetPath, sourceLang, targetLang);

                // No need to write the file here - either it's already been written during processing
                // or we directly copied the file when NO_NEED_TRANSLATE was detected
                if (returnCode === AI_RETURN_CODE.OK) {
                    this.checkCancellation();
                    logMessage("💾 Translation result written");
                }
            } else {
                this.checkCancellation();
                if (streamMode) {
                    // For streaming mode, we'll collect content but only write to file if NO_NEED_TRANSLATE is not detected
                    let streamedContent = '';
                    let noTranslateDetected = false;

                    // Define progress callback for streaming
                    const progressCallback = (chunk: string) => {
                        // Only collect content, don't write to file yet
                        if (!noTranslateDetected) {
                            streamedContent += chunk;
                        }
                    };

                    logMessage("🔄 Using stream mode for translation...");
                    [returnCode, translatedContent] = await this.translatorService.translateContent(
                        content,
                        sourceLang,
                        targetLang,
                        sourcePath,
                        this.cancellationToken,
                        progressCallback
                    );

                    // If NO_NEED_TRANSLATE was detected, copy the original file
                    if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                        logMessage("🔄 No translation needed, copying file directly");
                        fs.writeFileSync(targetPath, content);
                    } else {
                        // Otherwise write the collected content
                        fs.writeFileSync(targetPath, translatedContent);
                        logMessage("💾 Translation result written");
                    }
                } else {
                    [returnCode, translatedContent] = await this.translatorService.translateContent(
                        content,
                        sourceLang,
                        targetLang,
                        sourcePath,
                        this.cancellationToken
                    );

                    if (returnCode === AI_RETURN_CODE.OK) {
                        this.checkCancellation();
                        fs.writeFileSync(targetPath, translatedContent);
                        logMessage("💾 Translation result written");
                    } else if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                        // Copy the file directly for NO_NEED_TRANSLATE
                        fs.writeFileSync(targetPath, content);
                        logMessage("🔄 No translation needed, copying file directly");
                    }
                }
            }

            const endTime = Date.now();
            logMessage(`⌛ Translation time: ${((endTime - startTime) / 1000).toFixed(2)} seconds`);

            if (!this.isPaused) {
                await this.translationDb.updateTranslationTime(sourcePath, targetPath, targetLang);
                logMessage("✅ File processing completed, translation timestamp updated\n");
                this.processedFilesCount++;
            }
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logMessage(`❌ Translation failed: ${errorMessage}`);
            throw error;
        }
    }

    private async handleLargeFile(content: string, sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage): Promise<[string, string]> {
        const config = getConfiguration();
        const { maxTokensPerSegment, streamMode } = config.currentVendor;
        const segments = segmentText(content, sourcePath, maxTokensPerSegment);
        const translatedSegments: string[] = [];

        logMessage(`📑 File too large, split into ${segments.length} segments`);

        // First, translate just the first segment to check if translation is needed
        this.checkCancellation();
        const firstSegment = segments[0];
        const firstSegmentTokens = estimateTokenCount(firstSegment);
        logMessage(
            `🔄 Translating first segment (approximately ${firstSegmentTokens} tokens)...`
        );

        try {
            // For the first segment, we'll use streaming if enabled but won't write to file yet
            // since we need to check if translation is needed
            let firstSegmentCode: string;
            let firstTranslatedSegment: string;
            let firstSegmentContent = '';

            if (streamMode) {
                const progressCallback = (chunk: string) => {
                    firstSegmentContent += chunk;
                };

                [firstSegmentCode, firstTranslatedSegment] = await this.translatorService.translateContent(
                    firstSegment,
                    sourceLang,
                    targetLang,
                    sourcePath,
                    this.cancellationToken,
                    progressCallback
                );
            } else {
                [firstSegmentCode, firstTranslatedSegment] = await this.translatorService.translateContent(
                    firstSegment,
                    sourceLang,
                    targetLang,
                    sourcePath,
                    this.cancellationToken
                );
            }

            // If first segment indicates no translation needed, skip the entire file
            if (firstSegmentCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                logMessage(`🔄 AI indicated no translation needed for this file, skipping entire file translation`);
                fs.writeFileSync(targetPath, content);
                logMessage(`💾 Written original content to target file`);

                // Update translation time to prevent future unnecessary translation attempts
                await this.translationDb.updateTranslationTime(sourcePath, targetPath, targetLang);
                logMessage("✅ Translation timestamp updated");
                this.processedFilesCount++;

                return [AI_RETURN_CODE.NO_NEED_TRANSLATE, content];
            }

            // If translation is needed, add first segment and continue with the rest
            translatedSegments.push(firstTranslatedSegment);

            // Write progress to file
            fs.writeFileSync(targetPath, firstTranslatedSegment);
            logMessage(`💾 Written translation result for segment 1/${segments.length}`);

            // Process remaining segments
            for (let i = 1; i < segments.length; i++) {
                this.checkCancellation();

                const segment = segments[i];
                const segmentTokens = estimateTokenCount(segment);
                logMessage(
                    `🔄 Translating segment ${i + 1}/${segments.length} (approximately ${segmentTokens} tokens)...`
                );

                let segmentCode: string;
                let translatedSegment: string;

                if (streamMode) {
                    // Define a variable to collect the segments as they come in
                    let currentSegmentContent = '';
                    let segmentNoTranslateNeeded = false;

                    // Extract the first part of the UUID to detect partial occurrences
                    const uuidFirstPart = AI_RETURN_CODE.NO_NEED_TRANSLATE.substring(0, 20);

                    // For streaming mode, we'll use a progress callback that updates the file in real-time
                    const progressCallback = (chunk: string) => {
                        // If we received a signal that no translation is needed, 
                        // we might get the original content back in one chunk
                        if (segmentNoTranslateNeeded) {
                            return; // Skip any further processing
                        }

                        // Check if the chunk or current content contains the special code or its fragments
                        if (chunk.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) ||
                            chunk.includes(uuidFirstPart) ||
                            currentSegmentContent.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) ||
                            currentSegmentContent.includes(uuidFirstPart)) {
                            segmentNoTranslateNeeded = true;
                            // For this segment, use the original segment content instead
                            const originalSegment = segments[i];

                            // Update the file with original content for this segment
                            const currentContent = combineSegments([...translatedSegments, originalSegment]);
                            fs.writeFileSync(targetPath, currentContent);
                            logMessage(`🔄 AI indicated no translation needed for segment ${i + 1}, using original content`);
                            return;
                        }

                        // Make sure we don't write the special code or its fragments to the file
                        let cleanedChunk = chunk;
                        if (chunk.includes(AI_RETURN_CODE.NO_NEED_TRANSLATE) || chunk.includes(uuidFirstPart)) {
                            // Check for the full UUID first
                            const fullCodeIndex = chunk.indexOf(AI_RETURN_CODE.NO_NEED_TRANSLATE);
                            if (fullCodeIndex >= 0) {
                                cleanedChunk = chunk.substring(0, fullCodeIndex);
                            } else {
                                // Check for partial UUID fragments
                                const partialCodeIndex = chunk.indexOf(uuidFirstPart);
                                if (partialCodeIndex >= 0) {
                                    cleanedChunk = chunk.substring(0, partialCodeIndex);
                                }
                            }

                            // If we found a UUID fragment, that's a signal we should use the original content
                            if (cleanedChunk !== chunk) {
                                // Only add any content that appeared before the UUID fragment
                                if (cleanedChunk.length > 0) {
                                    currentSegmentContent += cleanedChunk;
                                }

                                segmentNoTranslateNeeded = true;
                                const originalSegment = segments[i];
                                const currentContent = combineSegments([...translatedSegments, originalSegment]);
                                fs.writeFileSync(targetPath, currentContent);
                                logMessage(`🔄 AI indicated no translation needed for segment ${i + 1}, using original content`);
                                return;
                            }
                        }

                        // If no UUID fragments were found, add the chunk to current segment content
                        currentSegmentContent += cleanedChunk;

                        // Update the file with what we have so far
                        const currentContent = combineSegments([...translatedSegments, currentSegmentContent]);
                        fs.writeFileSync(targetPath, currentContent);
                    };

                    logMessage(`🔄 Using stream mode for segment ${i + 1}/${segments.length}...`);
                    [segmentCode, translatedSegment] = await this.translatorService.translateContent(
                        segment,
                        sourceLang,
                        targetLang,
                        sourcePath,
                        this.cancellationToken,
                        progressCallback
                    );

                    // If the segment translation indicates no translation needed,
                    // use the original segment content
                    if (segmentCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                        translatedSegment = segment;
                    }
                } else {
                    [segmentCode, translatedSegment] = await this.translatorService.translateContent(
                        segment,
                        sourceLang,
                        targetLang,
                        sourcePath,
                        this.cancellationToken
                    );

                    this.checkCancellation();
                    translatedSegments.push(translatedSegment);

                    // Write progress to file
                    const currentContent: string = combineSegments(translatedSegments);
                    fs.writeFileSync(targetPath, currentContent);
                    logMessage(`💾 Written translation result for segment ${i + 1}/${segments.length}`);
                }

                translatedSegments.push(translatedSegment);

                // In non-streaming mode, this was already done, but in streaming mode,
                // we should ensure the final combined content is written
                if (streamMode) {
                    logMessage(`✅ Completed segment ${i + 1}/${segments.length}`);
                }
            }

            const finalContent = combineSegments(translatedSegments);
            return [AI_RETURN_CODE.OK, finalContent];
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logMessage(`❌ Failed to translate: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Handle diff apply translation for a file
     */
    private async handleDiffApplyTranslation(
        sourcePath: string,
        targetPath: string,
        sourceLang: SupportedLanguage,
        targetLang: SupportedLanguage
    ): Promise<[string, string]> {
        try {
            this.checkCancellation();

            // Create diff apply request
            const diffRequest = await this.diffApplyService.createDiffApplyRequest(
                sourcePath,
                targetPath,
                sourceLang,
                targetLang
            );

            if (!diffRequest) {
                throw new Error("Failed to create diff apply request");
            }

            // Perform diff apply translation
            const [returnCode, diffResponse] = await this.translatorService.translateWithDiffApply(
                diffRequest,
                this.cancellationToken
            );

            if (returnCode === AI_RETURN_CODE.OK && diffResponse) {
                // Get diff apply configuration
                const config = vscode.workspace.getConfiguration('projectTranslator');
                const diffApplyConfig = {
                    enabled: config.get<boolean>('diffApply.enabled', true),
                    validationLevel: config.get<'strict' | 'normal' | 'loose'>('diffApply.validationLevel', 'normal'),
                    autoBackup: config.get<boolean>('diffApply.autoBackup', true),
                    maxOperationsPerFile: config.get<number>('diffApply.maxOperationsPerFile', 100)
                };

                // Apply diff operations to target file
                const success = await this.diffApplyService.applyDiffOperations(
                    targetPath,
                    diffResponse.operations || [],
                    diffApplyConfig
                );
                
                if (success) {
                     const updatedContent = fs.readFileSync(targetPath, 'utf8');
                     return [returnCode, updatedContent];
                 } else {
                     throw new Error('Failed to apply diff operations');
                 }
            } else if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                // No changes needed
                const currentContent = fs.readFileSync(targetPath, 'utf8');
                return [returnCode, currentContent];
            } else {
                throw new Error('Diff apply translation failed');
            }
        } catch (error) {
            logMessage(`❌ Diff apply translation failed: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}