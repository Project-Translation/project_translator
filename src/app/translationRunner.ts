import * as fs from "fs";
import * as path from "path";
import { clearConfigurationCache, getConfiguration } from "../config/config";
import { RuntimeContext, CancellationTokenLike } from "../runtime/types";
import { logMessage } from "../runtime/logging";
import { TranslationDatabase } from "../translationDatabase";
import { FileProcessor } from "../services/fileProcessor";
import { TranslatorService } from "../services/translatorService";
import { AnalyticsService } from "../services/analytics";
import { DestFolder } from "../types/types";

interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TranslationRunResult {
  processedFiles: number;
  skippedFiles: number;
  failedFiles: number;
  failedPaths: string[];
  durationMs: number;
  tokenCounts: TokenCounts;
  cancelled: boolean;
  fatalError?: string;
}

function emptyResult(startTime: number): TranslationRunResult {
  return {
    processedFiles: 0,
    skippedFiles: 0,
    failedFiles: 0,
    failedPaths: [],
    durationMs: Date.now() - startTime,
    tokenCounts: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    cancelled: false,
  };
}

export class TranslationRunner {
  private runtimeContext: RuntimeContext;

  constructor(runtimeContext: RuntimeContext) {
    this.runtimeContext = runtimeContext;
  }

  public async runProject(cancellationToken?: CancellationTokenLike): Promise<TranslationRunResult> {
    const startTime = Date.now();
    try {
      clearConfigurationCache();
      const config = await getConfiguration();

      const hasFolders = !!(config.specifiedFolders && config.specifiedFolders.length > 0);
      const hasFiles = !!(config.specifiedFiles && config.specifiedFiles.length > 0);
      if (!hasFolders && !hasFiles) {
        throw new Error(
          "No translation tasks configured. Please configure specifiedFolders or specifiedFiles."
        );
      }

      const folderResult = hasFolders
        ? await this.runFolders(cancellationToken)
        : emptyResult(startTime);

      if (folderResult.fatalError) {
        return {
          ...folderResult,
          durationMs: Date.now() - startTime,
        };
      }

      if (cancellationToken?.isCancellationRequested) {
        return {
          ...folderResult,
          durationMs: Date.now() - startTime,
          cancelled: true,
        };
      }

      const fileResult = hasFiles
        ? await this.runFiles(cancellationToken)
        : emptyResult(startTime);

      if (fileResult.fatalError) {
        return {
          ...fileResult,
          durationMs: Date.now() - startTime,
        };
      }

      const tokenCounts = {
        inputTokens: folderResult.tokenCounts.inputTokens + fileResult.tokenCounts.inputTokens,
        outputTokens: folderResult.tokenCounts.outputTokens + fileResult.tokenCounts.outputTokens,
        totalTokens: folderResult.tokenCounts.totalTokens + fileResult.tokenCounts.totalTokens,
      };

      return {
        processedFiles: folderResult.processedFiles + fileResult.processedFiles,
        skippedFiles: folderResult.skippedFiles + fileResult.skippedFiles,
        failedFiles: folderResult.failedFiles + fileResult.failedFiles,
        failedPaths: [...folderResult.failedPaths, ...fileResult.failedPaths],
        durationMs: Date.now() - startTime,
        tokenCounts,
        cancelled: folderResult.cancelled || fileResult.cancelled,
      };
    } catch (error) {
      if (this.runtimeContext.isCancellationError(error)) {
        return {
          ...emptyResult(startTime),
          durationMs: Date.now() - startTime,
          cancelled: true,
        };
      }
      return {
        ...emptyResult(startTime),
        durationMs: Date.now() - startTime,
        fatalError: error instanceof Error ? error.message : String(error),
        cancelled: false,
      };
    }
  }

  public async runFolders(cancellationToken?: CancellationTokenLike): Promise<TranslationRunResult> {
    const startTime = Date.now();
    let translationDatabase: TranslationDatabase | null = null;

    try {
      clearConfigurationCache();
      const workspaceRoot = this.runtimeContext.workspaceRoot;
      if (!workspaceRoot) {
        throw new Error("Please open a target workspace first");
      }

      const translatorService = new TranslatorService(this.runtimeContext);
      await translatorService.initializeOpenAIClient();

      const config = await getConfiguration();
      const specifiedFolders = config.specifiedFolders || [];
      if (specifiedFolders.length === 0) {
        throw new Error("No folder groups configured");
      }

      translationDatabase = new TranslationDatabase(workspaceRoot, this.runtimeContext);
      const fileProcessor = new FileProcessor(this.runtimeContext, translationDatabase, translatorService);
      fileProcessor.setTranslationState(false, cancellationToken || { isCancellationRequested: false });

      for (const folderGroup of specifiedFolders) {
        if (cancellationToken?.isCancellationRequested) {
          throw this.runtimeContext.createCancellationError();
        }

        const sourceFolder = folderGroup.sourceFolder;
        const targetFolders = folderGroup.targetFolders;

        if (!sourceFolder?.path || !sourceFolder?.lang || !targetFolders?.length) {
          logMessage("⚠️ Skipping invalid folder group configuration", "warn");
          continue;
        }

        const resolvedSourceFolderPath = path.isAbsolute(sourceFolder.path)
          ? sourceFolder.path
          : path.join(workspaceRoot, sourceFolder.path);

        try {
          const stat = await fs.promises.stat(resolvedSourceFolderPath);
          if (!stat.isDirectory()) {
            throw new Error(`Source folder is not a directory: ${resolvedSourceFolderPath}`);
          }
        } catch {
          throw new Error(`Source folder does not exist: ${resolvedSourceFolderPath}`);
        }

        translationDatabase.setSourceRoot(resolvedSourceFolderPath);
        translationDatabase.clearTargetRoots();
        targetFolders.forEach((target: DestFolder) =>
          translationDatabase?.setTargetRoot(target.path, target.lang)
        );

        await fileProcessor.processDirectory(
          resolvedSourceFolderPath,
          targetFolders,
          sourceFolder.lang
        );
      }

      const stats = fileProcessor.getProcessingStats();
      const tokenCounts = translatorService.getTokenCounts();

      const analyticsService = new AnalyticsService(this.runtimeContext, await this.runtimeContext.getMachineId());
      await analyticsService.sendSettingsData(config as any);

      return {
        processedFiles: stats.processedFiles,
        skippedFiles: stats.skippedFiles,
        failedFiles: stats.failedFiles,
        failedPaths: stats.failedPaths,
        durationMs: Date.now() - startTime,
        tokenCounts,
        cancelled: false,
      };
    } catch (error) {
      if (this.runtimeContext.isCancellationError(error)) {
        return {
          ...emptyResult(startTime),
          durationMs: Date.now() - startTime,
          cancelled: true,
        };
      }
      return {
        ...emptyResult(startTime),
        durationMs: Date.now() - startTime,
        fatalError: error instanceof Error ? error.message : String(error),
        cancelled: false,
      };
    } finally {
      await translationDatabase?.close().catch((error) => {
        logMessage(`Error closing database: ${error}`, "error");
      });
    }
  }

  public async runFiles(cancellationToken?: CancellationTokenLike): Promise<TranslationRunResult> {
    const startTime = Date.now();
    let translationDatabase: TranslationDatabase | null = null;

    try {
      clearConfigurationCache();
      const workspaceRoot = this.runtimeContext.workspaceRoot;
      if (!workspaceRoot) {
        throw new Error("Please open a workspace first");
      }

      const translatorService = new TranslatorService(this.runtimeContext);
      await translatorService.initializeOpenAIClient();

      const config = await getConfiguration();
      const specifiedFiles = config.specifiedFiles || [];
      if (specifiedFiles.length === 0) {
        throw new Error("No specified files configured");
      }

      translationDatabase = new TranslationDatabase(workspaceRoot, this.runtimeContext);
      const fileProcessor = new FileProcessor(this.runtimeContext, translationDatabase, translatorService);
      fileProcessor.setTranslationState(false, cancellationToken || { isCancellationRequested: false });

      for (const fileGroup of specifiedFiles) {
        if (cancellationToken?.isCancellationRequested) {
          throw this.runtimeContext.createCancellationError();
        }

        const sourceFile = fileGroup.sourceFile;
        const targetFiles = fileGroup.targetFiles;

        if (!sourceFile || !sourceFile.path || !targetFiles || targetFiles.length === 0) {
          logMessage("⚠️ Skipping invalid file group configuration", "warn");
          continue;
        }

        const sourceDir = path.dirname(sourceFile.path);
        translationDatabase.setSourceRoot(sourceDir);

        for (const targetFile of targetFiles) {
          const targetDir = path.dirname(targetFile.path);
          translationDatabase.setTargetRoot(targetDir, targetFile.lang);
        }

        for (const targetFile of targetFiles) {
          if (cancellationToken?.isCancellationRequested) {
            throw this.runtimeContext.createCancellationError();
          }

          await fileProcessor.processFile(
            sourceFile.path,
            targetFile.path,
            sourceFile.lang,
            targetFile.lang
          );
        }
      }

      const stats = fileProcessor.getProcessingStats();
      const tokenCounts = translatorService.getTokenCounts();

      const analyticsService = new AnalyticsService(this.runtimeContext, await this.runtimeContext.getMachineId());
      await analyticsService.sendSettingsData(config as any);

      return {
        processedFiles: stats.processedFiles,
        skippedFiles: stats.skippedFiles,
        failedFiles: stats.failedFiles,
        failedPaths: stats.failedPaths,
        durationMs: Date.now() - startTime,
        tokenCounts,
        cancelled: false,
      };
    } catch (error) {
      if (this.runtimeContext.isCancellationError(error)) {
        return {
          ...emptyResult(startTime),
          durationMs: Date.now() - startTime,
          cancelled: true,
        };
      }
      return {
        ...emptyResult(startTime),
        durationMs: Date.now() - startTime,
        fatalError: error instanceof Error ? error.message : String(error),
        cancelled: false,
      };
    } finally {
      await translationDatabase?.close().catch((error) => {
        logMessage(`Error closing database: ${error}`, "error");
      });
    }
  }
}
