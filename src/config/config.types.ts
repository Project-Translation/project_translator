import {
  VendorConfig,
  SpecifiedFile,
  SpecifiedFolder,
  CopyOnlyConfig,
  IgnoreConfig,
  SkipFrontMatterConfig,
  DiffApplyConfig,
} from "../types/types";

export { VendorConfig, SpecifiedFile, SpecifiedFolder, CopyOnlyConfig, IgnoreConfig, SkipFrontMatterConfig, DiffApplyConfig };

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
  streamMode: true,
};

export interface LogFileConfig {
  enabled: boolean;
  path?: string;
  maxSizeKB?: number;
  maxFiles?: number;
}

export interface Config {
  specifiedFiles?: SpecifiedFile[];
  specifiedFolders?: SpecifiedFolder[];
  copyOnly?: CopyOnlyConfig;
  ignore?: IgnoreConfig;
  currentVendorName: string;
  vendors: VendorConfig[];
  translationIntervalDays: number;
  currentVendor: VendorConfig;
  customPrompts?: string[];
  segmentationMarkers?: Record<string, string[]>;
  systemPromptLanguage: string;
  debug?: boolean;
  logFile?: LogFileConfig;
  skipFrontMatter?: SkipFrontMatterConfig;
  diffApply?: DiffApplyConfig;
  enableMetrics?: boolean;
}
