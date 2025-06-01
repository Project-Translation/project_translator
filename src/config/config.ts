import * as vscode from "vscode";
import {
  VendorConfig,
  SpecifiedFile,
  SpecifiedFolder,
  CopyOnlyConfig,
  IgnoreConfig,
} from "../types/types";
import * as path from "path";
import * as fs from "fs";
import * as process from "process";

// Using Record<string, string> instead of any
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
      console.error(`Missing required field: ${field}`);
      return false;
    }
  }

  // Validate currentVendor is properly set
  if (!config.currentVendor || !config.currentVendor.name) {
    console.error("currentVendor is not properly configured");
    return false;
  }

  // Validate that currentVendor exists in vendors array
  const vendorExists = config.vendors.some(
    (v) => v.name === config.currentVendorName
  );
  if (!vendorExists) {
    console.error(
      `Current vendor "${config.currentVendorName}" not found in vendors array`
    );
    return false;
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
    const config = vscode.workspace.getConfiguration("projectTranslator");
    // Define all projectTranslator setting keys that should be exported
    // Note: enableMetrics is intentionally excluded as it should remain hidden
    const settingKeys = [
      "currentVendor",
      "vendors",
      "specifiedFiles",
      "specifiedFolders",
      "translationIntervalDays",
      "copyOnly",
      "ignore",
      "systemPrompts",
      "userPrompts",
      "segmentationMarkers",
    ];

    // Extract settings and remove the projectTranslator prefix
    const settings: any = {};
    for (const key of settingKeys) {
      const value = config.get(key);
      if (value !== undefined) {
        settings[key] = value;
      }
    }

    // Log what settings were found
    console.log("Exporting projectTranslator settings:", Object.keys(settings));

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

  // Get prompts, fallback to defaults if not present
  let systemPrompts = configData.systemPrompts;
  let userPrompts = configData.userPrompts;

  // If prompts are not available from the current source, get them from VSCode settings or defaults
  if (!systemPrompts || !userPrompts) {
    const prompts = getTranslationPrompts();
    systemPrompts = systemPrompts || prompts.systemPrompts;
    userPrompts = userPrompts || prompts.userPrompts;
  }

  // Find current vendor configuration
  const currentVendor = vendors.find(
    (vendor: VendorConfig) => vendor.name === currentVendorName
  );
  if (!currentVendor) {
    throw new Error(
      translations["error.invalidApiSettings"] ||
        "Please provide valid API settings in the vendor configuration"
    );
  }

  // If API key is not set directly in the configuration, check environment variable
  if (!currentVendor.apiKey && currentVendor.apiKeyEnvVarName) {
    const envApiKey = process.env[currentVendor.apiKeyEnvVarName];
    if (envApiKey) {
      currentVendor.apiKey = envApiKey;
    }
  }
  // Validate that we have an API key either from settings or environment variable
  if (!currentVendor.apiKey) {
    throw new Error(
      translations["error.invalidApiSettings"] ||
        `Please provide valid API key in the vendor configuration or set the environment variable ${
          currentVendor.apiKeyEnvVarName || "specified in apiKeyEnvVarName"
        }`
    );
  }
  // Set default temperature to 0 if not specified or is null/undefined
  if (currentVendor.temperature == null) {
    currentVendor.temperature = 0;
  }

  // Set default streamMode to true if not specified or is null/undefined
  if (currentVendor.streamMode == null) {
    currentVendor.streamMode = true;
  }

  // Return consistent Config structure regardless of source
  return {
    copyOnly,
    ignore,
    currentVendorName,
    vendors,
    translationIntervalDays,
    specifiedFiles,
    specifiedFolders,
    currentVendor,
    systemPrompts,
    userPrompts,
    segmentationMarkers,
  };
}

/**
 * Resolves prompt strings, loading from files if they are file paths
 * @param prompts Array of strings that can be either prompt content or file paths
 * @returns Array of resolved prompt content
 */
function resolvePrompts(prompts: string[]): string[] {
  const resolvedPrompts: string[] = [];

  for (const prompt of prompts) {
    // Check if the prompt is a file path (contains path separators and has file extension)
    if (prompt.includes('/') || prompt.includes('\\') || path.extname(prompt)) {
      try {
        let filePath = prompt;
        
        // If it's a relative path, resolve it relative to workspace root
        if (!path.isAbsolute(filePath)) {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            filePath = path.resolve(workspaceRoot, filePath);
          }
        }

        // Check if file exists and read its content
        if (fs.existsSync(filePath)) {
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          resolvedPrompts.push(fileContent.trim());
        } else {
          // If file doesn't exist, treat the string as the prompt content itself
          resolvedPrompts.push(prompt);
        }
      } catch (error) {
        // If any error occurs reading the file, treat the string as the prompt content
        resolvedPrompts.push(prompt);
      }
    } else {
      // If it doesn't look like a file path, treat it as prompt content
      resolvedPrompts.push(prompt);
    }
  }

  return resolvedPrompts;
}

export function getTranslationPrompts() {
  const projectConfig = vscode.workspace.getConfiguration("projectTranslator");
  const rawSystemPrompts = projectConfig.get<string[]>("systemPrompts") || [];
  const rawUserPrompts = projectConfig.get<string[]>("userPrompts") || [];

  // If no system prompts are configured, use the default system prompt file
  let systemPromptsToResolve = rawSystemPrompts;
  if (rawSystemPrompts.length === 0) {
    // Use the default system prompt file
    systemPromptsToResolve = ["prompts/default-system-prompt.md"];
  }

  const systemPrompts = resolvePrompts(systemPromptsToResolve);
  const userPrompts = resolvePrompts(rawUserPrompts);

  return {
    systemPrompts,
    userPrompts,
  };
}
