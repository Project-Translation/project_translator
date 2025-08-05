import * as vscode from "vscode";
import {
  VendorConfig,
  SpecifiedFile,
  SpecifiedFolder,
  CopyOnlyConfig,
  IgnoreConfig,
  SkipFrontMatterConfig,
} from "../types/types";
import * as path from "path";
import * as fs from "fs";
import * as process from "process";

// Default vendor configuration
export const DEFAULT_VENDOR_CONFIG: VendorConfig = {
  name: "deepseek",
  apiEndpoint: "https://api.deepseek.com/v1",
  apiKeyEnvVarName: "DEEPSEEK_API_KEY",
  model: "deepseek-chat",
  rpm: 20,
  maxTokensPerSegment: 3000,
  timeout: 30,
  temperature: 0,
  top_p: 0.95,
  streamMode: true
};

// Default system prompt content embedded in code
// First part - general translation guidelines
const DEFAULT_SYSTEM_PROMPT_PART1 = `你是一个专业翻译 AI，严格遵守以下准则：

1. **格式绝对优先**：保持原始内容的完整格式(JSON/XML/Markdown 等)，所有格式标记(包括\`\`\`代码块符号)必须原样保留，数量、位置和形式不得更改
2. **精准符号控制**：特别关注三重反引号(\`\`\`)的使用：
   - 禁止添加或删除任何\`\`\`符号
   - 代码块内的文本仅当明确语言变化时才翻译
   - Markdown 中的代码块标识符(如\`\`\`python)绝不翻译


## 严格禁令

1. 禁止解释判断逻辑
2. 禁止添加任何前缀/后缀
3. 禁止将固定 UUID 包裹在任何格式中
4. 禁止改动原始空白字符(制表符/缩进/空行)
5. 严格匹配\`\`\`数量：
   - 如果输入含\`\`\` → 输出必须有相同数量的\`\`\`
   - 如果输入无\`\`\` → 输出禁止添加\`\`\`

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
`;

// Second part - translation judgment logic (used only for first segment)
const DEFAULT_SYSTEM_PROMPT_PART2 = `**需要判断是否需要翻译**：
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

输入示例(Markdown)：

\`\`\`
---
draft: true
---

This is a draft.
\`\`\`

输出: 727d2eb8-8683-42bd-a1d0-f604fcd82163
`;

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

  debug?: boolean; // Enable debug mode to log API requests and responses
  logFile?: LogFileConfig; // Configuration for debug log file output
  skipFrontMatter?: SkipFrontMatterConfig; // Configuration for skipping files based on front matter markers
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
