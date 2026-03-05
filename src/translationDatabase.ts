import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import { SpecifiedFolder, SpecifiedFile } from "./types/types";
import { getConfiguration } from "./config/config";
import { logMessage } from "./runtime/logging";
import { getRuntimeContext } from "./runtime/context";
import { RuntimeContext } from "./runtime/types";

// Any string with length under 10 characters is now a valid language code
export type SupportedLanguage = string;

// Validate if a string is a valid language code (under 10 characters)
export function isValidLanguage(lang: string): boolean {
  return typeof lang === "string" && lang.length > 0 && lang.length < 10;
}

interface TranslationRecord {
  [sourcePath: string]: TranslationFileInfo;
}

interface TranslationFileInfo {
  translate_datetime: string;
  src_hash: string;
  // Fast-path fields for detecting unchanged files without hashing.
  // Optional for backward compatibility with older cache files.
  src_size?: number;
  src_mtime_ms?: number;
}

export class TranslationDatabase {
  private translationCacheDir: string;
  private workspaceRoot: string;
  private sourceRoot: string | null = null;
  private targetRoots: Map<string, SupportedLanguage> = new Map();
  private translationCache: Map<string, TranslationRecord> = new Map();
  private runtimeContext: RuntimeContext;
  private readonly fsp = fs.promises;

  private dirtyLanguages: Set<SupportedLanguage> = new Set();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushInFlight: Promise<void> | null = null;
  private readonly flushDelayMs = 1000;

  // Cache current source file info to avoid repeated stat/hash during scans.
  // Keyed by absolute source path.
  private sourceFileInfoCache: Map<
    string,
    { src_size: number; src_mtime_ms: number; src_hash?: string; checkedAt: number }
  > = new Map();
  private readonly sourceFileInfoCacheTtlMs = 2000;

  constructor(workspaceRoot: string, runtimeContext?: RuntimeContext) {
    this.workspaceRoot = workspaceRoot;
    this.runtimeContext = runtimeContext || getRuntimeContext();
    this.translationCacheDir = path.join(workspaceRoot, ".translation-cache");

    // Initialize cache directory and load data
    this.initCache().catch((err) => {
      this.runtimeContext.notifier.showError(
        `Failed to initialize translation cache: ${err}`
      );
    });
  }

  private markDirty(lang: SupportedLanguage): void {
    this.dirtyLanguages.add(lang);
    if (this.flushTimer) {
      return;
    }
    this.flushTimer = globalThis.setTimeout(() => {
      this.flushTimer = null;
      void this.flushDirtyLanguages();
    }, this.flushDelayMs) as unknown as NodeJS.Timeout;
  }

  private async flushDirtyLanguages(): Promise<void> {
    if (this.flushInFlight) {
      return this.flushInFlight;
    }
    this.flushInFlight = (async () => {
      while (this.dirtyLanguages.size > 0) {
        const langs = Array.from(this.dirtyLanguages);
        this.dirtyLanguages.clear();
        await Promise.all(langs.map((lang) => this.saveCacheForLanguage(lang)));
      }
    })().finally(() => {
      this.flushInFlight = null;
    });
    return this.flushInFlight;
  }

  public async flush(): Promise<void> {
    if (this.flushTimer) {
      globalThis.clearTimeout(this.flushTimer as any);
      this.flushTimer = null;
    }
    await this.flushDirtyLanguages();
  }

  private async initCache() {
    logMessage("🗂️ Initializing translation cache...");

    // Create the cache directory（异步，避免阻塞）
    try {
      await this.fsp.mkdir(this.translationCacheDir, { recursive: true });
      logMessage(`📁 Ensured cache directory: ${this.translationCacheDir}`);
    } catch (e) {
      logMessage(`❌ Failed to create cache directory ${this.translationCacheDir}: ${e}`, "error");
      throw e;
    }

    const config = await getConfiguration();
    const specifiedFolders = (config.specifiedFolders || []) as SpecifiedFolder[];
    const specifiedFiles = (config.specifiedFiles || []) as SpecifiedFile[];

    // Only create caches for languages specified in the configuration
    const configuredLanguages = new Set<SupportedLanguage>();

    if (specifiedFolders.length > 0) {
      specifiedFolders[0].targetFolders?.forEach(
        (folder: { lang: SupportedLanguage }) => {
          if (folder.lang && isValidLanguage(folder.lang)) {
            configuredLanguages.add(folder.lang);
            logMessage(`🌐 Found configured language: ${folder.lang}`);
          } else if (folder.lang) {
            logMessage(`⚠️ Invalid language code: ${folder.lang}`, "warn");
            this.runtimeContext.notifier.showWarn(
              `Invalid language code "${folder.lang}". Language codes must be non-empty strings with less than 10 characters.`
            );
          }
        }
      );
    }

    if (specifiedFiles.length > 0) {
      specifiedFiles[0].targetFiles?.forEach(
        (file: { lang: SupportedLanguage }) => {
          if (file.lang && isValidLanguage(file.lang)) {
            configuredLanguages.add(file.lang);
            logMessage(`🌐 Found configured language: ${file.lang}`);
          } else if (file.lang) {
            logMessage(`⚠️ Invalid language code: ${file.lang}`, "warn");
            this.runtimeContext.notifier.showWarn(
              `Invalid language code "${file.lang}". Language codes must be non-empty strings with less than 10 characters.`
            );
          }
        }
      );
    }

    // Load translation caches for configured languages
    if (configuredLanguages.size > 0) {
      logMessage(
        `📦 Loading caches for ${configuredLanguages.size} languages...`
      );
      const loadCachePromises = Array.from(configuredLanguages).map((lang) =>
        this.loadCacheForLanguage(lang).catch((err) => {
          logMessage(
            `❌ Failed to load cache for language ${lang}: ${err}`,
            "error"
          );
          this.runtimeContext.notifier.showError(
            `Failed to load cache for language ${lang}: ${err}`
          );
        })
      );
      await Promise.all(loadCachePromises);
      logMessage("✅ Translation cache initialization completed");
    } else {
      logMessage("⚠️ No valid target languages found in configuration", "warn");
      this.runtimeContext.notifier.showWarn(
        "No valid target languages found in configuration"
      );
    }
  } // Helper method to load or initialize a translation cache for a specific language
  private async loadCacheForLanguage(lang: SupportedLanguage): Promise<void> {
    if (!isValidLanguage(lang)) {
      logMessage(
        `⚠️ Cannot create cache for invalid language code "${lang}"`,
        "warn"
      );
      this.runtimeContext.notifier.showWarn(
        `Cannot create cache for invalid language code "${lang}"`
      );
      return;
    }

    // Sanitize the language code to create a valid file name
    const cacheFileName = `translations_${lang.replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    )}.json`;
    const cacheFilePath = path.join(this.translationCacheDir, cacheFileName);

    try {
      let cacheExists = false;
      try {
        const stat = await this.fsp.stat(cacheFilePath);
        cacheExists = stat.isFile();
      } catch {
        cacheExists = false;
      }

      if (cacheExists) {
        const cacheContent = await this.fsp.readFile(cacheFilePath, "utf8");
        const cache = JSON.parse(cacheContent);
        this.translationCache.set(lang, cache);
        const recordCount = Object.keys(cache).length;
        logMessage(
          `📄 Loaded cache for ${lang}: ${recordCount} records from ${cacheFileName}`
        );
      } else {
        // Initialize with empty record if file doesn't exist
        this.translationCache.set(lang, {});
        await this.saveCacheForLanguage(lang);
        logMessage(`📄 Created new cache file for ${lang}: ${cacheFileName}`);
      }
    } catch (error) {
      // If there's an error reading or parsing the file, start with an empty cache
      this.translationCache.set(lang, {});
      logMessage(
        `❌ Error loading translation cache for ${lang}: ${error}. Starting with empty cache.`,
        "error"
      );
      this.runtimeContext.notifier.showWarn(
        `Error loading translation cache for ${lang}: ${error}. Starting with empty cache.`
      );
    }
  } // Helper method to save the cache for a specific language
  private async saveCacheForLanguage(lang: SupportedLanguage): Promise<void> {
    if (!isValidLanguage(lang)) {
      logMessage(
        `⚠️ Cannot save cache for invalid language code "${lang}"`,
        "warn"
      );
      return;
    }

    const cacheFileName = `translations_${lang.replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    )}.json`;
    const cacheFilePath = path.join(this.translationCacheDir, cacheFileName);

    try {
      const cache = this.translationCache.get(lang) || {};
      const cacheContent = JSON.stringify(cache, null, 2);
      logMessage(
        `💾 Writing cache content for ${lang} to ${cacheFilePath} with ${
          Object.keys(cache).length
        } records`
      );
      await this.fsp.writeFile(cacheFilePath, cacheContent, "utf8");
      const recordCount = Object.keys(cache).length;
      logMessage(
        `💾 Saved cache for ${lang}: ${recordCount} records to ${cacheFileName}`
      );
    } catch (error) {
      logMessage(
        `❌ Failed to save translation cache for ${lang}: ${error}`,
        "error"
      );
      this.runtimeContext.notifier.showError(
        `Failed to save translation cache for ${lang}: ${error}`
      );
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
      throw new Error(
        `Invalid language code: ${targetLang}. Language codes must be non-empty strings with less than 10 characters.`
      );
    }

    const normalizedPath = path.normalize(targetPath).replace(/\\/g, "/");
    this.targetRoots.set(normalizedPath, targetLang);
    logMessage(`🎯 Set target root for ${targetLang}: ${normalizedPath}`);
  }

  public clearTargetRoots() {
    this.targetRoots.clear();
  }

  private getRelativePath(absolutePath: string, isSource: boolean): string {
    const normalizePath = (p: string) => path.normalize(p).replace(/\\/g, "/");
    const normalizedAbsolutePath = normalizePath(absolutePath);

    const relativeToWorkspacePath = path.relative(
      this.workspaceRoot,
      normalizedAbsolutePath
    );
    return relativeToWorkspacePath.replace(/\\/g, "/");
  }
  public async updateTranslationTime(
    sourcePath: string,
    targetPath: string,
    targetLang: SupportedLanguage
  ): Promise<void> {
    const relativeSourcePath = this.getRelativePath(sourcePath, true);
    logMessage(
      `🔄 Updating translation time for ${relativeSourcePath} (${targetLang})`
    );

    // Ensure cache exists for this language
    if (!this.translationCache.has(targetLang)) {
      logMessage(
        `🔍 Loading cache for language ${targetLang} as it doesn't exist yet`
      );
      await this.loadCacheForLanguage(targetLang);
    }

    // Get the translation record for this language
    const translationRecord = this.translationCache.get(targetLang) || {};
    logMessage(
      `📋 Current translation records for ${targetLang}: ${
        Object.keys(translationRecord).length
      }`
    );

    // Get current file info
    const fileInfo = await this.getCurrentFileInfo(sourcePath);
    logMessage(
      `📄 File info for ${relativeSourcePath}: ${JSON.stringify(fileInfo)}`
    );

    // Update the record
    translationRecord[relativeSourcePath] = fileInfo;
    logMessage(`✏️ Updated record in memory for ${relativeSourcePath}`);

    // Save back to the cache
    this.translationCache.set(targetLang, translationRecord);
    logMessage(`💾 Set translation record in memory cache for ${targetLang}`);

    // 延迟批量落盘，避免“每文件一次全量写入”
    this.markDirty(targetLang);
    logMessage(
      `✅ Updated translation record for ${relativeSourcePath}: hash=${fileInfo.src_hash.substring(
        0,
        8
      )}...`
    );
  }
  public async setLastTranslationTime(
    sourcePath: string,
    targetLang: SupportedLanguage
  ): Promise<void> {
    const relativeSourcePath = this.getRelativePath(sourcePath, true);
    logMessage(
      `🕒 Setting last translation time for ${relativeSourcePath} (${targetLang})`
    );

    // Ensure cache exists for this language
    if (!this.translationCache.has(targetLang)) {
      await this.loadCacheForLanguage(targetLang);
    }

    // Get the translation record for this language
    const translationRecord = this.translationCache.get(targetLang) || {};

    // Calculate current file info and git info with current timestamp
    const currentFileInfo = await this.getCurrentFileInfo(sourcePath);

    // Update the record with current translation time
    translationRecord[relativeSourcePath] = currentFileInfo;

    // Save back to the cache
    this.translationCache.set(targetLang, translationRecord);

    // 延迟批量落盘，避免频繁写入
    this.markDirty(targetLang);
    logMessage(
      `✅ Set translation time for ${relativeSourcePath} at ${currentFileInfo.translate_datetime}`
    );
  }
  public async shouldTranslate(
    sourcePath: string,
    targetPath: string,
    targetLang: SupportedLanguage
  ): Promise<boolean> {
    const relativeSourcePath = this.getRelativePath(sourcePath, true);
    logMessage(
      `🤔 Evaluating if translation needed for ${relativeSourcePath} (${targetLang})`
    );

    // Always translate if target file doesn't exist
    try {
      const stat = await this.fsp.stat(targetPath);
      if (!stat.isFile()) {
        logMessage(`✅ Target path is not a file, translation needed`);
        return true;
      }
    } catch {
      logMessage(`✅ Target file doesn't exist, translation needed`);
      return true;
    }

    try {
      // Ensure cache exists for this language
      if (!this.translationCache.has(targetLang)) {
        await this.loadCacheForLanguage(targetLang);
      }

      // Get the translation record for this language
      const translationRecord = this.translationCache.get(targetLang) || {};

      // Get the interval in days from configuration
      const config = await getConfiguration();
      const intervalDays = config.translationIntervalDays;

      // If the source file has no record, it should be translated
      if (!translationRecord[relativeSourcePath]) {
        logMessage(`✅ No translation record found, translation needed`);
        return true;
      }

      const cachedFileInfo = translationRecord[relativeSourcePath];

      // Parse cached datetime to timestamp for comparison
      const cachedDateTime = cachedFileInfo.translate_datetime;
      let cachedTimestamp = 0;
      if (cachedDateTime) {
        // Parse yyyy-MM-dd:hh:mm format
        const match = cachedDateTime.match(
          /^(\d{4})-(\d{2})-(\d{2}):(\d{2}):(\d{2})$/
        );
        if (match) {
          const [, year, month, day, hours, minutes] = match;
          cachedTimestamp = new Date(
            parseInt(year),
            parseInt(month) - 1, // months are 0-indexed
            parseInt(day),
            parseInt(hours),
            parseInt(minutes)
          ).getTime();
        }
      }
      const daysSinceLastTranslation =
        (Date.now() - cachedTimestamp) / (1000 * 60 * 60 * 24);
      const isPastInterval =
        daysSinceLastTranslation >= intervalDays && intervalDays > 0;

      logMessage(
        `📊 Translation analysis: days since last=${daysSinceLastTranslation.toFixed(
          1
        )}, interval=${intervalDays}, past interval=${isPastInterval}`
      );

      if (isPastInterval) {
        logMessage(
          `✅ Translation decision: NEEDED (past interval: ${isPastInterval})`
        );
        return true;
      }

      // Fast path: if stat matches cached, skip hashing.
      let hashChanged = false;
      const hasCachedStat =
        typeof cachedFileInfo.src_mtime_ms === "number" &&
        typeof cachedFileInfo.src_size === "number";

      const currentStat = await this.getCurrentSourceFileStat(sourcePath);
      if (
        hasCachedStat &&
        currentStat.src_mtime_ms === cachedFileInfo.src_mtime_ms &&
        currentStat.src_size === cachedFileInfo.src_size
      ) {
        hashChanged = false;
        // Populate in-memory cache for reuse by other target languages.
        this.sourceFileInfoCache.set(sourcePath, {
          ...currentStat,
          src_hash: cachedFileInfo.src_hash,
          checkedAt: Date.now(),
        });
      } else {
        const currentHash = await this.getSourceFileHashForStat(
          sourcePath,
          currentStat
        );
        hashChanged = currentHash !== cachedFileInfo.src_hash;

        // If content is unchanged but stat differs (e.g. file touched), backfill
        // stat fields to avoid future hashing.
        if (!hashChanged) {
          cachedFileInfo.src_mtime_ms = currentStat.src_mtime_ms;
          cachedFileInfo.src_size = currentStat.src_size;
        }
      }

      logMessage(
        `📋 Checking translation necessity for ${relativeSourcePath}: hash changed=${hashChanged}`
      );

      const shouldTranslate = hashChanged;
      logMessage(
        `${shouldTranslate ? "✅" : "⏭️"} Translation decision: ${
          shouldTranslate ? "NEEDED" : "SKIP"
        } (hash changed: ${hashChanged}, past interval: ${isPastInterval})`
      );

      return shouldTranslate;
    } catch (error) {
      logMessage(`❌ Error in shouldTranslate: ${error}`, "error");
      this.runtimeContext.notifier.showError(`Error in shouldTranslate: ${error}`);
      return true; // If there's an error, proceed with translation
    }
  }
  public close(): Promise<void> {
    logMessage("🔒 Closing translation database...");

    return this.flush().then(() => {
      this.translationCache.clear();
      logMessage("✅ Translation database closed successfully");
    });
  }
  private async calculateFileHash(filePath: string): Promise<string> {
    try {
      const hash = crypto.createHash("md5");
      await new Promise<void>((resolve, reject) => {
        const rs = fs.createReadStream(filePath);
        rs.on("data", (chunk) => {
          hash.update(chunk);
        });
        rs.on("error", (err) => {
          reject(err);
        });
        rs.on("end", () => resolve());
      });
      const digest = hash.digest("hex");
      logMessage(
        `🔍 Calculated file hash for ${path.basename(
          filePath
        )}: ${digest.substring(0, 8)}...`
      );
      return digest;
    } catch (error) {
      logMessage(
        `❌ Error calculating hash for ${filePath}: ${error}`,
        "error"
      );
      throw error;
    }
  }

  private formatDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}:${hours}:${minutes}`;
  }

  private async getCurrentSourceFileStat(sourcePath: string): Promise<{
    src_size: number;
    src_mtime_ms: number;
  }> {
    const now = Date.now();
    const cached = this.sourceFileInfoCache.get(sourcePath);
    if (cached && now - cached.checkedAt < this.sourceFileInfoCacheTtlMs) {
      return { src_size: cached.src_size, src_mtime_ms: cached.src_mtime_ms };
    }

    const stat = await this.fsp.stat(sourcePath);
    const current = { src_size: stat.size, src_mtime_ms: stat.mtimeMs };
    this.sourceFileInfoCache.set(sourcePath, {
      ...current,
      src_hash: cached?.src_hash,
      checkedAt: now,
    });
    return current;
  }

  private async getSourceFileHashForStat(
    sourcePath: string,
    currentStat: { src_size: number; src_mtime_ms: number }
  ): Promise<string> {
    const cached = this.sourceFileInfoCache.get(sourcePath);
    if (
      cached &&
      cached.src_hash &&
      cached.src_size === currentStat.src_size &&
      cached.src_mtime_ms === currentStat.src_mtime_ms
    ) {
      return cached.src_hash;
    }

    const src_hash = await this.calculateFileHash(sourcePath);
    this.sourceFileInfoCache.set(sourcePath, {
      ...currentStat,
      src_hash,
      checkedAt: Date.now(),
    });
    return src_hash;
  }

  private async getCurrentFileInfo(sourcePath: string): Promise<TranslationFileInfo> {
    const timestamp = Date.now();
    const translate_datetime = this.formatDateTime(timestamp);
    const currentStat = await this.getCurrentSourceFileStat(sourcePath);
    const src_hash = await this.getSourceFileHashForStat(sourcePath, currentStat);

    return {
      translate_datetime,
      src_hash,
      src_size: currentStat.src_size,
      src_mtime_ms: currentStat.src_mtime_ms,
    };
  }
}
