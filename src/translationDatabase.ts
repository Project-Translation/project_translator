import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { SpecifiedFolder } from "./types/types";
import { getConfiguration } from "./config/config";
import { logMessage } from "./extension";

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
    logMessage("🗂️ Initializing translation cache...");

    // Create the cache directory if it doesn't exist
    if (!fs.existsSync(this.translationCacheDir)) {
      fs.mkdirSync(this.translationCacheDir, { recursive: true });
      logMessage(
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
            logMessage(
              `🌐 Found configured language: ${folder.lang}`
            );
          } else if (folder.lang) {
            logMessage(
              `⚠️ Invalid language code: ${folder.lang}`,
              'warn'
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
      logMessage(
        `📦 Loading caches for ${configuredLanguages.size} languages...`
      );
      const loadCachePromises = Array.from(configuredLanguages).map((lang) =>
        this.loadCacheForLanguage(lang).catch((err) => {
          logMessage(
            `❌ Failed to load cache for language ${lang}: ${err}`,
            'error'
          );
          vscode.window.showErrorMessage(
            `Failed to load cache for language ${lang}: ${err}`
          );
        })
      );
      await Promise.all(loadCachePromises);
      logMessage(
        "✅ Translation cache initialization completed"
      );
    } else {
      logMessage(
        "⚠️ No valid target languages found in configuration",
        'warn'
      );
      vscode.window.showWarningMessage(
        "No valid target languages found in configuration"
      );
    }
  } // Helper method to load or initialize a translation cache for a specific language
  private async loadCacheForLanguage(lang: SupportedLanguage): Promise<void> {
    if (!isValidLanguage(lang)) {
      logMessage(
        `⚠️ Cannot create cache for invalid language code "${lang}"`,
        'warn'
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
        logMessage(
          `📄 Loaded cache for ${lang}: ${recordCount} records from ${cacheFileName}`
        );
      } else {
        // Initialize with empty record if file doesn't exist
        this.translationCache.set(lang, {});
        await this.saveCacheForLanguage(lang);
        logMessage(
          `📄 Created new cache file for ${lang}: ${cacheFileName}`
        );
      }
    } catch (error) {
      // If there's an error reading or parsing the file, start with an empty cache
      this.translationCache.set(lang, {});
      logMessage(
        `❌ Error loading translation cache for ${lang}: ${error}. Starting with empty cache.`,
        'error'
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
      logMessage(
        `💾 Saved cache for ${lang}: ${recordCount} records to ${cacheFileName}`
      );
    } catch (error) {
      logMessage(
        `❌ Failed to save translation cache for ${lang}: ${error}`,
        'error'
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
    logMessage(
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
    logMessage(
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

    // Save to file
    await this.saveCacheForLanguage(targetLang);
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
    if (!fs.existsSync(targetPath)) {
      logMessage(
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
        logMessage(
          `✅ No translation record found, translation needed`
        );
        return true;
      }

      // Get current file info to compare
      const currentFileInfo = await this.getCurrentFileInfo(sourcePath);
      const cachedFileInfo = translationRecord[relativeSourcePath]; // Check if both conditions are met: hash changed and past interval
      const hashChanged = currentFileInfo.src_hash !== cachedFileInfo.src_hash;
      logMessage(
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
      const isPastInterval = daysSinceLastTranslation >= intervalDays && intervalDays > 0;

      logMessage(
        `📊 Translation analysis: days since last=${daysSinceLastTranslation.toFixed(
          1
        )}, interval=${intervalDays}, past interval=${isPastInterval}`
      );

      const shouldTranslate = hashChanged || isPastInterval;
      logMessage(
        `${shouldTranslate ? "✅" : "⏭️"} Translation decision: ${
          shouldTranslate ? "NEEDED" : "SKIP"
        } (hash changed: ${hashChanged}, past interval: ${isPastInterval})`
      );

      return shouldTranslate;
    } catch (error) {
      logMessage(`❌ Error in shouldTranslate: ${error}`, 'error');
      vscode.window.showErrorMessage(`Error in shouldTranslate: ${error}`);
      return true; // If there's an error, proceed with translation
    }
  }
  public close(): Promise<void> {
    logMessage("🔒 Closing translation database...");

    // Save all caches before closing
    const savePromises = Array.from(this.translationCache.keys()).map((lang) =>
      this.saveCacheForLanguage(lang)
    );

    return Promise.all(savePromises).then(() => {
      // Clear the cache to free up memory
      this.translationCache.clear();
      logMessage(
        "✅ Translation database closed successfully"
      );
    });
  }
  private calculateFileHash(filePath: string): string {
    try {
      const fileContent = fs.readFileSync(filePath);
      const hash = crypto.createHash("md5").update(fileContent).digest("hex");
      logMessage(
        `🔍 Calculated file hash for ${path.basename(
          filePath
        )}: ${hash.substring(0, 8)}...`
      );
      return hash;
    } catch (error) {
      logMessage(
        `❌ Error calculating hash for ${filePath}: ${error}`,
        'error'
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


  private async getCurrentFileInfo(sourcePath: string): Promise<{
    translate_datetime: string;
    src_hash: string;
  }> {
    const timestamp = Date.now();
    const translate_datetime = this.formatDateTime(timestamp);
    const src_hash = this.calculateFileHash(sourcePath);

    return { translate_datetime, src_hash };
  }






}
