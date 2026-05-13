import * as fs from "fs";
import * as path from "path";
import { parse } from "jsonc-parser";
import { Config } from "./config.types";
import { normalizeConfigData } from "./config.normalize";

const fsp = fs.promises;
const configCacheTtlMs = 2000;

let cachedConfig:
  | {
      workspaceRoot: string | null;
      configPath: string | null;
      loadedAt: number;
      config: Config;
    }
  | null = null;

export function clearConfigReaderCache(): void {
  cachedConfig = null;
}

export function resolveConfigPath(workspaceRoot: string, configPath?: string): string {
  if (configPath && path.isAbsolute(configPath)) {
    return configPath;
  }
  if (configPath) {
    return path.resolve(workspaceRoot, configPath);
  }
  return path.join(workspaceRoot, "project.translation.json");
}

export async function readRawConfigFile(configPath: string): Promise<Record<string, unknown>> {
  let content = "";
  try {
    content = await fsp.readFile(configPath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw error;
  }

  const parsed = parse(content);
  if (!parsed || typeof parsed !== "object") {
    return {};
  }
  return parsed as Record<string, unknown>;
}

export async function getConfigurationFromProjectFile(
  workspaceRoot: string,
  configPath?: string
): Promise<Config> {
  const now = Date.now();
  const resolvedConfigPath = resolveConfigPath(workspaceRoot, configPath);

  if (
    cachedConfig &&
    cachedConfig.workspaceRoot === workspaceRoot &&
    cachedConfig.configPath === resolvedConfigPath &&
    now - cachedConfig.loadedAt < configCacheTtlMs
  ) {
    return cachedConfig.config;
  }

  const raw = await readRawConfigFile(resolvedConfigPath);
  const config = normalizeConfigData(raw);

  cachedConfig = {
    workspaceRoot,
    configPath: resolvedConfigPath,
    loadedAt: now,
    config,
  };

  return config;
}

export async function getConfigurationFromRawData(
  rawData: Record<string, unknown>
): Promise<Config> {
  return normalizeConfigData(rawData);
}
