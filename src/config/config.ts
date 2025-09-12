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

// Default vendor configuration
export const DEFAULT_VENDOR_CONFIG: VendorConfig = {
  name: "deepseek",
  apiEndpoint: "https://api.deepseek.com/v1",
  apiKeyEnvVarName: "DEEPSEEK_API_KEY",
  model: "deepseek-chat",
  rpm: 20,
  maxTokensPerSegment: 3000,
  timeout: 30,
  temperature: 0.7,
  top_p: 0.95,
  streamMode: true
};

// System prompts are now imported from prompt.js

// Using Record<string, string> instead of any
// i18n map
let translations: Record<string, string> = {};

export function loadTranslations(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("projectTranslator");
  const language = config.get<string>("language", "en");
  const translationsPath = path.join(
    context.extensionPath,
    "i18n",
    `${language}.json`
  );
  if (fs.existsSync(translationsPath)) {
    translations = JSON.parse(fs.readFileSync(translationsPath, "utf-8"));
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
  systemPrompts?: string[]; // System prompts for translation
  userPrompts?: string[]; // User prompts for translation
  segmentationMarkers?: Record<string, string[]>; // Segmentation markers configured by file type

  debug?: boolean; // Enable debug mode to log API requests and responses
  logFile?: LogFileConfig; // Configuration for debug log file output
  skipFrontMatter?: SkipFrontMatterConfig; // Configuration for skipping files based on front matter markers
  diffApply?: DiffApplyConfig; // Differential translation apply mode
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
      "vendors",
      "destFolders",
      "enableMetrics",
      "debug",
      "logFile",
      "specifiedFiles",
      "specifiedFolders",
      "translationIntervalDays",
      "copyOnly",
      "ignore",
      "systemPrompts",
      "userPrompts",
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

    // Log suppressed in library code to satisfy lints

    // Write to project.translation.json with proper formatting
    const jsonContent = JSON.stringify(settings, null, 2);
    fs.writeFileSync(configFilePath, jsonContent, "utf-8");

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

export function getConfiguration(): Config {
  let configData: any = {};

  // Try to read from project.translation.json first
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (workspaceFolders && workspaceFolders.length > 0) {
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const configFilePath = path.join(workspaceRoot, "project.translation.json");

    if (fs.existsSync(configFilePath)) {
      try {
        const fileContent = fs.readFileSync(configFilePath, "utf-8");
        configData = JSON.parse(fileContent);
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to parse project.translation.json: ${
            (error as Error).message
          }`
        );
        // Fall back to VSCode settings
        configData = {};
      }
    }
  }

  // If no valid config from file, use VSCode settings as fallback
  if (Object.keys(configData).length === 0) {
    const config = vscode.workspace.getConfiguration("projectTranslator");
    configData = {
      currentVendor: config.get("currentVendor"),
      vendors: config.get("vendors"),
      specifiedFiles: config.get("specifiedFiles"),
      specifiedFolders: config.get("specifiedFolders"),
      translationIntervalDays: config.get("translationIntervalDays"),
      copyOnly: config.get("copyOnly"),
      ignore: config.get("ignore"),
      systemPrompts: config.get("systemPrompts"),
      userPrompts: config.get("userPrompts"),
      segmentationMarkers: config.get("segmentationMarkers"),
      diffApply: config.get("diffApply"),

      debug: config.get("debug"),
      logFile: config.get("logFile"),
    };
  } // Extract and normalize configuration data
  const copyOnly = configData.copyOnly;
  const ignore = configData.ignore;
  const currentVendorName = configData.currentVendor || "grok";
  const vendors = configData.vendors || [];
  const specifiedFiles = configData.specifiedFiles;
  const specifiedFolders = configData.specifiedFolders;
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

  // Get prompts, fallback to defaults if not present
  let systemPrompts = configData.systemPrompts;
  let userPrompts = configData.userPrompts;

  // If no system prompts are provided, use the default system prompt parts
  if (!systemPrompts || systemPrompts.length === 0) {
    // Combine both parts as default - first part + second part for initial request
    systemPrompts = [DEFAULT_SYSTEM_PROMPT_PART1, DEFAULT_SYSTEM_PROMPT_PART2];
  }

  return {
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
    systemPrompts: Array.isArray(systemPrompts) ? systemPrompts : [DEFAULT_SYSTEM_PROMPT_PART1, DEFAULT_SYSTEM_PROMPT_PART2],
    userPrompts: Array.isArray(userPrompts) ? userPrompts : [],
  };
}
