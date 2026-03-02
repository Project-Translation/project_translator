import {
  Config,
  DEFAULT_VENDOR_CONFIG,
  DiffApplyConfig,
  VendorConfig,
} from "./config.types";

function pickMixedKey<T = unknown>(raw: Record<string, unknown>, key: string): T | undefined {
  const flatValue = raw[key];
  if (flatValue !== undefined) {
    return flatValue as T;
  }
  const prefixed = raw[`projectTranslator.${key}`];
  return prefixed as T | undefined;
}

export function normalizeEnvVarNameFromVendorName(name: string): string {
  const baseCandidate = name && name.trim().length > 0 ? name : "VENDOR";
  const base = baseCandidate.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase();
  return `${base}_API_KEY`;
}

function normalizeConfigPath(input: unknown): unknown {
  return typeof input === "string" ? input.replace(/\\/g, "/") : input;
}

export function canonicalizeRawConfig(rawInput: Record<string, unknown>): Record<string, unknown> {
  const raw = { ...rawInput };
  const keys = new Set<string>();
  for (const key of Object.keys(raw)) {
    if (key.startsWith("projectTranslator.")) {
      keys.add(key.slice("projectTranslator.".length));
    } else {
      keys.add(key);
    }
  }

  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = pickMixedKey(raw, key);
    if (value !== undefined) {
      out[key] = value;
    }
  }

  return out;
}

export function normalizeConfigData(rawInput: Record<string, unknown>): Config {
  const raw = canonicalizeRawConfig(rawInput);

  const copyOnly = (raw.copyOnly as Record<string, unknown> | undefined) || {};
  const ignore = (raw.ignore as Record<string, unknown> | undefined) || {};

  const currentVendorName =
    (typeof raw.currentVendor === "string" && raw.currentVendor) ||
    DEFAULT_VENDOR_CONFIG.name;

  const vendorsRaw = (Array.isArray(raw.vendors) ? raw.vendors : []) as VendorConfig[];
  const vendors = vendorsRaw.map((v) => {
    const merged: VendorConfig = { ...DEFAULT_VENDOR_CONFIG, ...v };
    const explicitEnvVar =
      typeof v.apiKeyEnvVarName === "string" &&
      v.apiKeyEnvVarName.trim().length > 0;
    if (!explicitEnvVar) {
      merged.apiKeyEnvVarName = normalizeEnvVarNameFromVendorName(merged.name);
    }
    return merged;
  });

  const specifiedFiles = Array.isArray(raw.specifiedFiles)
    ? raw.specifiedFiles.map((group: any) => ({
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
    : [];

  const specifiedFolders = Array.isArray(raw.specifiedFolders)
    ? raw.specifiedFolders.map((group: any) => ({
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
    : [];

  const diffApplyRaw = raw.diffApply as DiffApplyConfig | undefined;
  const diffApply: DiffApplyConfig = {
    enabled: diffApplyRaw?.enabled ?? false,
    validationLevel: diffApplyRaw?.validationLevel ?? "normal",
    autoBackup: diffApplyRaw?.autoBackup ?? true,
    maxOperationsPerFile: diffApplyRaw?.maxOperationsPerFile ?? 100,
  };

  const systemPromptLanguage =
    typeof raw.systemPromptLanguage === "string" && raw.systemPromptLanguage.trim().length > 0
      ? raw.systemPromptLanguage.trim()
      : "en";

  const finalConfig: Config = {
    currentVendorName,
    currentVendor:
      vendors.find((v) => v.name === currentVendorName) || DEFAULT_VENDOR_CONFIG,
    vendors,
    specifiedFiles,
    specifiedFolders,
    translationIntervalDays:
      typeof raw.translationIntervalDays === "number" ? raw.translationIntervalDays : 1,
    segmentationMarkers:
      (raw.segmentationMarkers as Record<string, string[]>) || {},
    systemPromptLanguage,
    debug: !!raw.debug,
    logFile: (raw.logFile as Config["logFile"]) || {
      enabled: false,
      maxSizeKB: 10240,
      maxFiles: 5,
    },
    skipFrontMatter:
      (raw.skipFrontMatterMarkers as Config["skipFrontMatter"]) ||
      (raw.skipFrontMatter as Config["skipFrontMatter"]) || {
        enabled: false,
        markers: [{ key: "draft", value: "true" }],
      },
    diffApply,
    copyOnly: {
      paths: Array.isArray(copyOnly.paths) ? (copyOnly.paths as string[]) : [],
      extensions: Array.isArray(copyOnly.extensions)
        ? (copyOnly.extensions as string[])
        : [],
    },
    ignore: {
      paths: Array.isArray(ignore.paths) ? (ignore.paths as string[]) : [],
      extensions: Array.isArray(ignore.extensions)
        ? (ignore.extensions as string[])
        : [],
    },
    customPrompts: Array.isArray(raw.customPrompts)
      ? (raw.customPrompts as string[])
      : [],
    enableMetrics:
      typeof raw.enableMetrics === "boolean" ? raw.enableMetrics : true,
  };

  return finalConfig;
}

export function validateConfigStructure(config: Config): boolean {
  const requiredFields: Array<keyof Config> = [
    "currentVendorName",
    "vendors",
    "translationIntervalDays",
    "currentVendor",
  ];

  for (const field of requiredFields) {
    if (!(field in config)) {
      throw new Error(`Missing required field: ${String(field)}`);
    }
  }

  if (!config.currentVendor || !config.currentVendor.name) {
    throw new Error("currentVendor is not properly configured");
  }

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
