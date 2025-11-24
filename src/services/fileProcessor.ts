import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Buffer } from 'buffer';
import { isBinaryFile } from "isbinaryfile";
import * as glob from 'glob';
import { TranslationDatabase } from "../translationDatabase";
import { DestFolder, SupportedLanguage } from "../types/types";
import { TranslatorService } from "./translatorService";
import { SearchReplaceDiffApplier } from './searchReplaceDiffApplier'

import { estimateTokenCount, segmentText, combineSegments } from "../segmentationUtils";
import { getConfiguration } from "../config/config";
import { logMessage } from '../extension';

// AI return code.
const AI_RETURN_CODE = {
  OK: "OK",
  NO_NEED_TRANSLATE: "727d2eb8-8683-42bd-a1d0-f604fcd82163",
};

const fsp = fs.promises;

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
    
    // Cache to store whether a source file needs translation (to ensure each source is checked only once)
    private translationDecisionCache: Map<string, {shouldTranslate: boolean, timestamp: number}> = new Map();
    
    // Cache to store files that were marked as "no need to translate" during this session
    private noTranslateCache: Map<string, boolean> = new Map();

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

        logMessage("\n[Directory Processing] ----------------------------------------");
        logMessage(`📂 Starting to process directory: ${sourcePath}`);
        try {
            this.checkCancellation();

            const config = await getConfiguration();
            const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
            const sourceRoot = this.translationDb.getSourceRoot() || resolvedSourcePath;
            const relativeToWorkspacePath = path.relative(workspaceRoot, resolvedSourcePath).replace(/\\/g, "/");

            // Check if directory should be ignored using glob
            if (config.ignore?.paths) {
                for (const pattern of config.ignore.paths) {
                    if (glob.sync(pattern, { cwd: workspaceRoot }).includes(relativeToWorkspacePath)) {
                        logMessage(`⏭️ Skipping ignored directory: ${resolvedSourcePath} (matched pattern: ${pattern})`);
                        return;
                    }
                }
            }

            const files = await fsp.readdir(resolvedSourcePath);
            logMessage(`📊 Found ${files.length} files/directories`);

            let processedEntries = 0;
            for (const file of files) {
                this.checkCancellation();

                const fullPath = path.join(resolvedSourcePath, file);
                const stat = await fsp.stat(fullPath);
                if (stat.isDirectory()) {
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

                processedEntries++;
                if (processedEntries % 10 === 0) {
                    await this.yieldToEventLoop();
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

        // Create corresponding directories for each target path（使用异步 mkdir 避免阻塞）
        for (const target of targetPaths) {
            const resolvedTargetPath = this.resolvePath(target.path);
            logMessage(`Ensuring target directory exists: ${resolvedTargetPath}`);
            try {
                await fsp.mkdir(resolvedTargetPath, { recursive: true });
            } catch (error) {
                logMessage(`❌ Failed to create directory: ${resolvedTargetPath}`);
                logMessage(`❌ Error details: ${error instanceof Error ? error.message : String(error)}`);
                throw error;
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

            // Validate paths（异步判断文件是否存在）
            try {
                const stat = await fsp.stat(resolvedSourcePath);
                if (!stat.isFile()) {
                    throw new Error(`Source path is not a file: ${sourcePath}`);
                }
            } catch {
                throw new Error(`Source file not found: ${sourcePath}`);
            }

            // Ensure target directory exists
            const targetDir = path.dirname(resolvedTargetPath);
            await fsp.mkdir(targetDir, { recursive: true });

            // Skip if file should be ignored
            if (await this.shouldSkipFile(resolvedSourcePath, resolvedTargetPath, targetLang)) {
                return;
            }

            // Check if file should be skipped based on front matter markers
            if (await this.shouldSkipByFrontMatter(resolvedSourcePath)) {
                logMessage(`⏭️ Skipping file due to front matter marker: ${resolvedSourcePath}`);
                // Copy the file directly without translation
                await this.handleCopyOnlyFile(resolvedSourcePath, resolvedTargetPath);
                return;
            }

            // Handle different file types
            const ext = path.extname(resolvedSourcePath).toLowerCase();
            const config = await getConfiguration();

            // Check if file should be completely ignored
            if (this.shouldIgnoreFile(
                resolvedSourcePath,
                ext,
                { ignore: config.ignore ?? { paths: [], extensions: [] } }
            )) {
                logMessage(`⏭️ Skipping ignored file: ${resolvedSourcePath}`);
                return;
            }

            // Check if file should be copied only (not translated)
            if (this.shouldCopyOnly(
                resolvedSourcePath,
                ext,
                { copyOnly: config.copyOnly ?? { paths: [], extensions: [] } }
            )) {
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
    } 
    
    private async shouldSkipFile(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<boolean> {
        // Check if we've already decided this source file doesn't need translation in this session
        if (this.noTranslateCache.has(sourcePath)) {
            logMessage(`⏭️ Skipping translation (previously marked as no need to translate in this session)`);
            this.skippedFilesCount++;
            return true;
        }
        
        // Check if we have a recent, valid decision in the cache
        const cachedDecision = this.translationDecisionCache.get(sourcePath);
        if (cachedDecision && (Date.now() - cachedDecision.timestamp) < 5 * 60 * 1000) { // 5-minute cache validity
            if (!cachedDecision.shouldTranslate) {
                logMessage(`⏭️ Skipping translation (cached decision: no need to translate)`);
                this.skippedFilesCount++;
                this.noTranslateCache.set(sourcePath, true); // Ensure session cache is also populated
                return true;
            } else {
                // If cache says we should translate, we don't need to check the database again.
                return false;
            }
        }

        // If no valid cache entry, perform the check against the database
        const shouldTranslate = await this.translationDb.shouldTranslate(sourcePath, targetPath, targetLang);
        
        // Cache the new decision
        this.translationDecisionCache.set(sourcePath, { shouldTranslate, timestamp: Date.now() });
        
        if (!shouldTranslate) {
            logMessage("⏭️ Skipping translation (fresh decision: no need to translate)");
            this.noTranslateCache.set(sourcePath, true); // Mark for this session
            this.skippedFilesCount++;
            return true;
        }

        return false;
    }

    private async shouldSkipByFrontMatter(sourcePath: string): Promise<boolean> {
        // Only process if the feature is enabled and the file is markdown
        const config = await getConfiguration();
        const frontMatterConfig = config.skipFrontMatter;
        
        if (!frontMatterConfig || !frontMatterConfig.enabled) {
            return false;
        }
        
        // Check if it's a markdown file
        const ext = path.extname(sourcePath).toLowerCase();
        if (ext !== '.md' && ext !== '.markdown') {
            return false;
        }
        
        // Check if file exists
        try {
            // Read the file content
            const content = await fsp.readFile(sourcePath, 'utf-8');
            
            // Check if it has front matter
            if (!content.startsWith('---')) {
                return false;
            }
            
            // Extract front matter
            const frontMatterEnd = content.indexOf('---', 3);
            if (frontMatterEnd === -1) {
                return false;
            }
            
            const frontMatter = content.substring(3, frontMatterEnd).trim();
            
            // Parse front matter (simple YAML parsing)
            const frontMatterLines = frontMatter.split('\n');
            const frontMatterObj: Record<string, string> = {};
            
            for (const line of frontMatterLines) {
                const colonIndex = line.indexOf(':');
                if (colonIndex > 0) {
                    const key = line.substring(0, colonIndex).trim();
                    const value = line.substring(colonIndex + 1).trim().replace(/^['"]|['"]$/g, ''); // Remove quotes
                    frontMatterObj[key] = value;
                }
            }
            
            // Check if any configured markers match
            for (const marker of frontMatterConfig.markers) {
                if (frontMatterObj[marker.key] === marker.value) {
                    return true;
                }
            }
            
            return false;
        } catch (error) {
            logMessage(`⚠️ Error checking front matter in ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`);
            return false;
        }
    }

    private shouldIgnoreFile(sourcePath: string, ext: string, config: {
        ignore: { paths: string[], extensions: string[] }
    }): boolean {
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

    private shouldCopyOnly(sourcePath: string, ext: string, config: {
        copyOnly: { paths: string[], extensions: string[] }
    }): boolean {
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
        try {
            const targetStat = await fsp.stat(targetPath);
            if (targetStat.isFile()) {
                const [sourceContent, targetContent] = await Promise.all([
                    fsp.readFile(sourcePath),
                    fsp.readFile(targetPath),
                ]);
                if (Buffer.compare(sourceContent, targetContent) === 0) {
                    logMessage("⏭️ Source file and target file content are the same, skipping copy");
                    this.skippedFilesCount++;
                    return;
                }
            }
        } catch {
            // target 不存在或无法访问，直接继续执行复制逻辑
        }

        logMessage(`📦 Detected file type for copy-only: ${path.extname(sourcePath)}`);
        logMessage("🔄 Performing file copy");
        await fsp.copyFile(sourcePath, targetPath);
        logMessage("✅ Copy-only file copy completed");
        this.processedFilesCount++;
    }

    private async handleBinaryFile(sourcePath: string, targetPath: string) {
        logMessage("📦 Detected binary file, performing direct copy");
        await fsp.copyFile(sourcePath, targetPath);
        logMessage("✅ Binary file copy completed");
        this.processedFilesCount++;
    }

    private async handleTextFile(sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage) {
        // Handle pause state
        while (this.isPaused) {
            this.checkCancellation();
            await new Promise(resolve => globalThis.setTimeout(resolve, 500));
            logMessage("⏸️ Translation paused...");
        }

        const startTime = Date.now();
        let wasTranslated = false;

        // Start translation
        logMessage("🔄 Starting file content translation...");
        const content = await fsp.readFile(sourcePath, "utf8");

        try {
            const config = await getConfiguration();
            const { maxTokensPerSegment = 4096, streamMode } = config.currentVendor;
            const estimatedTokens = estimateTokenCount(content);

            // Diff-apply branch: if enabled and target exists, try differential edits first
            const diffApplyEnabled = !!config.diffApply?.enabled
            let targetExists = false
            try {
                const stat = await fsp.stat(targetPath)
                targetExists = stat.isFile()
            } catch {
                targetExists = false
            }
            if (diffApplyEnabled && targetExists) {
                logMessage("🧩 Diff-apply mode enabled; generating edits...")
                const currentTarget = await fsp.readFile(targetPath, 'utf8')
                try {
                    const searchReplace = await this.translatorService.generateSearchReplaceDiff(
                        content,
                        currentTarget,
                        sourcePath,
                        sourceLang,
                        targetLang
                    )
                    logMessage(`🔄 Generated SEARCH/REPLACE diff: ${searchReplace}`)                    
                    const { updatedText, appliedCount } = SearchReplaceDiffApplier.apply(
                        currentTarget,
                        searchReplace,
                        { fuzzyThreshold: 1.0, bufferLines: 40 },
                        (m, lvl = 'info') => logMessage(m, lvl)
                    )
                    logMessage(`🔄 Diff edits applied (${appliedCount} ops)`)                    
                    if (appliedCount > 0) {
                        if (config.diffApply?.autoBackup) {
                            // 手动备份，复用原有命名规则
                            const ts = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+$/, '')
                            const backupPath = `${targetPath}.bak.${ts}`
                            await fsp.copyFile(targetPath, backupPath)
                        }
                        await fsp.writeFile(targetPath, updatedText)
                        await this.translationDb.updateTranslationTime(sourcePath, targetPath, targetLang);
                        logMessage(`✅ Diff edits applied (${appliedCount} ops)`)                    
                        this.processedFilesCount++
                        return
                    } else {
                        logMessage("ℹ️ No diff operations necessary; Skipping file", "warn")
                    }
                } catch (e) {
                    logMessage(`⚠️ Diff-apply failed: ${e instanceof Error ? e.message : String(e)}; fallback to normal translation`)
                }
            }

            let returnCode: string;
            let translatedContent: string;

            if (estimatedTokens > maxTokensPerSegment) {
                [returnCode, translatedContent] = await this.handleLargeFile(content, sourcePath, targetPath, sourceLang, targetLang);

                // No need to write the file here - either it's already been written during processing
                // or we directly copied the file when NO_NEED_TRANSLATE was detected
                if (returnCode === AI_RETURN_CODE.OK) {
                    this.checkCancellation();
                    logMessage("💾 Translation result written");
                    wasTranslated = translatedContent !== content;
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
                        progressCallback,
                        true // isFirstSegment = true for single file translation
                    );

                    // If NO_NEED_TRANSLATE was detected, skip the file but still update translation time
                        if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                            logMessage("⏭️ No translation needed, skipping file");
                            this.skippedFilesCount++;
                            // Cache the decision so subsequent targets reuse this result
                            this.noTranslateCache.set(sourcePath, true);
                            this.translationDecisionCache.set(sourcePath, { shouldTranslate: false, timestamp: Date.now() });
                            return; // Skip processing this file
                        } else {
                            await fsp.writeFile(targetPath, streamedContent);
                            logMessage("💾 Stream translation result written");
                            wasTranslated = streamedContent !== content;
                        }
                } else {
                    logMessage("🔄 Using standard mode for translation...");
                    [returnCode, translatedContent] = await this.translatorService.translateContent(
                        content,
                        sourceLang,
                        targetLang,
                        sourcePath,
                        this.cancellationToken,
                        undefined, // no progressCallback for standard mode
                        true // isFirstSegment = true for single file translation
                    );

                    this.checkCancellation();

                    // If NO_NEED_TRANSLATE was detected, skip the file
                        if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                            logMessage("⏭️ No translation needed, skipping file");
                            this.skippedFilesCount++;
                            // Cache the decision so subsequent targets reuse this result
                            this.noTranslateCache.set(sourcePath, true);
                            this.translationDecisionCache.set(sourcePath, { shouldTranslate: false, timestamp: Date.now() });
                            return; // Skip processing this file
                        } else {
                            await fsp.writeFile(targetPath, translatedContent);
                            logMessage("💾 Translation result written");
                            wasTranslated = translatedContent !== content;
                        }
                }
            }

            const duration = Date.now() - startTime;
            if (wasTranslated) {
                await this.translationDb.updateTranslationTime(sourcePath, targetPath, targetLang);
            } else {
                logMessage("ℹ️ Translation timestamp not updated (no actual translation performed)");
            }
            logMessage(`⏱️ File translation completed in ${duration}ms (${(duration / 1000).toFixed(2)}s)`);
            this.processedFilesCount++;
            return { success: true, duration };
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                throw error;
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logMessage(`❌ Failed to translate file: ${errorMessage}`);
            this.failedFilesCount++;
            this.failedFilePaths.push(sourcePath);
            return { success: false, error: errorMessage };
        }
    }

    /**
     * Handle large file translation by segmenting the content
     */
    private async handleLargeFile(
        content: string,
        sourcePath: string,
        targetPath: string,
        sourceLang: SupportedLanguage,
        targetLang: SupportedLanguage
    ): Promise<[string, string]> {
        try {
            logMessage("📏 Large file detected, segmenting content...");
            const config = await getConfiguration();
            const { maxTokensPerSegment = 4096, streamMode } = config.currentVendor;

            // Segment the content
            const segments = segmentText(content, sourcePath, maxTokensPerSegment);
            logMessage(`📦 Segmented into ${segments.length} parts`);

            const translatedSegments: string[] = [];

            // 用于保证流式写入的顺序性
            let lastWritePromise: Promise<void> = Promise.resolve();

            // Translate each segment
            for (let i = 0; i < segments.length; i++) {
                this.checkCancellation();

                const segment = segments[i];
                let segmentCode: string;
                let translatedSegment: string;

                if (streamMode) {
                    // For streaming mode, we'll collect content but only write to file if NO_NEED_TRANSLATE is not detected
                    let currentSegmentContent = '';
                    let originalSegment = '';

                    // Define progress callback for streaming
                    const progressCallback = (chunk: string) => {
                        // Clean up the chunk to remove any UUID fragments that might have been included
                        const cleanedChunk = chunk.replace(/[\s\S]*BEGIN SEGMENT[\s\S]*?END SEGMENT[\s\S]*/g, (match) => {
                            // Extract the actual content between UUID markers
                            const uuidContentMatch = match.match(/[\s\S]*BEGIN SEGMENT ([\s\S]*?) END SEGMENT[\s\S]*/);
                            if (uuidContentMatch && uuidContentMatch[1]) {
                                return uuidContentMatch[1];
                            }
                            return '';
                        });

                        // If we detect UUID fragments, it means the AI returned NO_NEED_TRANSLATE
                        if (chunk.includes("BEGIN SEGMENT") && chunk.includes("END SEGMENT")) {
                            // Extract the original segment content
                            originalSegment = cleanedChunk;
                            const currentContent = combineSegments([...translatedSegments, originalSegment]);
                            lastWritePromise = lastWritePromise.then(() =>
                                fsp.writeFile(targetPath, currentContent).then(() => {
                                    logMessage(`🔄 AI indicated no translation needed for segment ${i + 1}, using original content`);
                                }).catch((err) => {
                                    logMessage(`❌ Failed to write segment (no-translate) content: ${err instanceof Error ? err.message : String(err)}`, "error");
                                })
                            );
                            return;
                        }

                        // If no UUID fragments were found, add the chunk to current segment content
                        currentSegmentContent += cleanedChunk;

                        // Update the file with what we have so far（顺序串行异步写入）
                        const currentContent = combineSegments([...translatedSegments, currentSegmentContent]);
                        lastWritePromise = lastWritePromise.then(() =>
                            fsp.writeFile(targetPath, currentContent).catch((err) => {
                                logMessage(`❌ Failed to write segment content: ${err instanceof Error ? err.message : String(err)}`, "error");
                            })
                        );
                    };

                    logMessage(`🔄 Using stream mode for segment ${i + 1}/${segments.length}...`);
                    [segmentCode, translatedSegment] = await this.translatorService.translateContent(
                        segment,
                        sourceLang,
                        targetLang,
                        sourcePath,
                        this.cancellationToken,
                        progressCallback,
                        i === 0 // isFirstSegment = true only for the first segment
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
                        this.cancellationToken,
                        undefined, // no progressCallback
                        i === 0 // isFirstSegment = true only for the first segment
                    );

                    this.checkCancellation();
                    translatedSegments.push(translatedSegment);

                    // Write progress to file
                    const currentContent: string = combineSegments(translatedSegments);
                    lastWritePromise = lastWritePromise.then(() =>
                        fsp.writeFile(targetPath, currentContent).then(() => {
                            logMessage(`💾 Written translation result for segment ${i + 1}/${segments.length}`);
                        }).catch((err) => {
                            logMessage(`❌ Failed to write segment content: ${err instanceof Error ? err.message : String(err)}`, "error");
                        })
                    );
                }

                translatedSegments.push(translatedSegment);

                // In non-streaming mode, this was already done, but in streaming mode,
                // we should ensure the final combined content is written
                if (streamMode) {
                    logMessage(`✅ Completed segment ${i + 1}/${segments.length}`);
                }

                await this.yieldToEventLoop();
            }

            const finalContent = combineSegments(translatedSegments);
            // 确保所有挂起的写入完成
            await lastWritePromise;
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
     * 在长循环中把控制权交还给事件循环，避免阻塞 VSCode 扩展宿主
     */
    private async yieldToEventLoop(): Promise<void> {
        await new Promise(resolve => {
            globalThis.setTimeout(resolve, 0);
        });
    }
}
