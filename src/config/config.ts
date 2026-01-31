import * as vscode from "vscode";
import {
  VendorConfig,
  SpecifiedFile,
  SpecifiedFolder,
  CopyOnlyConfig,
  IgnoreConfig,
  SkipFrontMatterConfig,
  DiffApplyConfig,
} from "../types/types";
import * as path from "path";
import * as fs from "fs";
import { DEFAULT_SYSTEM_PROMPT_PART1, DEFAULT_SYSTEM_PROMPT_PART2 } from "./prompt";
// process env used in translatorService, not needed here

const fsp = fs.promises;

// Default vendor configuration
export const DEFAULT_VENDOR_CONFIG: VendorConfig = {
  name: "deepseek",
  apiEndpoint: "https://api.deepseek.com/v1",
  apiKeyEnvVarName: "DEEPSEEK_API_KEY",
  model: "deepseek-chat",
  rpm: 20,
  maxTokensPerSegment: 3000,
  timeout: 180,
  temperature: 0.1,
  top_p: 0.95,
  streamMode: true
};

// System prompts are now imported from prompt.js

// Using Record<string, string> instead of any
// i18n map
let translations: Record<string, string> = {};

// Normalize env var name from vendor name (replace non-alnum to '_', uppercase, append _API_KEY)
const normalizeEnvVarNameFromVendorName = (name: string): string => {
  const baseCandidate = name && name.trim().length > 0 ? name : "VENDOR"
  const base = baseCandidate.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()
  return `${base}_API_KEY`
}

export function loadTranslations(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("projectTranslator");
  const language = config.get<string>("language", "en");
  const translationsPath = path.join(
    context.extensionPath,
    "i18n",
    `${language}.json`
  );
  try {
    const stat = fs.statSync(translationsPath);
    if (stat.isFile()) {
      translations = JSON.parse(fs.readFileSync(translationsPath, "utf-8"));
    }
  } catch {
    // 如果翻译文件不存在则静默忽略，保持空 translations
  }
}

export interface Config {
  specifiedFiles?: SpecifiedFile[]; // Configuration for specified files
  specifiedFolders?: SpecifiedFolder[]; // Configuration for specified folders
  copyOnly?: CopyOnlyConfig; // Configuration for copy-only files and folders
  ignore?: IgnoreConfig; // Configuration for files and folders to ignore during translation
  currentVendorName: string; // Name of the current vendor
  vendors: VendorConfig[]; // List of vendor configurations
  translationIntervalDays: number; // Interval for translation in days
  currentVendor: VendorConfig; // Current vendor configuration (derived from vendors array)
  customPrompts?: string[]; // Custom prompts for translation (appended to default system prompt)
  segmentationMarkers?: Record<string, string[]>; // Segmentation markers configured by file type

  debug?: boolean; // Enable debug mode to log API requests and responses
  logFile?: LogFileConfig; // Configuration for debug log file output
  skipFrontMatter?: SkipFrontMatterConfig; // Configuration for skipping files based on front matter markers
  diffApply?: DiffApplyConfig; // Differential translation apply mode
}

// In-memory config cache to avoid repeatedly reading/parsing project.translation.json
// during large project scans. We keep it conservative: short TTL + mtime check.
const configCacheTtlMs = 2000;
let cachedConfig:
  | {
      workspaceRoot: string | null;
      fileMtimeMs: number | null;
      loadedAt: number;
      config: Config;
    }
  | null = null;

/**
 * Clear in-memory configuration cache.
 * Useful when VS Code settings change or callers need fresh config immediately.
 */
export function clearConfigurationCache(): void {
  cachedConfig = null;
}

// Configuration interface for log file functionality
export interface LogFileConfig {
  enabled: boolean; // Enable writing logs to file when debug mode is on
  path?: string; // Custom log file path (optional, defaults to workspace/.translation-logs/)
  maxSizeKB?: number; // Maximum log file size in KB before rotation (default: 10240 = 10MB)
  maxFiles?: number; // Maximum number of log files to keep (default: 5)
}

/**
 * Validate that the configuration structure is consistent
 * This is useful for testing and debugging
 */
export function validateConfigStructure(config: Config): boolean {
  const requiredFields = [
    "currentVendorName",
    "vendors",
    "translationIntervalDays",
    "currentVendor",
  ];

  for (const field of requiredFields) {
    if (!(field in config)) {
      // use output channel logger in extension elsewhere; keep console out for lint
      throw new Error(`Missing required field: ${field}`);
      return false;
    }
  }

  // Validate currentVendor is properly set
  if (!config.currentVendor || !config.currentVendor.name) {
    throw new Error("currentVendor is not properly configured");
  }

  // Validate that currentVendor exists in vendors array
  const vendorExists = config.vendors.some(
    (v) => v.name === config.currentVendorName
  );
  if (!vendorExists) {
    throw new Error(
      `Current vendor "${config.currentVendorName}" not found in vendors array`
    );
  }

  return true;
}

/**
 * Export current effective VSCode settings to project.translation.json
 */
export async function exportSettingsToConfigFile(): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder is open");
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const configFilePath = path.join(workspaceRoot, "project.translation.json");

  try {
    // Get all projectTranslator settings from VSCode configuration
    // This will get the effective configuration considering user, remote, and workspace settings with proper priority
    // Priority order: workspace > remote > user
    const config = vscode.workspace.getConfiguration("projectTranslator"); // Define all projectTranslator setting keys that should be exported
    // Note: enableMetrics is intentionally excluded as it should remain hidden
    const settingKeys = [
      "currentVendor",
      "vendors",
      "destFolders",
      // intentionally exclude enableMetrics from export
      "debug",
      "logFile",
      "specifiedFiles",
      "specifiedFolders",
      "translationIntervalDays",
      "copyOnly",
      "ignore",
      "customPrompts",
      "segmentationMarkers",
      "diffApply",
    ];

    // Extract settings and remove the projectTranslator prefix
    const settings: any = {};
    for (const key of settingKeys) {
      const value = config.get(key);
      if (value !== undefined) {
        settings[key] = value;
      }
    }

    // Post-process vendors: only keep the currently selected vendor
    const currentVendorName = settings.currentVendor || config.get<string>("currentVendor")
    const vendorsFromSettings = (settings.vendors || config.get("vendors") || []) as VendorConfig[]

    const selectedVendor = vendorsFromSettings.find(v => v.name === currentVendorName)
      || vendorsFromSettings.find(v => v.name === DEFAULT_VENDOR_CONFIG.name)
      || vendorsFromSettings[0]

    if (selectedVendor) {
      const vendorToExport: any = { ...selectedVendor }

      // Security: remove plaintext apiKey only when exporting to file
      if ("apiKey" in vendorToExport) {
        delete vendorToExport.apiKey
      }

      // Ensure apiKeyEnvVarName is present; keep apiKey if provided
      if (!vendorToExport.apiKeyEnvVarName || `${vendorToExport.apiKeyEnvVarName}`.trim().length === 0) {
        const baseName = vendorToExport.name || currentVendorName || DEFAULT_VENDOR_CONFIG.name
        vendorToExport.apiKeyEnvVarName = normalizeEnvVarNameFromVendorName(baseName)
      }

      // Remove fields that equal defaults (full coverage)
      const comparableKeys: Array<keyof VendorConfig> = [
        "apiEndpoint",
        "model",
        "rpm",
        "maxTokensPerSegment",
        "timeout",
        "temperature",
        "top_p",
        "streamMode",
      ]
      for (const k of comparableKeys) {
        if (vendorToExport[k] === (DEFAULT_VENDOR_CONFIG as any)[k]) {
          delete vendorToExport[k]
        }
      }

      settings.vendors = [vendorToExport]
      settings.currentVendor = vendorToExport.name
    } else {
      // No vendor found in settings; export minimal entry using currentVendorName
      const minimalName = (currentVendorName || DEFAULT_VENDOR_CONFIG.name) as string
      const minimalVendor: any = { name: minimalName }
      const envName = normalizeEnvVarNameFromVendorName(minimalName)
      if (envName !== (DEFAULT_VENDOR_CONFIG.apiKeyEnvVarName || "")) {
        minimalVendor.apiKeyEnvVarName = envName
      }
      settings.vendors = [ minimalVendor ]
      settings.currentVendor = minimalName
    }

    // Deep-equal helper for pruning defaults
    const deepEqual = (a: any, b: any): boolean => {
      if (a === b) {return true}
      if (typeof a !== typeof b) {return false}
      if (a && b && typeof a === 'object') {
        if (Array.isArray(a) !== Array.isArray(b)) {return false}
        if (Array.isArray(a)) {
          if (a.length !== b.length) {return false}
          for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) {return false}
          }
          return true
        }
        const aKeys = Object.keys(a)
        const bKeys = Object.keys(b)
        if (aKeys.length !== bKeys.length) {return false}
        for (const k of aKeys) {
          if (!deepEqual(a[k], b[k])) {return false}
        }
        return true
      }
      return false
    }

    // VSCode defaults may be undefined in some environments; fall back to baseline defaults
    const baselineDefaults: Record<string, any> = {
      translationIntervalDays: -1,
      customPrompts: [],
      copyOnly: { paths: [], extensions: [".svg"] },
      ignore: {
        paths: [
          "**/node_modules/**",
          "**/.git/**",
          "**/.github/**",
          "**/.vscode/**",
          "**/.nuxt/**",
          "**/.next/**",
        ],
        extensions: [],
      },
      segmentationMarkers: {
        markdown: ["^#\\s", "^##\\s", "^###\\s"],
        html: ["^<h1[^>]*>", "^<h2[^>]*>", "^<h3[^>]*>"],
        javascript: ["^function\\s+\\w+\\(", "^class\\s+\\w+"],
        typescript: ["^function\\s+\\w+\\(", "^class\\s+\\w+", "^interface\\s+\\w+"],
        python: ["^def\\s+\\w+\\(", "^class\\s+\\w+"],
        java: ["^public\\s+(class|interface|enum)\\s+\\w+", "^\\s*public\\s+\\w+\\s+\\w+\\("],
        go: ["^func\\s+\\w+\\(", "^type\\s+\\w+\\s+struct"],
        "c#": ["^public\\s+(class|interface|enum)\\s+\\w+", "^\\s*public\\s+\\w+\\s+\\w+\\("],
        php: ["^function\\s+\\w+\\(", "^class\\s+\\w+"],
        ruby: ["^def\\s+\\w+", "^class\\s+\\w+"],
        rust: ["^fn\\s+\\w+", "^struct\\s+\\w+", "^enum\\s+\\w+"],
        swift: ["^func\\s+\\w+", "^class\\s+\\w+", "^struct\\s+\\w+"],
        kotlin: ["^fun\\s+\\w+", "^class\\s+\\w+"],
        plaintext: ["^\\s*$"],
      },
      diffApply: {
        enabled: false,
        validationLevel: "normal",
        autoBackup: true,
        maxOperationsPerFile: 100,
      },
    }

    // Prune top-level fields that equal defaults
    for (const key of Object.keys(settings)) {
      if (key === 'vendors' || key === 'currentVendor') {continue} // always keep these
      const inspected = config.inspect(key as any)
      const defaultValue = (inspected && 'defaultValue' in inspected) ? (inspected as any).defaultValue : undefined
      const baseline = baselineDefaults[key]
      const compareTo = defaultValue !== undefined ? defaultValue : baseline
      if (compareTo !== undefined && deepEqual(settings[key], compareTo)) {
        delete settings[key]
      }
    }

    // Log suppressed in library code to satisfy lints

    // Write to project.translation.json with proper formatting（异步写入，避免阻塞）
    const jsonContent = JSON.stringify(settings, null, 2);
    await fsp.writeFile(configFilePath, jsonContent, "utf-8");

    const settingsCount = Object.keys(settings).length;
    vscode.window.showInformationMessage(
      `Successfully exported ${settingsCount} settings to project.translation.json`
    );

    // Optionally open the file in the editor
    const uri = vscode.Uri.file(configFilePath);
    await vscode.window.showTextDocument(uri);
  } catch (error) {
    console.error("Error exporting settings:", error);
    vscode.window.showErrorMessage(
      `Failed to export settings: ${(error as Error).message}`
    );
  }
}

export async function getConfiguration(): Promise<Config> {
  const now = Date.now();

  const workspaceFolders = vscode.workspace.workspaceFolders;
  const workspaceRoot =
    workspaceFolders && workspaceFolders.length > 0
      ? workspaceFolders[0].uri.fsPath
      : null;

  // Fast path: short TTL cache hit
  if (
    cachedConfig &&
    cachedConfig.workspaceRoot === workspaceRoot &&
    now - cachedConfig.loadedAt < configCacheTtlMs
  ) {
    return cachedConfig.config;
  }

  // Resolve config file metadata (used for cache metadata and file reads)
  let configFileMtimeMs: number | null = null;
  let configFilePath: string | null = null;
  if (workspaceRoot) {
    configFilePath = path.join(workspaceRoot, "project.translation.json");
    try {
      const stat = await fsp.stat(configFilePath);
      if (stat.isFile()) {
        configFileMtimeMs = stat.mtimeMs;
      }
    } catch {
      configFileMtimeMs = null;
    }
  }

  // Always start from VS Code settings (effective config), then allow project.translation.json to override.
  // This avoids surprising "settings ignored" behavior when the config file exists but doesn't specify all fields.
  const vscodeConfig = vscode.workspace.getConfiguration("projectTranslator");
  const vscodeConfigData: any = {
    currentVendor: vscodeConfig.get("currentVendor"),
    vendors: vscodeConfig.get("vendors"),
    specifiedFiles: vscodeConfig.get("specifiedFiles"),
    specifiedFolders: vscodeConfig.get("specifiedFolders"),
    translationIntervalDays: vscodeConfig.get("translationIntervalDays"),
    copyOnly: vscodeConfig.get("copyOnly"),
    ignore: vscodeConfig.get("ignore"),
    customPrompts: vscodeConfig.get("customPrompts"),
    segmentationMarkers: vscodeConfig.get("segmentationMarkers"),
    diffApply: vscodeConfig.get("diffApply"),

    debug: vscodeConfig.get("debug"),
    logFile: vscodeConfig.get("logFile"),
    skipFrontMatter: vscodeConfig.get("skipFrontMatterMarkers"),
  };

  let fileConfigData: any = {};

  // Try to read from project.translation.json first（优先使用项目级配置文件）
  if (workspaceRoot && configFilePath) {

    try {
      const stat = await fsp.stat(configFilePath);
      if (stat.isFile()) {
        try {
          const fileContent = await fsp.readFile(configFilePath, "utf-8");
          fileConfigData = JSON.parse(fileContent);
        } catch (error) {
          vscode.window.showErrorMessage(
            `Failed to parse project.translation.json: ${
              (error as Error).message
            }`
          );
          // Fall back to VSCode settings
          fileConfigData = {};
        }
      }
    } catch {
      // 配置文件不存在时静默忽略，继续走 VSCode 配置
    }
  }

  const configData: any = { ...vscodeConfigData, ...fileConfigData };

  // Extract and normalize configuration data
  const copyOnly = configData.copyOnly;
  const ignore = configData.ignore;
  const currentVendorName = configData.currentVendor || "grok";
  const vendorsRaw = (configData.vendors || []) as VendorConfig[];
  const vendors = vendorsRaw.map((v) => {
    const merged: VendorConfig = { ...DEFAULT_VENDOR_CONFIG, ...v }
    if (!merged.apiKeyEnvVarName || `${merged.apiKeyEnvVarName}`.trim().length === 0) {
      merged.apiKeyEnvVarName = normalizeEnvVarNameFromVendorName(merged.name)
    }
    // Keep apiKey if provided (priority: apiKey > apiKeyEnvVarName)
    return merged
  });
  // Normalize Windows-style separators in configured paths (e.g. "i18n\\zh-cn\\skills")
  const normalizeConfigPath = (p: unknown): unknown =>
    typeof p === "string" ? p.replace(/\\/g, "/") : p;

  const specifiedFiles = Array.isArray(configData.specifiedFiles)
    ? configData.specifiedFiles.map((group: any) => ({
        ...group,
        sourceFile: group?.sourceFile
          ? {
              ...group.sourceFile,
              path: normalizeConfigPath(group.sourceFile.path),
            }
          : group?.sourceFile,
        targetFiles: Array.isArray(group?.targetFiles)
          ? group.targetFiles.map((t: any) =>
              t
                ? {
                    ...t,
                    path: normalizeConfigPath(t.path),
                  }
                : t
            )
          : group?.targetFiles,
      }))
    : configData.specifiedFiles;

  const specifiedFolders = Array.isArray(configData.specifiedFolders)
    ? configData.specifiedFolders.map((group: any) => ({
        ...group,
        sourceFolder: group?.sourceFolder
          ? {
              ...group.sourceFolder,
              path: normalizeConfigPath(group.sourceFolder.path),
            }
          : group?.sourceFolder,
        targetFolders: Array.isArray(group?.targetFolders)
          ? group.targetFolders.map((t: any) =>
              t
                ? {
                    ...t,
                    path: normalizeConfigPath(t.path),
                  }
                : t
            )
          : group?.targetFolders,
      }))
    : configData.specifiedFolders;
  const translationIntervalDays = configData.translationIntervalDays || 1;
  const segmentationMarkers = configData.segmentationMarkers;
  const debug = configData.debug || false;
  const diffApplyRaw = configData.diffApply as DiffApplyConfig | undefined;

  // Get logFile configuration with default values
  const logFile = configData.logFile || {
    enabled: false,
    maxSizeKB: 10240, // 10MB
    maxFiles: 5,
  };

  // Get skipFrontMatter configuration with default values
  const skipFrontMatter = configData.skipFrontMatter || {
    enabled: false,
    markers: [
      {
        key: "draft",
        value: "true"
      }
    ]
  };

  // Diff-apply default configuration
  const diffApply: DiffApplyConfig = {
    enabled: diffApplyRaw?.enabled ?? false,
    validationLevel: diffApplyRaw?.validationLevel ?? 'normal',
    autoBackup: diffApplyRaw?.autoBackup ?? true,
    maxOperationsPerFile: diffApplyRaw?.maxOperationsPerFile ?? 100
  };

  // Get custom prompts from config (user-defined prompts to append to default system prompt)
  const customPrompts = configData.customPrompts;

  const finalConfig: Config = {
    currentVendorName,
    currentVendor:
      vendors.find((v: any) => v.name === currentVendorName) ||
      DEFAULT_VENDOR_CONFIG,
    vendors,
    specifiedFiles: specifiedFiles || [],
    specifiedFolders: specifiedFolders || [],
    translationIntervalDays,
    segmentationMarkers: segmentationMarkers || {},
    debug,
    diffApply,

    logFile,
    skipFrontMatter,
    copyOnly: {
      paths: Array.isArray(copyOnly?.paths) ? copyOnly.paths : [],
      extensions: Array.isArray(copyOnly?.extensions)
        ? copyOnly.extensions
        : [],
    },
    ignore: {
      paths: Array.isArray(ignore?.paths) ? ignore.paths : [],
      extensions: Array.isArray(ignore?.extensions)
        ? ignore.extensions
        : [],
    },
    customPrompts: Array.isArray(customPrompts) ? customPrompts : [],
  };

  cachedConfig = {
    workspaceRoot,
    fileMtimeMs: configFileMtimeMs,
    loadedAt: now,
    config: finalConfig,
  };

  return finalConfig;
}
