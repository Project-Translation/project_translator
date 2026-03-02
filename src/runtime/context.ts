import { randomUUID } from "crypto";
import { OperationCancelledError, isOperationCancelledError } from "./errors";
import type {
  CancellationControllerLike,
  CancellationTokenLike,
  RuntimeConfigProvider,
  RuntimeContext,
  RuntimeLogger,
  RuntimeNotifier,
} from "./types";

class BasicCancellationToken implements CancellationTokenLike {
  public isCancellationRequested = false;
}

class BasicCancellationController implements CancellationControllerLike {
  private readonly innerToken = new BasicCancellationToken();

  public get token(): CancellationTokenLike {
    return this.innerToken;
  }

  public cancel(): void {
    this.innerToken.isCancellationRequested = true;
  }

  public dispose(): void {
    this.innerToken.isCancellationRequested = true;
  }
}

const defaultLogger: RuntimeLogger = {
  info: (message: string) => console.log(message),
  warn: (message: string) => console.warn(message),
  error: (message: string) => console.error(message),
  debug: (message: string) => console.debug(message),
};

const defaultNotifier: RuntimeNotifier = {
  showInfo: (message: string) => console.log(message),
  showWarn: (message: string) => console.warn(message),
  showError: (message: string) => console.error(message),
};

const defaultConfigProvider: RuntimeConfigProvider = {
  async getConfiguration() {
    throw new Error("Runtime config provider is not initialized");
  },
};

let activeRuntimeContext: RuntimeContext = {
  workspaceRoot: process.cwd(),
  logger: defaultLogger,
  notifier: defaultNotifier,
  configProvider: defaultConfigProvider,
  createCancellationController: () => new BasicCancellationController(),
  createCancellationError: (message?: string) =>
    new OperationCancelledError(message),
  isCancellationError: (error: unknown) => isOperationCancelledError(error),
  getMachineId: async () => randomUUID(),
};

export function setRuntimeContext(context: RuntimeContext): void {
  activeRuntimeContext = context;
}

export function getRuntimeContext(): RuntimeContext {
  return activeRuntimeContext;
}
