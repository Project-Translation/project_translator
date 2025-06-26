import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { SpecifiedFolder } from "./types/types";
import { getConfiguration } from "./config/config";

// Example language codes, but system now accepts any string with length < 10
export const SUPPORTED_LANGUAGES = [
  "zh-cn",
  "zh-tw",
  "en-us",
  "ja-jp",
  "ko-kr",
  "fr-fr",
  "de-de",
  "es-es",
  "pt-br",
  "ru-ru",
];

// Any string with length under 10 characters is now a valid language code
export type SupportedLanguage = string;

// Validate if a string is a valid language code (under 10 characters)
export function isValidLanguage(lang: string): boolean {
  return typeof lang === "string" && lang.length > 0 && lang.length < 10;
}

interface TranslationRecord {
  [sourcePath: string]: {
    translate_datetime: string;
    src_hash: string;
    src_commit_id: string;
  };
}

export class TranslationDatabase {
  private translationCacheDir: string;
  private workspaceRoot: string;
  private sourceRoot: string | null = null;
  private targetRoots: Map<string, SupportedLanguage> = new Map();
  private translationCache: Map<string, TranslationRecord> = new Map();
  private outputChannel: vscode.OutputChannel;

  constructor(workspaceRoot: string, outputChannel: vscode.OutputChannel) {
    this.workspaceRoot = workspaceRoot;
    this.outputChannel = outputChannel;
    this.translationCacheDir = path.join(workspaceRoot, ".translation-cache");

    // Initialize cache directory and load data
    this.initCache().catch((err) => {
      vscode.window.showErrorMessage(
        `Failed to initialize translation cache: ${err}`
      );
    });
  }
  private async initCache() {
    this.outputChannel.appendLine("🗂️ Initializing translation cache...");

    // Create the cache directory if it doesn't exist
    if (!fs.existsSync(this.translationCacheDir)) {
      fs.mkdirSync(this.translationCacheDir, { recursive: true });
      this.outputChannel.appendLine(
        `📁 Created cache directory: ${this.translationCacheDir}`
      );
    }

    // Get configuration
    const config = vscode.workspace.getConfiguration("projectTranslator");
    const specifiedFolders =
      config.get<Array<SpecifiedFolder>>("specifiedFolders") || [];

    // Only create caches for languages specified in the configuration
    const configuredLanguages = new Set<SupportedLanguage>();

    if (specifiedFolders.length > 0) {
      specifiedFolders[0].targetFolders?.forEach(
        (folder: { lang: SupportedLanguage }) => {
          if (folder.lang && isValidLanguage(folder.lang)) {
            configuredLanguages.add(folder.lang);
            this.outputChannel.appendLine(
              `🌐 Found configured language: ${folder.lang}`
            );
          } else if (folder.lang) {
            this.outputChannel.appendLine(
              `⚠️ Invalid language code: ${folder.lang}`
            );
            vscode.window.showWarningMessage(
              `Invalid language code "${folder.lang}". Language codes must be non-empty strings with less than 10 characters.`
            );
          }
        }
      );
    }

    // Load translation caches for configured languages
    if (configuredLanguages.size > 0) {
      this.outputChannel.appendLine(
        `📦 Loading caches for ${configuredLanguages.size} languages...`
      );
      const loadCachePromises = Array.from(configuredLanguages).map((lang) =>
        this.loadCacheForLanguage(lang).catch((err) => {
          this.outputChannel.appendLine(
            `❌ Failed to load cache for language ${lang}: ${err}`
          );
          vscode.window.showErrorMessage(
            `Failed to load cache for language ${lang}: ${err}`
          );
        })
      );
      await Promise.all(loadCachePromises);
      this.outputChannel.appendLine(
        "✅ Translation cache initialization completed"
      );
    } else {
      this.outputChannel.appendLine(
        "⚠️ No valid target languages found in configuration"
      );
      vscode.window.showWarningMessage(
        "No valid target languages found in configuration"
      );
    }
  } // Helper method to load or initialize a translation cache for a specific language
  private async loadCacheForLanguage(lang: SupportedLanguage): Promise<void> {
    if (!isValidLanguage(lang)) {
      this.outputChannel.appendLine(
        `⚠️ Cannot create cache for invalid language code "${lang}"`
      );
      vscode.window.showWarningMessage(
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
      if (fs.existsSync(cacheFilePath)) {
        const cacheContent = fs.readFileSync(cacheFilePath, "utf8");
        const cache = JSON.parse(cacheContent) as TranslationRecord;
        this.translationCache.set(lang, cache);
        const recordCount = Object.keys(cache).length;
        this.outputChannel.appendLine(
          `📄 Loaded cache for ${lang}: ${recordCount} records from ${cacheFileName}`
        );
      } else {
        // Initialize with empty record if file doesn't exist
        this.translationCache.set(lang, {});
        await this.saveCacheForLanguage(lang);
        this.outputChannel.appendLine(
          `📄 Created new cache file for ${lang}: ${cacheFileName}`
        );
      }
    } catch (error) {
      // If there's an error reading or parsing the file, start with an empty cache
      this.translationCache.set(lang, {});
      this.outputChannel.appendLine(
        `❌ Error loading translation cache for ${lang}: ${error}. Starting with empty cache.`
      );
      vscode.window.showWarningMessage(
        `Error loading translation cache for ${lang}: ${error}. Starting with empty cache.`
      );
    }
  } // Helper method to save the cache for a specific language
  private async saveCacheForLanguage(lang: SupportedLanguage): Promise<void> {
    if (!isValidLanguage(lang)) {
      return;
    }

    const cacheFileName = `translations_${lang.replace(
      /[^a-zA-Z0-9_]/g,
      "_"
    )}.json`;
    const cacheFilePath = path.join(this.translationCacheDir, cacheFileName);

    try {
      const cacheContent = JSON.stringify(
        this.translationCache.get(lang) || {},
        null,
        2
      );
      fs.writeFileSync(cacheFilePath, cacheContent, "utf8");
      const recordCount = Object.keys(
        this.translationCache.get(lang) || {}
      ).length;
      this.outputChannel.appendLine(
        `💾 Saved cache for ${lang}: ${recordCount} records to ${cacheFileName}`
      );
    } catch (error) {
      this.outputChannel.appendLine(
        `❌ Failed to save translation cache for ${lang}: ${error}`
      );
      vscode.window.showErrorMessage(
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
    this.outputChannel.appendLine(
      `🎯 Set target root for ${targetLang}: ${normalizedPath}`
    );
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
    this.outputChannel.appendLine(
      `🔄 Updating translation time for ${relativeSourcePath} (${targetLang})`
    );

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
    this.outputChannel.appendLine(
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
    this.outputChannel.appendLine(
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

    // Save to file
    await this.saveCacheForLanguage(targetLang);
    this.outputChannel.appendLine(
      `✅ Set translation time for ${relativeSourcePath} at ${currentFileInfo.translate_datetime}`
    );
  }
  public async shouldTranslate(
    sourcePath: string,
    targetPath: string,
    targetLang: SupportedLanguage
  ): Promise<boolean> {
    const relativeSourcePath = this.getRelativePath(sourcePath, true);
    this.outputChannel.appendLine(
      `🤔 Evaluating if translation needed for ${relativeSourcePath} (${targetLang})`
    );

    // Always translate if target file doesn't exist
    if (!fs.existsSync(targetPath)) {
      this.outputChannel.appendLine(
        `✅ Target file doesn't exist, translation needed`
      );
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
      const config = getConfiguration();
      const intervalDays = config.translationIntervalDays;

      // If the source file has no record, it should be translated
      if (!translationRecord[relativeSourcePath]) {
        this.outputChannel.appendLine(
          `✅ No translation record found, translation needed`
        );
        return true;
      }

      // Get current file info to compare
      const currentFileInfo = await this.getCurrentFileInfo(sourcePath);
      const cachedFileInfo = translationRecord[relativeSourcePath]; // Check if both conditions are met: hash changed and past interval
      const hashChanged = currentFileInfo.src_hash !== cachedFileInfo.src_hash;
      this.outputChannel.appendLine(
        `📋 Checking translation necessity for ${relativeSourcePath}: hash changed=${hashChanged}`
      );

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
      const isPastInterval = daysSinceLastTranslation >= intervalDays;

      this.outputChannel.appendLine(
        `📊 Translation analysis: days since last=${daysSinceLastTranslation.toFixed(
          1
        )}, interval=${intervalDays}, past interval=${isPastInterval}`
      );

      const shouldTranslate = hashChanged || isPastInterval;
      this.outputChannel.appendLine(
        `${shouldTranslate ? "✅" : "⏭️"} Translation decision: ${
          shouldTranslate ? "NEEDED" : "SKIP"
        } (hash changed: ${hashChanged}, past interval: ${isPastInterval})`
      );

      return shouldTranslate;
    } catch (error) {
      this.outputChannel.appendLine(`❌ Error in shouldTranslate: ${error}`);
      vscode.window.showErrorMessage(`Error in shouldTranslate: ${error}`);
      return true; // If there's an error, proceed with translation
    }
  }
  public close(): Promise<void> {
    this.outputChannel.appendLine("🔒 Closing translation database...");

    // Save all caches before closing
    const savePromises = Array.from(this.translationCache.keys()).map((lang) =>
      this.saveCacheForLanguage(lang)
    );

    return Promise.all(savePromises).then(() => {
      // Clear the cache to free up memory
      this.translationCache.clear();
      this.outputChannel.appendLine(
        "✅ Translation database closed successfully"
      );
    });
  }
  private calculateFileHash(filePath: string): string {
    try {
      const fileContent = fs.readFileSync(filePath);
      const hash = crypto.createHash("md5").update(fileContent).digest("hex");
      this.outputChannel.appendLine(
        `🔍 Calculated file hash for ${path.basename(
          filePath
        )}: ${hash.substring(0, 8)}...`
      );
      return hash;
    } catch (error) {
      this.outputChannel.appendLine(
        `❌ Error calculating hash for ${filePath}: ${error}`
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
  private async getGitCommitInfo(
    filePath: string
  ): Promise<{ commitId: string }> {
    try {
      // Get the git extension
      const gitExtension = vscode.extensions.getExtension("vscode.git");
      if (!gitExtension) {
        this.outputChannel.appendLine(
          "📡 Git extension not found, skipping commit info"
        );
        return { commitId: "" };
      }

      // Ensure the git extension is activated
      if (!gitExtension.isActive) {
        await gitExtension.activate();
      }

      const git = gitExtension.exports.getAPI(1);
      if (!git) {
        this.outputChannel.appendLine(
          "📡 Git API not available, skipping commit info"
        );
        return { commitId: "" };
      }

      // Find the repository that contains this file
      const fileUri = vscode.Uri.file(filePath);
      const repository = git.getRepository(fileUri);
      if (!repository) {
        this.outputChannel.appendLine(
          `📡 No git repository found for ${path.basename(filePath)}`
        );
        return { commitId: "" };
      } // Get the relative path from repository root
      const relativePath = path.relative(repository.rootUri.fsPath, filePath);

      // Get the HEAD commit
      const head = repository.state.HEAD;
      if (!head || !head.commit) {
        this.outputChannel.appendLine("📡 No HEAD commit found in repository");
        return { commitId: "" };
      }

      // For now, we'll use the HEAD commit info
      // In a more advanced implementation, we could get the last commit that modified this specific file
      const commitId = head.commit;
      this.outputChannel.appendLine(
        `📡 Git commit info for ${path.basename(
          filePath
        )}: ${commitId.substring(0, 8)}...`
      );

      return { commitId };
    } catch (error) {
      // If there's any error with git operations, return empty values
      this.outputChannel.appendLine(
        `❌ Error getting git info for ${path.basename(filePath)}: ${error}`
      );
      return { commitId: "" };
    }
  }

  private async getCurrentFileInfo(sourcePath: string): Promise<{
    translate_datetime: string;
    src_hash: string;
    src_commit_id: string;
  }> {
    const timestamp = Date.now();
    const translate_datetime = this.formatDateTime(timestamp);
    const src_hash = this.calculateFileHash(sourcePath);
    const { commitId: src_commit_id } = await this.getGitCommitInfo(sourcePath);

    return { translate_datetime, src_hash, src_commit_id };
  }

  /**
   * Get the commit ID of the last translation
   * @param sourcePath Source file path
   * @param targetLang Target language
   * @returns The commit ID at the last translation, or an empty string if not found
   */
  public async getLastTranslationCommitId(
    sourcePath: string,
    targetLang: SupportedLanguage
  ): Promise<string> {
    const relativeSourcePath = this.getRelativePath(sourcePath, true);
    // Ensure cache exists
    if (!this.translationCache.has(targetLang)) {
      await this.loadCacheForLanguage(targetLang);
    }

    const translationRecord = this.translationCache.get(targetLang) || {};
    const fileRecord = translationRecord[relativeSourcePath];

    if (fileRecord && fileRecord.src_commit_id) {
      this.outputChannel.appendLine(
        `📋 Found last translation commit ID: ${fileRecord.src_commit_id.substring(0, 8)}... (${targetLang})`
      );
      return fileRecord.src_commit_id;
    }

    this.outputChannel.appendLine(
      `📋 No previous translation record found: ${relativeSourcePath} (${targetLang})`
    );
    return "";
  }

  /**
   * Check if the file needs diff translation
   * @param sourcePath Source file path
   * @param targetLang Target language
   * @returns Result of whether diff translation is needed
   */
  public async needsDiffTranslation(
    sourcePath: string,
    targetLang: SupportedLanguage
  ): Promise<{
    needsDiff: boolean;
    lastCommitId: string;
    hasTranslationRecord: boolean;
    reason: string;
  }> {
    const relativeSourcePath = this.getRelativePath(sourcePath, true);
    // Ensure cache exists
    if (!this.translationCache.has(targetLang)) {
      await this.loadCacheForLanguage(targetLang);
    }

    const translationRecord = this.translationCache.get(targetLang) || {};
    const fileRecord = translationRecord[relativeSourcePath];

    // If there is no translation record, diff translation is not needed
    if (!fileRecord) {
      return {
        needsDiff: false,
        lastCommitId: "",
        hasTranslationRecord: false,
        reason: "No translation record, full translation needed"
      };
    }

    // Get current file's commit info
    const { commitId: currentCommitId } = await this.getGitCommitInfo(sourcePath);
    const lastCommitId = fileRecord.src_commit_id;

    // If there is no git info, fallback to hash comparison
    if (!currentCommitId || !lastCommitId) {
      const currentHash = this.calculateFileHash(sourcePath);
      const hashChanged = currentHash !== fileRecord.src_hash;
      
      return {
        needsDiff: false, // 没有git信息时不使用差异翻译
        lastCommitId: lastCommitId,
        hasTranslationRecord: true,
        reason: hashChanged ? "File has changed but no git info, full translation needed" : "File not changed"
      };
    }

    // Compare commit IDs
    const commitChanged = currentCommitId !== lastCommitId;
    
    if (!commitChanged) {
      return {
        needsDiff: false,
        lastCommitId: lastCommitId,
        hasTranslationRecord: true,
        reason: "File not changed since last translation"
      };
    }

    return {
      needsDiff: true,
      lastCommitId: lastCommitId,
      hasTranslationRecord: true,
      reason: "File has changed, diff translation can be used"
    };
  }

  /**
   * Update the commit info in the translation record
   * @param sourcePath Source file path
   * @param targetLang Target language
   * @param newCommitId New commit ID (optional, if not provided will get current commit)
   */
  public async updateTranslationCommitId(
    sourcePath: string,
    targetLang: SupportedLanguage,
    newCommitId?: string
  ): Promise<void> {
    const relativeSourcePath = this.getRelativePath(sourcePath, true);
    // Ensure cache exists
    if (!this.translationCache.has(targetLang)) {
      await this.loadCacheForLanguage(targetLang);
    }

    const translationRecord = this.translationCache.get(targetLang) || {};
    
    // Get or use provided commit ID
    const commitId = newCommitId || (await this.getGitCommitInfo(sourcePath)).commitId;
    
    // Update existing record or create new record
    if (translationRecord[relativeSourcePath]) {
      translationRecord[relativeSourcePath].src_commit_id = commitId;
      this.outputChannel.appendLine(
        `🔄 Updated translation record commit ID: ${commitId.substring(0, 8)}... (${targetLang})`
      );
    } else {
      // If there is no existing record, create a new full record
      const currentFileInfo = await this.getCurrentFileInfo(sourcePath);
      currentFileInfo.src_commit_id = commitId;
      translationRecord[relativeSourcePath] = currentFileInfo;
      this.outputChannel.appendLine(
        `➕ Created new translation record: ${commitId.substring(0, 8)}... (${targetLang})`
      );
    }

    // Save to cache
    this.translationCache.set(targetLang, translationRecord);
    
    // Save to file
    await this.saveCacheForLanguage(targetLang);
  }
}
