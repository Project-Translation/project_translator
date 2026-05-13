import type { Config } from "../config/config.types";

export type LogLevel = "info" | "warn" | "error" | "debug";

export interface RuntimeLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

export interface RuntimeNotifier {
  showInfo(message: string): void | Promise<void>;
  showWarn(message: string): void | Promise<void>;
  showError(message: string): void | Promise<void>;
}

export interface CancellationTokenLike {
  isCancellationRequested: boolean;
}

export interface CancellationControllerLike {
  readonly token: CancellationTokenLike;
  cancel(): void;
  dispose(): void;
}

export interface RuntimeConfigProvider {
  getConfiguration(): Promise<Config>;
  clearCache?(): void;
  exportSettingsToConfigFile?(): Promise<void>;
}

export interface RuntimeContext {
  workspaceRoot?: string;
  logger: RuntimeLogger;
  notifier: RuntimeNotifier;
  configProvider: RuntimeConfigProvider;
  createCancellationController(): CancellationControllerLike;
  createCancellationError(message?: string): Error;
  isCancellationError(error: unknown): boolean;
  getMachineId(): Promise<string>;
}
