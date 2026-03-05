import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Buffer } from 'buffer';
import { isBinaryFile } from "isbinaryfile";
import { Minimatch } from "minimatch";
import { TranslationDatabase } from "../translationDatabase";
import { DestFolder, SupportedLanguage } from "../types/types";
import { TranslatorService } from "./translatorService";
import { SearchReplaceDiffApplier } from './searchReplaceDiffApplier'
import { formatRawErrorForLog } from "./errorLog";
import { CancellationTokenLike, RuntimeContext } from "../runtime/types";
import { getRuntimeContext } from "../runtime/context";

import { estimateTokenCount, segmentText, combineSegments } from "../segmentationUtils";
import { getConfiguration } from "../config/config";
import type { Config } from "../config/config.types";
import { logMessage } from '../runtime/logging';

// AI return code.
const AI_RETURN_CODE = {
  OK: "OK",
  NO_NEED_TRANSLATE: "727d2eb8-8683-42bd-a1d0-f604fcd82163",
};

const fsp = fs.promises;

export class FileProcessor {
    private runtimeContext: RuntimeContext;
    private translationDb: TranslationDatabase;
    private translatorService: TranslatorService;

    private processedFilesCount = 0;
    private skippedFilesCount = 0;
    private failedFilesCount = 0;
    private failedFilePaths: string[] = [];
    private isPaused = false;
    private cancellationToken?: CancellationTokenLike;
    private workspaceRoot: string;
    private ensuredDirs: Set<string> = new Set();

    private configSnapshot: Config | null = null;
    private ignorePathMatchers: Minimatch[] = [];
    private copyOnlyPathMatchers: Minimatch[] = [];
    private ignoreExtensions: Set<string> = new Set();
    private copyOnlyExtensions: Set<string> = new Set();
    
    // Cache to store whether a (source,targetLang,targetPath) needs translation
    private translationDecisionCache: Map<string, {shouldTranslate: boolean, timestamp: number}> = new Map();
    
    // Cache to store (source,targetLang,targetPath) that were marked as "no need to translate" during this session
    private noTranslateCache: Map<string, boolean> = new Map();

    constructor(
        runtimeContext: RuntimeContext | undefined,
        translationDb: TranslationDatabase,
        translatorService: TranslatorService
    ) {
        this.runtimeContext = runtimeContext || getRuntimeContext();
        this.translationDb = translationDb;
        this.translatorService = translatorService;
        
        // Get workspace root path
        this.workspaceRoot = this.runtimeContext.workspaceRoot || '';
    }

    private buildMatchers(patterns: string[]): Minimatch[] {
        return (patterns || [])
            .filter((p) => typeof p === "string" && p.trim().length > 0)
            .map((pattern) => new Minimatch(pattern, { dot: true, nocomment: true }));
    }

    private matchAny(matchers: Minimatch[], relativePath: string, isDir: boolean): boolean {
        const normalized = relativePath.replace(/\\/g, "/");
        if (isDir) {
            const withSlash = normalized.endsWith("/") ? normalized : `${normalized}/`;
            return matchers.some((m) => m.match(normalized) || m.match(withSlash));
        }
        return matchers.some((m) => m.match(normalized));
    }

    private async ensureConfigSnapshot(): Promise<Config> {
        if (this.configSnapshot) {
            return this.configSnapshot;
        }
        const config = await getConfiguration();
        this.configSnapshot = config;
        this.ignorePathMatchers = this.buildMatchers(config.ignore?.paths || []);
        this.copyOnlyPathMatchers = this.buildMatchers(config.copyOnly?.paths || []);
        this.ignoreExtensions = new Set((config.ignore?.extensions || []).map((x) => String(x)));
        this.copyOnlyExtensions = new Set((config.copyOnly?.extensions || []).map((x) => String(x)));
        return config;
    }

    private async ensureDirOnce(dirPath: string): Promise<void> {
        const normalized = path.normalize(dirPath);
        if (this.ensuredDirs.has(normalized)) {
            return;
        }
        await fsp.mkdir(normalized, { recursive: true });
        this.ensuredDirs.add(normalized);
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

    private getDecisionCacheKey(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): string {
        const normalize = (p: string) => path.normalize(p).replace(/\\/g, "/");
        return `${normalize(sourcePath)}::${normalize(targetPath)}::${targetLang}`;
    }

    public setTranslationState(isPaused: boolean, token: CancellationTokenLike) {
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

            const config = await this.ensureConfigSnapshot();
            const sourceRoot = this.translationDb.getSourceRoot() || resolvedSourcePath;
            const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
            const relativeToWorkspacePath = path.relative(workspaceRoot, resolvedSourcePath).replace(/\\/g, "/");

            // Check if directory should be ignored
            if (this.matchAny(this.ignorePathMatchers, relativeToWorkspacePath, true)) {
                logMessage(`⏭️ Skipping ignored directory: ${resolvedSourcePath}`);
                return;
            }

            const entries = await fsp.readdir(resolvedSourcePath, { withFileTypes: true });
            logMessage(`📊 Found ${entries.length} files/directories`);

            let processedEntries = 0;
            for (const entry of entries) {
                this.checkCancellation();

                const fullPath = path.join(resolvedSourcePath, entry.name);
                if (entry.isDirectory()) {
                    await this.processSubDirectory(fullPath, targetPaths, sourceRoot, sourceLang);
                } else if (entry.isFile()) {
                    logMessage(`\n📄 File: ${entry.name}`);
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
            logMessage(`❌ Error processing directory: ${errorMessage}`, "error");
            throw error;
        }
    }

    private checkCancellation() {
        if (this.cancellationToken?.isCancellationRequested) {
            logMessage("⛔ Translation cancelled", "warn");
            throw this.runtimeContext.createCancellationError();
        }
    }

    private async processSubDirectory(fullPath: string, targetPaths: DestFolder[], sourceRoot: string, sourceLang: SupportedLanguage) {
        await this.ensureConfigSnapshot();
        const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
        const relativeToWorkspacePath = path.relative(workspaceRoot, fullPath).replace(/\\/g, "/");
        if (this.matchAny(this.ignorePathMatchers, relativeToWorkspacePath, true)) {
            logMessage(`⏭️ Skipping ignored subdirectory: ${fullPath}`);
            return;
        }

        logMessage(`\n📂 Processing subdirectory: ${path.basename(fullPath)}`);

        // Create corresponding directories for each target path（使用异步 mkdir 避免阻塞，且去重）
        for (const target of targetPaths) {
            const resolvedTargetPath = this.resolvePath(target.path);
            logMessage(`Ensuring target directory exists: ${resolvedTargetPath}`);
            await this.ensureDirOnce(resolvedTargetPath);
        }

        await this.processDirectory(fullPath, targetPaths, sourceLang);
    }

    public async processFile(sourcePath: string, targetPath: string, sourceLang: SupportedLanguage, targetLang: SupportedLanguage) {
        try {
            // Resolve paths
            const resolvedSourcePath = this.resolvePath(sourcePath);
            const resolvedTargetPath = this.resolvePath(targetPath);
            await this.ensureConfigSnapshot();

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
            await this.ensureDirOnce(targetDir);

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

            // Check if file should be completely ignored
            if (this.shouldIgnoreFile(resolvedSourcePath, ext)) {
                logMessage(`⏭️ Skipping ignored file: ${resolvedSourcePath}`);
                return;
            }

            // Check if file should be copied only (not translated)
            if (this.shouldCopyOnly(resolvedSourcePath, ext)) {
                await this.handleCopyOnlyFile(resolvedSourcePath, resolvedTargetPath);
                return;
            }

            if (await isBinaryFile(resolvedSourcePath)) {
                await this.handleBinaryFile(resolvedSourcePath, resolvedTargetPath);
                return;
            }

            await this.handleTextFile(resolvedSourcePath, resolvedTargetPath, sourceLang, targetLang);
        } catch (error) {
            logMessage(`❌ File translation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
            this.failedFilesCount++;
            this.failedFilePaths.push(sourcePath);
            throw error;
        }
    } 
    
    private async shouldSkipFile(sourcePath: string, targetPath: string, targetLang: SupportedLanguage): Promise<boolean> {
        const decisionKey = this.getDecisionCacheKey(sourcePath, targetPath, targetLang);

        // Check if we've already decided this source file doesn't need translation in this session
        if (this.noTranslateCache.has(decisionKey)) {
            logMessage(`⏭️ Skipping translation (previously marked as no need to translate in this session)`);
            this.skippedFilesCount++;
            return true;
        }
        
        // Check if we have a recent, valid decision in the cache
        const cachedDecision = this.translationDecisionCache.get(decisionKey);
        if (cachedDecision && (Date.now() - cachedDecision.timestamp) < 5 * 60 * 1000) { // 5-minute cache validity
            if (!cachedDecision.shouldTranslate) {
                logMessage(`⏭️ Skipping translation (cached decision: no need to translate)`);
                this.skippedFilesCount++;
                this.noTranslateCache.set(decisionKey, true); // Ensure session cache is also populated
                return true;
            } else {
                // If cache says we should translate, we don't need to check the database again.
                return false;
            }
        }

        // If no valid cache entry, perform the check against the database
        const shouldTranslate = await this.translationDb.shouldTranslate(sourcePath, targetPath, targetLang);
        
        // Cache the new decision
        this.translationDecisionCache.set(decisionKey, { shouldTranslate, timestamp: Date.now() });
        
        if (!shouldTranslate) {
            logMessage("⏭️ Skipping translation (fresh decision: no need to translate)");
            this.noTranslateCache.set(decisionKey, true); // Mark for this session
            this.skippedFilesCount++;
            return true;
        }

        return false;
    }

    private async shouldSkipByFrontMatter(sourcePath: string): Promise<boolean> {
        // Only process if the feature is enabled and the file is markdown
        const config = await this.ensureConfigSnapshot();
        const frontMatterConfig = config.skipFrontMatter;
        
        if (!frontMatterConfig || !frontMatterConfig.enabled) {
            return false;
        }
        
        // Check if it's a markdown file
        const ext = path.extname(sourcePath).toLowerCase();
        if (ext !== '.md' && ext !== '.markdown') {
            return false;
        }
        
        try {
            // 仅读取文件头部即可判断 front matter（避免对大文件全量 readFile）
            const maxBytes = 256 * 1024;
            const handle = await fsp.open(sourcePath, "r");
            try {
                const buffer = Buffer.allocUnsafe(maxBytes);
                const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
                const content = buffer.toString("utf8", 0, bytesRead);
            
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
            } finally {
                await handle.close();
            }
        } catch (error) {
            logMessage(`⚠️ Error checking front matter in ${sourcePath}: ${error instanceof Error ? error.message : String(error)}`, "warn");
            return false;
        }
    }

    private shouldIgnoreFile(sourcePath: string, ext: string): boolean {
        const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
        const relativeToWorkspacePath = path.relative(workspaceRoot, sourcePath).replace(/\\/g, "/");        // Check ignore paths
        if (this.matchAny(this.ignorePathMatchers, relativeToWorkspacePath, false)) {
            return true;
        }

        // Check ignore extensions
        return this.ignoreExtensions.has(ext);
    }

    private shouldCopyOnly(sourcePath: string, ext: string): boolean {
        const workspaceRoot = this.translationDb.getWorkspaceRoot() || this.workspaceRoot;
        const relativeToWorkspacePath = path.relative(workspaceRoot, sourcePath).replace(/\\/g, "/");

        // Check copyOnly paths
        if (this.matchAny(this.copyOnlyPathMatchers, relativeToWorkspacePath, false)) {
            return true;
        }

        // Check copyOnly extensions
        return this.copyOnlyExtensions.has(ext);
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
            const config = await this.ensureConfigSnapshot();
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
                        { fuzzyThreshold: 0.98, bufferLines: 40 },
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
                    // Stream mode: 边接收边写入目标文件，避免“结束后一次性 writeFile”导致长时间无落盘。
                    // 仍然保留“必要时最终覆写”的兜底：若流式落盘内容与最终 sanitized 结果不一致，才会覆写一次。
                    const streamedHash = crypto.createHash('sha256');
                    let streamedCharCount = 0;
                    let writeStream: fs.WriteStream | null = null;
                    let writeError: Error | null = null;
                    let translateError: unknown = null;
                    // 初始化，避免 strict 模式下“可能未赋值”报错（真正出错时会 throw）
                    returnCode = AI_RETURN_CODE.OK;
                    translatedContent = '';

                    // 写入队列：progressCallback 不能 async/await，这里用队列 + 后台 flush 保证顺序和 backpressure。
                    const pendingChunks: string[] = [];
                    let flushing = false;
                    let flushPromise: Promise<void> | null = null;
                    const waitDrain = async (ws: fs.WriteStream): Promise<void> => {
                        await new Promise<void>((resolve, reject) => {
                            const onDrain = () => {
                                cleanup();
                                resolve();
                            };
                            const onError = (err: Error) => {
                                cleanup();
                                reject(err);
                            };
                            const cleanup = () => {
                                ws.off('drain', onDrain);
                                ws.off('error', onError);
                            };
                            ws.on('drain', onDrain);
                            ws.on('error', onError);
                        });
                    };

                    const ensureWriteStream = () => {
                        if (writeStream) return;
                        writeStream = fs.createWriteStream(targetPath, { encoding: 'utf8', flags: 'w' });
                        writeStream.on('error', (err) => {
                            writeError = err;
                            logMessage(`❌ Failed to write streaming content: ${err.message}`, "error");
                        });
                    };

                    const flushChunks = async (): Promise<void> => {
                        ensureWriteStream();
                        while (pendingChunks.length > 0) {
                            if (writeError) {
                                throw writeError;
                            }
                            const chunk = pendingChunks.shift();
                            if (!chunk) {
                                continue;
                            }
                            const ok = writeStream!.write(chunk);
                            if (!ok) {
                                await waitDrain(writeStream!);
                            }
                        }
                    };

                    const enqueueChunk = (chunk: string) => {
                        if (!chunk || writeError) {
                            return;
                        }
                        pendingChunks.push(chunk);
                        streamedHash.update(chunk, 'utf8');
                        streamedCharCount += chunk.length;

                        if (!flushing) {
                            flushing = true;
                            flushPromise = flushChunks()
                                .catch((err) => {
                                    // 记录并延后到 translateError 统一抛出
                                    writeError = err instanceof Error ? err : new Error(String(err));
                                })
                                .finally(() => {
                                    flushing = false;
                                });
                        }
                    };

                    const closeWriteStreamIfAny = async () => {
                        if (!writeStream) return;
                        await new Promise<void>((resolve, reject) => {
                            if (writeError) {
                                reject(writeError);
                            } else {
                                writeStream?.end(() => resolve());
                            }
                        });
                        writeStream = null;
                    };

                    // Define progress callback for streaming - appends to file as chunks arrive
                    const progressCallback = (chunk: string) => {
                        enqueueChunk(chunk);
                    };

                    logMessage("🔄 Using stream mode for translation...");
                    try {
                        [returnCode, translatedContent] = await this.translatorService.translateContent(
                            content,
                            sourceLang,
                            targetLang,
                            sourcePath,
                            this.cancellationToken,
                            progressCallback,
                            true // isFirstSegment = true for single file translation
                        );
                    } catch (e) {
                        translateError = e;
                    }

                    // 等待所有排队 chunk 落盘，再关闭 writeStream
                    try {
                        await flushPromise;
                    } catch (e) {
                        translateError = translateError || e;
                    }

                    // 无论成功失败，都要关闭写流，避免文件句柄泄漏/锁死
                    try {
                        await closeWriteStreamIfAny();
                    } catch (e) {
                        translateError = translateError || e;
                    }

                    // 若翻译失败且已写入过部分内容，清理不完整目标文件，继续处理下一个文件
                    if (translateError && streamedCharCount > 0) {
                        try {
                            await fsp.unlink(targetPath);
                        } catch {
                            // ignore
                        }
                    }

                    if (translateError) {
                        throw translateError;
                    }

                    // If NO_NEED_TRANSLATE was detected, copy the original file and update cache records
                    if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                        logMessage("⏭️ No translation needed, copying original file");
                        // Cache the decision for this (source,targetLang,targetPath) in this session
                        const decisionKey = this.getDecisionCacheKey(sourcePath, targetPath, targetLang);
                        this.noTranslateCache.set(decisionKey, true);
                        this.translationDecisionCache.set(decisionKey, { shouldTranslate: false, timestamp: Date.now() });
                        // Clean up the partially written file
                        try {
                            await fsp.unlink(targetPath);
                        } catch {
                            // Ignore errors if file doesn't exist
                        }
                        await fsp.writeFile(targetPath, content);
                        await this.translationDb.updateTranslationTime(sourcePath, targetPath, targetLang);
                        this.processedFilesCount++;
                        return; // Skip processing this file
                    } else {
                        // 优先使用 translateContent 返回的最终 sanitized 结果；若其为空，则保留流式落盘内容，避免覆盖成空文件。
                        const finalToWrite =
                            translatedContent && translatedContent.trim().length > 0
                                ? translatedContent
                                : null;

                        if (!finalToWrite) {
                            if (streamedCharCount === 0) {
                                logMessage(
                                    `⚠️ Stream translation returned empty content and no streamed chunks were written; target file may be empty. 请检查 debug 输出中的流式消息/字段。`,
                                    "warn"
                                );
                            }
                            logMessage("💾 Stream translation result written (stream-only, no final overwrite)");
                            if (streamedCharCount === 0) {
                                wasTranslated = false;
                            } else {
                                const originalDigest = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
                                const streamedDigest = streamedHash.digest('hex');
                                wasTranslated = streamedDigest !== originalDigest;
                            }
                        } else {
                            // 仅当最终结果与流式落盘不一致时才覆写一次，减少“结束后一次性写入”的发生概率。
                            const streamedDigest = streamedHash.digest('hex');
                            const finalDigest = crypto.createHash('sha256').update(finalToWrite, 'utf8').digest('hex');
                            if (streamedDigest !== finalDigest) {
                                await fsp.writeFile(targetPath, finalToWrite);
                                logMessage("💾 Stream translation finalized (sanitized overwrite applied)");
                            } else {
                                logMessage("💾 Stream translation finalized (no overwrite needed)");
                            }
                            wasTranslated = finalToWrite !== content;
                        }
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

                    // If NO_NEED_TRANSLATE was detected, copy original and record the decision
                    if (returnCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                        logMessage("⏭️ No translation needed, copying original file");
                        // Cache the decision for this (source,targetLang,targetPath) in this session
                        const decisionKey = this.getDecisionCacheKey(sourcePath, targetPath, targetLang);
                        this.noTranslateCache.set(decisionKey, true);
                        this.translationDecisionCache.set(decisionKey, { shouldTranslate: false, timestamp: Date.now() });
                        await fsp.writeFile(targetPath, content);
                        await this.translationDb.updateTranslationTime(sourcePath, targetPath, targetLang);
                        this.processedFilesCount++;
                        return; // Done for this file
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
            if (this.runtimeContext.isCancellationError(error)) {
                throw error;
            }
            // 打印原始错误对象，避免只看到 "Premature close" 这类简略信息
            logMessage(`❌ [RAW ERROR] ${formatRawErrorForLog(error)}`, "error");
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logMessage(`❌ Failed to translate file: ${errorMessage}`, "error");
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
        let nonStreamWs: fs.WriteStream | null = null;
        try {
            logMessage("📏 Large file detected, segmenting content...");
            const config = await this.ensureConfigSnapshot();
            const { maxTokensPerSegment = 4096, streamMode } = config.currentVendor;

            // Segment the content
            const segments = segmentText(content, sourcePath, maxTokensPerSegment, {
                segmentationMarkers: config.segmentationMarkers,
                defaultMaxTokens: maxTokensPerSegment
            });
            logMessage(`📦 Segmented into ${segments.length} parts`);

            const translatedSegments: string[] = [];
            const segmentsWithEmptyTranslation: number[] = [];
            const segmentsWithWriteIssues: number[] = [];
            let needsFinalOverwrite = false;

            // 用于保证流式写入的顺序性
            let lastWritePromise: Promise<void> = Promise.resolve();
            const nonStreamWrite = async (data: string): Promise<void> => {
                if (!nonStreamWs) {
                    return;
                }
                await new Promise<void>((resolve, reject) => {
                    const ws = nonStreamWs!;
                    let settled = false;
                    const done = (fn: () => void) => {
                        if (settled) {
                            return;
                        }
                        settled = true;
                        ws.off("drain", onDrain);
                        ws.off("error", onError);
                        fn();
                    };
                    const onDrain = () => done(resolve);
                    const onError = (err: Error) => done(() => reject(err));

                    ws.on("error", onError);
                    const ok = ws.write(data, (err) => {
                        if (err) {
                            done(() => reject(err));
                            return;
                        }
                        if (ok) {
                            done(resolve);
                        }
                    });
                    if (!ok) {
                        ws.on("drain", onDrain);
                    }
                });
            };
            const nonStreamClose = async (): Promise<void> => {
                if (!nonStreamWs) {
                    return;
                }
                await new Promise<void>((resolve) => nonStreamWs!.end(() => resolve()));
                nonStreamWs = null;
            };

            if (!streamMode) {
                nonStreamWs = fs.createWriteStream(targetPath, { encoding: "utf8", flags: "w" });
                nonStreamWs.on("error", (err) => {
                    segmentsWithWriteIssues.push(0);
                    logMessage(`❌ Failed to write non-stream content: ${err.message}`, "error");
                });
            }

            // Translate each segment
            for (let i = 0; i < segments.length; i++) {
                this.checkCancellation();

                const segment = segments[i];
                let segmentCode: string;
                let translatedSegment: string;
                let segmentHadAnyWrite = false;
                let segmentHadWriteError = false;

                if (streamMode) {
                    // For streaming mode, use a write stream to append content as it arrives
                    let currentSegmentContent = '';
                    let writeStream: fs.WriteStream | null = null;
                    let segmentTranslateError: unknown = null;
                    // 初始化，避免 strict 模式下“可能未赋值”报错（真正出错时会 throw）
                    segmentCode = AI_RETURN_CODE.OK;
                    translatedSegment = '';

                    const segmentStreamHash = crypto.createHash('sha256');
                    let segmentStreamCharCount = 0;
                    const pendingChunks: string[] = [];
                    let flushing = false;
                    let flushPromise: Promise<void> | null = null;
                    const waitDrain = async (ws: fs.WriteStream): Promise<void> => {
                        await new Promise<void>((resolve, reject) => {
                            const onDrain = () => {
                                cleanup();
                                resolve();
                            };
                            const onError = (err: Error) => {
                                cleanup();
                                reject(err);
                            };
                            const cleanup = () => {
                                ws.off('drain', onDrain);
                                ws.off('error', onError);
                            };
                            ws.on('drain', onDrain);
                            ws.on('error', onError);
                        });
                    };

                    const ensureWriteStream = () => {
                        if (writeStream) return;
                        const writeMode = i === 0 ? 'w' : 'a'; // First segment overwrites, others append
                        writeStream = fs.createWriteStream(targetPath, { encoding: 'utf8', flags: writeMode });
                        writeStream.on('error', (err) => {
                            segmentHadWriteError = true;
                            logMessage(`❌ Failed to write streaming content for segment: ${err.message}`, "error");
                        });
                        segmentHadAnyWrite = true;
                    };

                    const flushChunks = async (): Promise<void> => {
                        ensureWriteStream();
                        while (pendingChunks.length > 0) {
                            const chunk = pendingChunks.shift();
                            if (!chunk) {
                                continue;
                            }
                            const ok = writeStream!.write(chunk);
                            if (!ok) {
                                await waitDrain(writeStream!);
                            }
                        }
                    };

                    // Define progress callback for streaming - appends to file as chunks arrive
                    const progressCallback = (chunk: string) => {
                        if (!chunk) {
                            return;
                        }

                        currentSegmentContent += chunk;
                        segmentStreamHash.update(chunk, 'utf8');
                        segmentStreamCharCount += chunk.length;
                        pendingChunks.push(chunk);

                        if (!flushing) {
                            flushing = true;
                            flushPromise = flushChunks()
                                .catch(() => {
                                    segmentHadWriteError = true;
                                    segmentsWithWriteIssues.push(i + 1);
                                })
                                .finally(() => {
                                    flushing = false;
                                });
                        }
                    };

                    logMessage(`🔄 Using stream mode for segment ${i + 1}/${segments.length}...`);
                    try {
                        [segmentCode, translatedSegment] = await this.translatorService.translateContent(
                            segment,
                            sourceLang,
                            targetLang,
                            sourcePath,
                            this.cancellationToken,
                            progressCallback,
                            i === 0 // isFirstSegment = true only for the first segment
                        );
                    } catch (e) {
                        segmentTranslateError = e;
                    }

                    // 等待该 segment 的所有 chunk 落盘
                    try {
                        await flushPromise;
                    } catch {
                        segmentHadWriteError = true;
                        segmentsWithWriteIssues.push(i + 1);
                    }

                    // 确保关闭 writeStream，避免异常中断时文件句柄泄漏
                    if (writeStream) {
                        try {
                            await new Promise<void>((resolve) => {
                                writeStream?.end(() => resolve());
                            });
                        } catch {
                            // ignore close errors
                        }
                        writeStream = null;
                    }

                    if (segmentTranslateError) {
                        throw segmentTranslateError;
                    }

                    // Determine the final segment content based on return code
                    if (segmentCode === AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                        translatedSegment = segment;
                    } else if (!translatedSegment) {
                        // translateContent 为空时，至少避免把 translatedSegments 塞进空字符串；这里用 segment 原文作为兜底。
                        // 注意：文件落盘内容可能仍来自 stream；最终是否覆写由 needsFinalRewrite 决定。
                        translatedSegment = currentSegmentContent;
                    }

                    // Add to translatedSegments for final combination
                    translatedSegments.push(translatedSegment);

                    // 若流式落盘内容与 translateContent 的最终 sanitized 结果不一致，则在末尾进行一次最终覆写。
                    if (segmentCode !== AI_RETURN_CODE.NO_NEED_TRANSLATE) {
                        const streamedDigest = segmentStreamHash.digest('hex');
                        const expectedDigest = crypto.createHash('sha256').update(translatedSegment || "", 'utf8').digest('hex');
                        if (segmentStreamCharCount === 0) {
                            // 没有任何 stream chunk（供应商可能未返回 delta.content），后续用兜底写入保证文件不缺段
                            segmentHadWriteError = true;
                            segmentsWithWriteIssues.push(i + 1);
                        } else if (streamedDigest !== expectedDigest) {
                            // Stream 写入的是“逐步输出”，最终 sanitized 结果可能略有差异；仅在末尾覆写一次即可，无需每段兜底重写。
                            needsFinalOverwrite = true;
                        }
                    }

                    // 如果流式过程中没有写入任何内容，或写入发生错误，则进行一次“兜底写入”确保目标文件同步
                    if (
                        segmentCode !== AI_RETURN_CODE.NO_NEED_TRANSLATE &&
                        (segmentHadWriteError || (!segmentHadAnyWrite && translatedSegment && translatedSegment.length > 0))
                    ) {
                        segmentHadWriteError = true;
                        segmentsWithWriteIssues.push(i + 1);
                        logMessage(
                            `⚠️ Segment ${i + 1}/${segments.length} 在流式写入阶段未能正常写入（将尝试兜底写入以避免目标文件缺段）`,
                            "warn"
                        );
                        const currentContent = combineSegments(translatedSegments);
                        lastWritePromise = lastWritePromise.then(async () => {
                            try {
                                await fsp.writeFile(targetPath, currentContent);
                            } catch (err) {
                                logMessage(`❌ Failed to write fallback segment content: ${err instanceof Error ? err.message : String(err)}`, "error");
                            }
                        });
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

                    // 非流式：每段翻译完成后按顺序追加写入（避免每段全量重写）
                    try {
                        if (i > 0) {
                            await nonStreamWrite("\n");
                        }
                        await nonStreamWrite(translatedSegment || "");
                        logMessage(`💾 Written translation result for segment ${i + 1}/${segments.length}`);
                    } catch (err) {
                        segmentsWithWriteIssues.push(i + 1);
                        throw err;
                    }
                }

                // Warn: segment returned empty translation (usually abnormal)
                if (
                    segmentCode !== AI_RETURN_CODE.NO_NEED_TRANSLATE &&
                    segment.trim().length > 0 &&
                    (!translatedSegment || translatedSegment.trim().length === 0)
                ) {
                    segmentsWithEmptyTranslation.push(i + 1);
                    logMessage(
                        `⚠️ Segment ${i + 1}/${segments.length} 返回了空翻译内容（这通常不正常；可能是模型返回空响应或被过滤）`,
                        "warn"
                    );
                }

                // Log completion
                logMessage(`✅ Completed segment ${i + 1}/${segments.length}`);

                await this.yieldToEventLoop();
            }

            const finalContent = combineSegments(translatedSegments);
            // 确保所有挂起的写入完成
            await lastWritePromise;

            if (!streamMode) {
                await nonStreamClose();
                logMessage("💾 Translation completed (non-stream, incremental append)");
            } else if (segmentsWithWriteIssues.length === 0 && !needsFinalOverwrite) {
                // streamMode 下通常已经边接收边写入了文件，这里只在发现写入异常/不一致时才最终覆写一次。
                logMessage("💾 Stream translation completed (no final overwrite needed)");
            } else {
                await fsp.writeFile(targetPath, finalContent);
                logMessage("💾 Stream translation finalized (final overwrite applied)");
            }

            if (segmentsWithEmptyTranslation.length > 0) {
                logMessage(
                    `⚠️ 检测到 ${segmentsWithEmptyTranslation.length} 个分段返回空翻译内容：${segmentsWithEmptyTranslation.join(", ")}（请检查模型响应/提示词/过滤逻辑）`,
                    "warn"
                );
            }
            if (segmentsWithWriteIssues.length > 0) {
                // 去重 + 稳定输出
                const uniq = Array.from(new Set(segmentsWithWriteIssues)).sort((a, b) => a - b);
                logMessage(
                    `⚠️ 检测到 ${uniq.length} 个分段在写入目标文件时出现异常：${uniq.join(", ")}（已尝试兜底写入，建议检查磁盘/权限/路径）`,
                    "warn"
                );
            }
            return [AI_RETURN_CODE.OK, finalContent];
        } catch (error) {
            if (this.runtimeContext.isCancellationError(error)) {
                throw error;
            }
            if (nonStreamWs) {
                try {
                    await new Promise<void>((resolve) => nonStreamWs!.end(() => resolve()));
                } catch {
                    // ignore
                }
                nonStreamWs = null;
            }
            // 流式大文件/分段翻译过程中一旦出错，目标文件可能只写入了部分内容；清理以避免留下损坏文件
            try {
                await fsp.unlink(targetPath);
            } catch {
                // ignore
            }
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            logMessage(`❌ Failed to translate: ${errorMessage}`, "error");
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
