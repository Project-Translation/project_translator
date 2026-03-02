import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { RuntimeConfigProvider } from "../runtime/types";
import { Config, DEFAULT_VENDOR_CONFIG, VendorConfig } from "./config.types";
import {
  clearConfigReaderCache,
  readRawConfigFile,
  resolveConfigPath,
} from "./config.reader";
import { normalizeConfigData, normalizeEnvVarNameFromVendorName } from "./config.normalize";

const fsp = fs.promises;

const EXPORT_SETTING_KEYS = [
  "currentVendor",
  "vendors",
  "destFolders",
  "debug",
  "logFile",
  "systemPromptLanguage",
  "specifiedFiles",
  "specifiedFolders",
  "translationIntervalDays",
  "copyOnly",
  "ignore",
  "customPrompts",
  "segmentationMarkers",
  "diffApply",
  "skipFrontMatterMarkers",
];

function pickWorkspaceRoot(): string | null {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  return workspaceFolders && workspaceFolders.length > 0
    ? workspaceFolders[0].uri.fsPath
    : null;
}

function getVscodeConfigRaw(): Record<string, unknown> {
  const vscodeConfig = vscode.workspace.getConfiguration("projectTranslator");
  const raw: Record<string, unknown> = {};
  for (const key of EXPORT_SETTING_KEYS) {
    raw[key] = vscodeConfig.get(key);
  }
  raw.enableMetrics = vscodeConfig.get("enableMetrics", true);
  return raw;
}

async function buildConfigFromVscodeAndFile(): Promise<Config> {
  const workspaceRoot = pickWorkspaceRoot();
  const vscodeRaw = getVscodeConfigRaw();

  if (!workspaceRoot) {
    return normalizeConfigData(vscodeRaw);
  }

  const configPath = resolveConfigPath(workspaceRoot);
  let fileRaw: Record<string, unknown> = {};
  try {
    fileRaw = await readRawConfigFile(configPath);
  } catch (error) {
    vscode.window.showErrorMessage(
      `Failed to parse project.translation.json: ${(error as Error).message}`
    );
  }

  const mergedRaw = { ...vscodeRaw, ...fileRaw };
  return normalizeConfigData(mergedRaw);
}

export async function exportSettingsToConfigFileVscode(): Promise<void> {
  const workspaceRoot = pickWorkspaceRoot();
  if (!workspaceRoot) {
    vscode.window.showErrorMessage("No workspace folder is open");
    return;
  }

  const vscodeConfig = vscode.workspace.getConfiguration("projectTranslator");
  const settings: Record<string, unknown> = {};

  for (const key of EXPORT_SETTING_KEYS) {
    const value = vscodeConfig.get(key);
    if (value !== undefined) {
      settings[key] = value;
    }
  }

  const currentVendorName =
    (settings.currentVendor as string | undefined) ||
    vscodeConfig.get<string>("currentVendor") ||
    DEFAULT_VENDOR_CONFIG.name;

  const vendors = ((settings.vendors as VendorConfig[] | undefined) ||
    (vscodeConfig.get("vendors") as VendorConfig[] | undefined) ||
    []) as VendorConfig[];

  const selectedVendor =
    vendors.find((v) => v.name === currentVendorName) ||
    vendors.find((v) => v.name === DEFAULT_VENDOR_CONFIG.name) ||
    vendors[0];

  if (selectedVendor) {
    const vendorToExport: VendorConfig = { ...selectedVendor };
    const mutableVendor = vendorToExport as unknown as Record<string, unknown>;
    delete mutableVendor.apiKey;

    if (
      !vendorToExport.apiKeyEnvVarName ||
      `${vendorToExport.apiKeyEnvVarName}`.trim().length === 0
    ) {
      vendorToExport.apiKeyEnvVarName = normalizeEnvVarNameFromVendorName(
        vendorToExport.name
      );
    }

    settings.currentVendor = vendorToExport.name;
    settings.vendors = [vendorToExport];
  }

  const configPath = path.join(workspaceRoot, "project.translation.json");
  await fsp.writeFile(configPath, `${JSON.stringify(settings, null, 2)}\n`, "utf-8");

  vscode.window.showInformationMessage(
    `Successfully exported ${Object.keys(settings).length} settings to project.translation.json`
  );
  await vscode.window.showTextDocument(vscode.Uri.file(configPath));
}

export function createVscodeConfigProvider(): RuntimeConfigProvider {
  return {
    async getConfiguration() {
      return buildConfigFromVscodeAndFile();
    },
    clearCache() {
      clearConfigReaderCache();
    },
    async exportSettingsToConfigFile() {
      await exportSettingsToConfigFileVscode();
    },
  };
}
