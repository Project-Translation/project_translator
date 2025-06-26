import * as vscode from "vscode";
import {
  VendorConfig,
  SpecifiedFile,
  SpecifiedFolder,
  CopyOnlyConfig,
  IgnoreConfig,
  DiffApplyConfig,
} from "../types/types";
import * as path from "path";
import * as fs from "fs";
import * as process from "process";

// Default system prompt content embedded in code
const DEFAULT_SYSTEM_PROMPT = `你是一个专业翻译 AI，严格遵守以下准则：

1. **格式绝对优先**：保持原始内容的完整格式(JSON/XML/Markdown 等)，所有格式标记(包括\`\`\`代码块符号)必须原样保留，数量、位置和形式不得更改
2. **精准符号控制**：特别关注三重反引号(\`\`\`)的使用：
   - 禁止添加或删除任何\`\`\`符号
   - 代码块内的文本仅当明确语言变化时才翻译
   - Markdown 中的代码块标识符(如\`\`\`python)绝不翻译
3. **核心流程**：
   - 首先判断是否需要翻译
   - 需要翻译 → 保留格式进行翻译
   - 不需要翻译 → 返回固定 UUID：727d2eb8-8683-42bd-a1d0-f604fcd82163

## 翻译判断标准(按优先级)

| 判断依据                       | 处理方式             |
| ------------------------------ | -------------------- |
| **纯代码/数据**(无自然语言)    | 返回 UUID            |
| **Markdown 手稿**(draft: true) | 返回 UUID            |
| **混合语言内容**               | 翻译全部自然语言文本 |

## 响应协议

**不需要翻译**：

- 严格返回纯文本：\`727d2eb8-8683-42bd-a1d0-f604fcd82163\`
- 无任何额外字符/格式

**需要翻译**：

- 各种纯文本文档

## 严格禁令

1. 禁止解释判断逻辑
2. 禁止添加任何前缀/后缀
3. 禁止将固定 UUID 包裹在任何格式中
4. 禁止改动原始空白字符(制表符/缩进/空行)
5. 必须 1:1 匹配\`\`\`数量：
   - 输入含 3 个\` → 输出必须3个\`
   - 输入无\`\`\` → 输出禁止添加

## 执行样例

输入示例(XML)：

\`\`\`xml
<article>
  <title>Hello World</title>
  <content>This needs translation</content>
</article>
\`\`\`

输出(翻译后)：

\`\`\`xml
<article>
  <title>你好世界</title>
  <content>这需要翻译</content>
</article>
\`\`\`

输入示例(Markdown)：

\`\`\`markdown
---
title: Sample Document
draft: true
---

- [ ] Sample Task
\`\`\`

输出: 727d2eb8-8683-42bd-a1d0-f604fcd82163`;

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
  diffApply?: DiffApplyConfig; // Configuration for diff apply functionality
  debug?: boolean; // Enable debug mode to log API requests and responses
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
    const config = vscode.workspace.getConfiguration("projectTranslator"); // Define all projectTranslator setting keys that should be exported
    // Note: enableMetrics is intentionally excluded as it should remain hidden
    const settingKeys = [
      "currentVendor",
      "vendors",
      "debug",
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
      diffApply: config.get("diffApply"),
      debug: config.get("debug"),
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

  // Get diffApply configuration with default values
  const diffApply = configData.diffApply || {
    enabled: false,
    strategy: "auto" as const,
    granularity: "line" as const,
    contextLines: 3,
    fallbackToFullTranslation: true,
  };

  // Get prompts, fallback to defaults if not present
  let systemPrompts = configData.systemPrompts;
  let userPrompts = configData.userPrompts;

  // If prompts are not available from the current source, get them from VSCode settings or defaults
  if (!systemPrompts || !userPrompts || (Array.isArray(systemPrompts) && systemPrompts.length === 0) || (Array.isArray(userPrompts) && userPrompts.length === 0)) {
    const prompts = getTranslationPrompts();
    systemPrompts = (systemPrompts && Array.isArray(systemPrompts) && systemPrompts.length > 0) ? systemPrompts : prompts.systemPrompts;
    userPrompts = (userPrompts && Array.isArray(userPrompts) && userPrompts.length > 0) ? userPrompts : prompts.userPrompts;
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
    diffApply,
    debug,
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
    if (prompt.includes("/") || prompt.includes("\\") || path.extname(prompt)) {
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
          const fileContent = fs.readFileSync(filePath, "utf-8");
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

  // If no system prompts are configured, use the embedded default system prompt
  let systemPrompts: string[];
  if (rawSystemPrompts.length === 0) {
    // Use the embedded default system prompt
    systemPrompts = [DEFAULT_SYSTEM_PROMPT];
  } else {
    // Resolve user-configured system prompts
    systemPrompts = resolvePrompts(rawSystemPrompts);
  }

  const userPrompts = resolvePrompts(rawUserPrompts);

  return {
    systemPrompts,
    userPrompts,
  };
}
