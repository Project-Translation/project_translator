import { getRuntimeContext } from "../runtime/context";
import { Config, LogFileConfig, DEFAULT_VENDOR_CONFIG } from "./config.types";
import { validateConfigStructure } from "./config.normalize";

export type { Config, LogFileConfig };
export { DEFAULT_VENDOR_CONFIG, validateConfigStructure };

export function loadTranslations(): void {
  // no-op: 保留兼容旧调用
}

export function clearConfigurationCache(): void {
  getRuntimeContext().configProvider.clearCache?.();
}

export async function exportSettingsToConfigFile(): Promise<void> {
  const fn = getRuntimeContext().configProvider.exportSettingsToConfigFile;
  if (!fn) {
    throw new Error("Current runtime does not support exportSettingsToConfigFile");
  }
  await fn();
}

export async function getConfiguration(): Promise<Config> {
  return getRuntimeContext().configProvider.getConfiguration();
}
