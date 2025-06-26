import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';
import { isBinaryFile } from "isbinaryfile";
import * as glob from 'glob';
import { TranslationDatabase } from "../translationDatabase";
import { DestFolder, SupportedLanguage } from "../types/types";
import { TranslatorService, AI_RETURN_CODE } from "./translatorService";
import { GitDiffAnalyzer } from "./diffAnalyzer";
import { estimateTokenCount, segmentText, combineSegments } from "../segmentationUtils";
import { getConfiguration } from "../config/config";

export class FileProcessor {
    private outputChannel: vscode.OutputChannel;
    private translationDb: TranslationDatabase;
    private translatorService: TranslatorService;
    private diffAnalyzer: GitDiffAnalyzer;
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
        
        // Initialize diff analyzer with default configuration
        this.diffAnalyzer = new GitDiffAnalyzer(outputChannel);
        
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
        this.outputChannel.appendLine(`📂 Starting to process directory: ${sourcePath}`); try {
            this.checkCancellation();

            const config = getConfiguration();
            const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
            const sourceRoot = this.translationDb.getSourceRoot() || resolvedSourcePath;
            const relativeToWorkspacePath = path.relative(workspaceRoot, resolvedSourcePath).replace(/\\/g, "/");            // Check if directory should be ignored using glob
            if (config.ignore?.paths) {
                for (const pattern of config.ignore.paths) {
                    if (glob.sync(pattern, { cwd: workspaceRoot }).includes(relativeToWorkspacePath)) {
                        this.outputChannel.appendLine(`⏭️ Skipping ignored directory: ${resolvedSourcePath} (matched pattern: ${pattern})`);
                        return;
                    }
                }
            }

            const files = fs.readdirSync(resolvedSourcePath);
            this.outputChannel.appendLine(`📊 Found ${files.length} files/directories`);

            for (const file of files) {
                this.checkCancellation();

                const fullPath = path.join(resolvedSourcePath, file);
                const stat = fs.statSync(fullPath); if (stat.isDirectory()) {
                    await this.processSubDirectory(fullPath, targetPaths, sourceRoot, config.ignore?.paths || [], sourceLang);
                } else {
                    this.outputChannel.appendLine(`\n📄 File: ${file}`);
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
        const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
        const relativeToWorkspacePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
        let shouldSkip = false;

        for (const pattern of ignorePaths) {
            if (glob.sync(pattern, { cwd: workspaceRoot }).includes(relativeToWorkspacePath)) {
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
            if (!fs.existsSync(resolvedTargetPath)) {
                this.outputChannel.appendLine(`Creating target directory: ${resolvedTargetPath}`);
                try {
                    fs.mkdirSync(resolvedTargetPath, { recursive: true });
                } catch (error) {
                    this.outputChannel.appendLine(`❌ Failed to create directory: ${resolvedTargetPath}`);
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

            this.outputChannel.appendLine(`\n🔄 Translating file: ${path.basename(sourcePath)} from ${sourceLang} to ${targetLang}`);

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
                this.outputChannel.appendLine(`⏭️ Skipping ignored file: ${resolvedSourcePath}`);
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
            this.outputChannel.appendLine(`❌ File translation failed: ${error instanceof Error ? error.message : String(error)}`);
            this.failedFilesCount++;
            this.failedFilePaths.push(sourcePath);
            throw error;
        }
    } private async shouldSkipFile(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<boolean> {
        // Check translation interval
        const shouldTranslate = await this.translationDb.shouldTranslate(sourcePath, targetPath, targetLang);
        if (!shouldTranslate) {
            this.outputChannel.appendLine("⏭️ Skipping translation");
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
                this.outputChannel.appendLine("⏭️ Source file and target file content are the same, skipping copy");
                this.skippedFilesCount++;
                return;
            }
        }

        this.outputChannel.appendLine(`📦 Detected file type for copy-only: ${path.extname(sourcePath)}`);
        this.outputChannel.appendLine("🔄 Performing file copy");
        fs.copyFileSync(sourcePath, targetPath);
        this.outputChannel.appendLine("✅ Copy-only file copy completed");
        this.processedFilesCount++;
    } private async handleBinaryFile(sourcePath: string, targetPath: string) {
        this.outputChannel.appendLine("📦 Detected binary file, performing direct copy");
        fs.copyFileSync(sourcePath, targetPath);
        this.outputChannel.appendLine("✅ Binary file copy completed");
        this.processedFilesCount++;
    }    private async handleTextFile(sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage) {
        // Handle pause state
        while (this.isPaused) {
            this.checkCancellation();
            await new Promise(resolve => globalThis.setTimeout(resolve, 500));
            this.outputChannel.appendLine("⏸️ Translation paused...");
        }

        // Check if diff apply is enabled and if we should use differential translation
        const config = getConfiguration();
        const shouldUseDiffTranslation = await this.shouldUseDifferentialTranslation(sourcePath, targetLang, config);
        
        if (shouldUseDiffTranslation.useDiff) {
            this.outputChannel.appendLine("🔍 Using diff translation mode");
            try {
                const success = await this.handleDifferentialTranslation(
                    sourcePath, 
                    targetPath, 
                    sourceLang, 
                    targetLang, 
                    shouldUseDiffTranslation.lastCommitId!
                );
                
                if (success) {
                    this.outputChannel.appendLine("✅ Diff translation completed");
                    return;
                }
                
                // If diff translation fails, fallback to full translation based on config
                if (config.diffApply?.fallbackToFullTranslation) {
                    this.outputChannel.appendLine("⚠️ Diff translation failed, falling back to full translation");
                } else {
                    throw new Error("Diff translation failed and fallback mechanism is not enabled");
                }
            } catch (error) {
                this.outputChannel.appendLine(`❌ Error during diff translation: ${error}`);
                if (config.diffApply?.fallbackToFullTranslation) {
                    this.outputChannel.appendLine("⚠️ Falling back to full translation");
                } else {
                    throw error;
                }
            }
        }

        // Start translation (full translation mode)
        this.outputChannel.appendLine("🔄 Starting file content translation...");
        const content = fs.readFileSync(sourcePath, "utf8");
        const startTime = Date.now();

        try {
            const config = getConfiguration();
            const { maxTokensPerSegment = 4096, streamMode } = config.currentVendor;
            const estimatedTokens = estimateTokenCount(content);

            let returnCode: string;
            let translatedContent: string;

            if (estimatedTokens > maxTokensPerSegment) {
                [returnCode, translatedContent] = await this.handleLargeFile(content, sourcePath, targetPath, sourceLang, targetLang);

                // No need to write the file here - either it's already been written during processing
                // or we directly copied the file when NO_NEED_TRANSLATE was detected
                if (returnCode === AI_RETURN_CODE.OK) {
                    this.checkCancellation();
                    this.outputChannel.appendLine("💾 Translation result written");
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

                    this.outputChannel.appendLine("🔄 Using stream mode for translation...");
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
                        this.outputChannel.appendLine("🔄 No translation needed, copying file directly");
                        fs.writeFileSync(targetPath, content);
                    } else {
                        // Otherwise write the collected content
                        fs.writeFileSync(targetPath, translatedContent);
                        this.outputChannel.appendLine("💾 Translation result written");
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
                        this.outputChannel.appendLine("💾 Translation result written");
                    } else if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                        // Copy the file directly for NO_NEED_TRANSLATE
                        fs.writeFileSync(targetPath, content);
                        this.outputChannel.appendLine("🔄 No translation needed, copying file directly");
                    }
                }
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

    private async handleLargeFile(content: string, sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage): Promise<[string, string]> {
        const config = getConfiguration();
        const { maxTokensPerSegment, streamMode } = config.currentVendor;
        const segments = segmentText(content, sourcePath, maxTokensPerSegment);
        const translatedSegments: string[] = [];

        this.outputChannel.appendLine(`📑 File too large, split into ${segments.length} segments`);

        // First, translate just the first segment to check if translation is needed
        this.checkCancellation();
        const firstSegment = segments[0];
        const firstSegmentTokens = estimateTokenCount(firstSegment);
        this.outputChannel.appendLine(
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
                this.outputChannel.appendLine(`🔄 AI indicated no translation needed for this file, skipping entire file translation`);
                fs.writeFileSync(targetPath, content);
                this.outputChannel.appendLine(`💾 Written original content to target file`);

                // Update translation time to prevent future unnecessary translation attempts
                await this.translationDb.updateTranslationTime(sourcePath, targetPath, targetLang);
                this.outputChannel.appendLine("✅ Translation timestamp updated");
                this.processedFilesCount++;

                return [AI_RETURN_CODE.NO_NEED_TRANSLATE, content];
            }

            // If translation is needed, add first segment and continue with the rest
            translatedSegments.push(firstTranslatedSegment);

            // Write progress to file
            fs.writeFileSync(targetPath, firstTranslatedSegment);
            this.outputChannel.appendLine(`💾 Written translation result for segment 1/${segments.length}`);

            // Process remaining segments
            for (let i = 1; i < segments.length; i++) {
                this.checkCancellation();

                const segment = segments[i];
                const segmentTokens = estimateTokenCount(segment);
                this.outputChannel.appendLine(
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
                            this.outputChannel.appendLine(`🔄 AI indicated no translation needed for segment ${i + 1}, using original content`);
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
                                this.outputChannel.appendLine(`🔄 AI indicated no translation needed for segment ${i + 1}, using original content`);
                                return;
                            }
                        }

                        // If no UUID fragments were found, add the chunk to current segment content
                        currentSegmentContent += cleanedChunk;

                        // Update the file with what we have so far
                        const currentContent = combineSegments([...translatedSegments, currentSegmentContent]);
                        fs.writeFileSync(targetPath, currentContent);
                    };

                    this.outputChannel.appendLine(`🔄 Using stream mode for segment ${i + 1}/${segments.length}...`);
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
                    this.outputChannel.appendLine(`💾 Written translation result for segment ${i + 1}/${segments.length}`);
                }

                translatedSegments.push(translatedSegment);

                // In non-streaming mode, this was already done, but in streaming mode,
                // we should ensure the final combined content is written
                if (streamMode) {
                    this.outputChannel.appendLine(`✅ Completed segment ${i + 1}/${segments.length}`);
                }
            }

            const finalContent = combineSegments(translatedSegments);
            return [AI_RETURN_CODE.OK, finalContent];
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            this.outputChannel.appendLine(`❌ Failed to translate: ${errorMessage}`);
            throw error;
        }
    }

    /**
     * Determine whether to use diff translation
     */
    private async shouldUseDifferentialTranslation(
        sourcePath: string, 
        targetLang: SupportedLanguage, 
        config: any
    ): Promise<{ useDiff: boolean; lastCommitId?: string }> {
        // Check if diff apply is enabled
        if (!config.diffApply?.enabled) {
            return { useDiff: false };
        }

        try {
            // Check if differential translation is needed
            const needsDiff = await this.translationDb.needsDiffTranslation(sourcePath, targetLang);
              if (!needsDiff.needsDiff) {
                return { useDiff: false };
            }

            // Get the last translation commit ID
            const lastCommitId = await this.translationDb.getLastTranslationCommitId(sourcePath, targetLang);
            
            if (!lastCommitId) {
                // If there is no last translation record, do not use diff translation
                return { useDiff: false };
            }

            return { 
                useDiff: true, 
                lastCommitId 
            };
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ Diff detection failed: ${error}`);
            return { useDiff: false };
        }
    }

    /**
     * Handle diff translation
     */
    private async handleDifferentialTranslation(
        sourcePath: string,
        targetPath: string,
        sourceLang: SupportedLanguage,
        targetLang: SupportedLanguage,
        lastCommitId: string
    ): Promise<boolean> {
        try {
            const config = getConfiguration();            // Get file diff information
            const diffResult = await this.diffAnalyzer.getDiffInfo(
                sourcePath,
                lastCommitId,
                config.diffApply?.strategy || 'auto'
            );

            if (!diffResult.hasChanges || diffResult.changedLines.length === 0) {
                this.outputChannel.appendLine("📋 No valid file differences detected");
                return false;
            }

            this.outputChannel.appendLine(`🔍 Detected ${diffResult.changedLines.length} diff blocks`);

            // Read current source and target file content
            const sourceContent = fs.readFileSync(sourcePath, 'utf8');
            let targetContent = '';
            
            // If target file exists, read its content
            if (fs.existsSync(targetPath)) {
                targetContent = fs.readFileSync(targetPath, 'utf8');
            }            // Extract the differences that need translation
            const diffTexts: string[] = [];
            const sourceLines = sourceContent.split('\n');
            
            for (const change of diffResult.changedLines) {
                if (change.changeType === 'added' || change.changeType === 'modified') {
                    // Extract the changed line content
                    const lineIndex = Math.max(0, change.lineNumber - 1);
                    const changedText = change.newContent;
                    
                    if (changedText.trim()) {
                        diffTexts.push(changedText);
                    }
                }
            }

            if (diffTexts.length === 0) {
                this.outputChannel.appendLine("📋 No differences need translation");
                return false;
            }

            // Translate all differences in a single API call
            this.outputChannel.appendLine(`🔤 Starting batch translation of ${diffTexts.length} diff segments`);
            const translatedTexts: string[] = [];

            if (diffTexts.length > 0) {
                this.checkCancellation();
                
                // Combine all diff texts into a single request with formatting
                const batchContent = this.formatDiffTextsForBatchTranslation(diffTexts);
                this.outputChannel.appendLine(`🔤 Sending batch translation request for all ${diffTexts.length} segments`);
                
                const [returnCode, batchTranslatedText] = await this.translatorService.translateContent(
                    batchContent,
                    sourceLang,
                    targetLang,
                    sourcePath,
                    this.cancellationToken,
                    undefined, // progressCallback
                    true // isDiffTranslation
                );

                if (returnCode === AI_RETURN_CODE.OK) {
                    // Parse the batch translation result
                    const parsedResults = this.parseBatchTranslationResult(batchTranslatedText, diffTexts.length);
                    if (parsedResults.length === diffTexts.length) {
                        translatedTexts.push(...parsedResults);
                        this.outputChannel.appendLine(`✅ Successfully parsed ${parsedResults.length} translated segments`);
                    } else {
                        this.outputChannel.appendLine(`⚠️ Parsed result count (${parsedResults.length}) doesn't match expected count (${diffTexts.length}), falling back to individual translation`);
                        return await this.fallbackToIndividualTranslation(diffTexts, sourceLang, targetLang, sourcePath, targetPath, diffResult, diffResult.changedLines);
                    }
                } else if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                    // If no translation is needed, use the original texts
                    translatedTexts.push(...diffTexts);
                    this.outputChannel.appendLine(`🔄 No translation needed for diff segments`);
                } else {
                    this.outputChannel.appendLine(`❌ Batch translation failed, falling back to individual translation`);
                    return await this.fallbackToIndividualTranslation(diffTexts, sourceLang, targetLang, sourcePath, targetPath, diffResult, diffResult.changedLines);
                }
            }            // Apply translation results to target file
            const success = await this.applyTranslationDiff(
                sourcePath,
                targetPath,
                sourceContent,
                targetContent,
                diffResult.changedLines,
                translatedTexts
            );            if (success) {
                // Update commit ID in translation database
                // We can use git API to get the current HEAD commit ID
                try {
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(sourcePath));
                    if (workspaceFolder) {
                        const gitExtension = vscode.extensions.getExtension('vscode.git')?.exports;
                        if (gitExtension) {
                            const git = gitExtension.getAPI(1);
                            const repository = git.getRepository(workspaceFolder.uri);
                            if (repository && repository.state.HEAD?.commit) {
                                await this.translationDb.updateTranslationCommitId(
                                    sourcePath,
                                    targetLang,
                                    repository.state.HEAD.commit
                                );
                            }
                        }
                    }
                } catch (error) {
                    this.outputChannel.appendLine(`⚠️ Failed to update commit ID: ${error}`);
                }
                
                this.outputChannel.appendLine("✅ Diff translation applied successfully");
                return true;
            }

            return false;
        } catch (error) {
            this.outputChannel.appendLine(`❌ Diff translation processing failed: ${error}`);
            return false;
        }
    }    /**
     * Format diff texts for batch translation
     */
    private formatDiffTextsForBatchTranslation(diffTexts: string[]): string {
        const formattedSegments = diffTexts.map((text, index) => {
            return `<DIFF_SEGMENT_${index + 1}>
${text}
</DIFF_SEGMENT_${index + 1}>`;
        });
        
        const batchContent = `Please translate the following ${diffTexts.length} diff segments. Each segment is wrapped with XML-like tags for identification. Maintain the same structure in your response and translate only the content within each segment.

${formattedSegments.join('\n\n')}

Please respond with the translated segments in the same format, preserving the segment tags and order.`;
        
        return batchContent;
    }

    /**
     * Parse batch translation result
     */
    private parseBatchTranslationResult(batchResult: string, expectedCount: number): string[] {
        const results: string[] = [];
        
        try {
            // Extract segments using regex pattern
            for (let i = 1; i <= expectedCount; i++) {
                const segmentPattern = new RegExp(`<DIFF_SEGMENT_${i}>([\s\S]*?)</DIFF_SEGMENT_${i}>`, 'i');
                const match = batchResult.match(segmentPattern);
                
                if (match && match[1]) {
                    results.push(match[1].trim());
                } else {
                    this.outputChannel.appendLine(`⚠️ Could not find segment ${i} in batch translation result`);
                    // Try alternative parsing methods
                    const fallbackResult = this.tryAlternativeParsing(batchResult, i, expectedCount);
                    if (fallbackResult) {
                        results.push(fallbackResult);
                    } else {
                        break; // Stop parsing if we can't find a segment
                    }
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`❌ Error parsing batch translation result: ${error}`);
        }
        
        return results;
    }

    /**
     * Try alternative parsing methods when structured parsing fails
     */
    private tryAlternativeParsing(batchResult: string, segmentIndex: number, totalSegments: number): string | null {
        try {
            // Method 1: Try to split by line breaks and find content
            const lines = batchResult.split('\n');
            const segmentLines: string[] = [];
            let inSegment = false;
            
            for (const line of lines) {
                if (line.includes(`DIFF_SEGMENT_${segmentIndex}`)) {
                    inSegment = !inSegment;
                    continue;
                }
                
                if (inSegment && !line.includes('DIFF_SEGMENT_')) {
                    segmentLines.push(line);
                }
                
                if (inSegment && line.includes(`</DIFF_SEGMENT_${segmentIndex}`)) {
                    break;
                }
            }
            
            if (segmentLines.length > 0) {
                return segmentLines.join('\n').trim();
            }
            
            // Method 2: If structured parsing completely fails, try to split the result evenly
            if (segmentIndex === 1 && totalSegments > 1) {
                const cleanedResult = batchResult.replace(/<\/?DIFF_SEGMENT_\d+>/g, '').trim();
                const segments = cleanedResult.split(/\n\s*\n/).filter(s => s.trim());
                
                if (segments.length === totalSegments) {
                    return segments[segmentIndex - 1]?.trim() || null;
                }
            }
        } catch (error) {
            this.outputChannel.appendLine(`❌ Alternative parsing failed: ${error}`);
        }
        
        return null;
    }

    /**
     * Fallback to individual translation when batch translation fails
     */
    private async fallbackToIndividualTranslation(
        diffTexts: string[],
        sourceLang: SupportedLanguage,
        targetLang: SupportedLanguage,
        sourcePath: string,
        targetPath: string,
        diffInfo?: any,
        changedLines?: Array<{
            lineNumber: number;
            oldContent: string;
            newContent: string;
            changeType: 'added' | 'deleted' | 'modified';
        }>
    ): Promise<boolean> {
        this.outputChannel.appendLine(`🔄 Falling back to individual translation for ${diffTexts.length} segments`);
        const translatedTexts: string[] = [];
        
        for (let i = 0; i < diffTexts.length; i++) {
            const text = diffTexts[i];
            this.checkCancellation();
            
            this.outputChannel.appendLine(`🔤 Translating segment ${i + 1}/${diffTexts.length} (fallback mode)`);
            
            const [returnCode, translatedText] = await this.translatorService.translateContent(
                text,
                sourceLang,
                targetLang,
                sourcePath,
                this.cancellationToken,
                undefined, // progressCallback
                true // isDiffTranslation
            );

            if (returnCode === AI_RETURN_CODE.OK) {
                translatedTexts.push(translatedText);
            } else if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                translatedTexts.push(text);
            } else {
                this.outputChannel.appendLine(`❌ Translation of segment ${i + 1} failed in fallback mode`);
                return false;
            }
        }
        
        // Apply the individually translated texts using the same logic as batch translation
        if (diffInfo && changedLines && translatedTexts.length === diffTexts.length) {
            const sourceContent = fs.readFileSync(sourcePath, 'utf8');
            let targetContent = '';
            
            try {
                if (fs.existsSync(targetPath)) {
                    targetContent = fs.readFileSync(targetPath, 'utf8');
                } else {
                    targetContent = sourceContent;
                }
            } catch (error) {
                targetContent = sourceContent;
            }
            
            const success = await this.applyTranslationDiff(
                sourcePath,
                targetPath,
                sourceContent,
                targetContent,
                changedLines,
                translatedTexts
            );
            
            if (success) {
                this.outputChannel.appendLine(`✅ Successfully applied ${translatedTexts.length} individual translations`);
                return true;
            } else {
                this.outputChannel.appendLine(`❌ Failed to apply individual translations`);
                return false;
            }
        }
        
        this.outputChannel.appendLine(`⚠️ Missing required parameters for diff application in fallback mode`);
        return false;
    }

    /**
     * Apply translation diff to target file
     */
    private async applyTranslationDiff(
        sourcePath: string,
        targetPath: string,
        sourceContent: string,
        targetContent: string,
        changedLines: Array<{
            lineNumber: number;
            oldContent: string;
            newContent: string;
            changeType: 'added' | 'deleted' | 'modified';
        }>,
        translatedTexts: string[]
    ): Promise<boolean> {
        try {
            // If target file does not exist, create the directory first
            const targetDir = path.dirname(targetPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            let resultContent = targetContent;
            const sourceLines = sourceContent.split('\n');
            let targetLines = targetContent ? targetContent.split('\n') : [...sourceLines];
            
            let translatedIndex = 0;

            // Process changes in reverse order to avoid line number offset issues
            const sortedChanges = [...changedLines].sort((a, b) => b.lineNumber - a.lineNumber);

            for (const change of sortedChanges) {
                if (change.changeType === 'added' || change.changeType === 'modified') {
                    const translatedText = translatedTexts[translatedIndex++];
                    const translatedLines = translatedText.split('\n');
                    
                    const lineIndex = Math.max(0, change.lineNumber - 1);
                    
                    // Replace the corresponding line in the target file
                    if (change.changeType === 'modified') {
                        targetLines[lineIndex] = translatedLines[0] || '';
                    } else if (change.changeType === 'added') {
                        targetLines.splice(lineIndex, 0, translatedLines[0] || '');
                    }
                } else if (change.changeType === 'deleted') {
                    // Deleted lines should also be removed from the target file
                    const lineIndex = Math.max(0, change.lineNumber - 1);
                    if (lineIndex < targetLines.length) {
                        targetLines.splice(lineIndex, 1);
                    }
                }
            }

            // Write to target file
            const finalContent = targetLines.join('\n');
            fs.writeFileSync(targetPath, finalContent, 'utf8');
            
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`❌ Failed to apply diff: ${error}`);
            return false;
        }
    }
}