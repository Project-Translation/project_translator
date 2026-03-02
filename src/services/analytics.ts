import axios from "axios";
import * as path from "path";
import { logMessage } from "../runtime/logging";
import { getConfiguration } from "../config/config";
import { getRuntimeContext } from "../runtime/context";
import { RuntimeContext } from "../runtime/types";

interface DataObject {
  [key: string]: unknown;
}

export class AnalyticsService {
  private isDebugMode: boolean;
  private machineId: string | undefined;
  private runtimeContext: RuntimeContext;

  constructor(runtimeContext?: RuntimeContext, machineId?: string) {
    this.runtimeContext = runtimeContext || getRuntimeContext();
    this.machineId = machineId;
    this.isDebugMode = this.detectDebugMode();
    logMessage(`🔍 Debug mode: ${this.isDebugMode}`);
  }

  private detectDebugMode(): boolean {
    const envDebugMode =
      globalThis.process?.env?.VSCODE_DEBUG_MODE === "true" ||
      !!globalThis.process?.env?.VSCODE_DEBUG_SESSION;

    const nodeDebugArg =
      globalThis.process?.execArgv?.some(
        (arg) => arg.startsWith("--inspect") || arg.startsWith("--debug")
      ) || false;

    const debugPort =
      typeof globalThis.process?.env?.DEBUG_PORT !== "undefined";

    return envDebugMode || nodeDebugArg || debugPort;
  }

  private getProjectName(): string {
    const workspaceRoot = this.runtimeContext.workspaceRoot;
    if (!workspaceRoot) {
      return "unknown_project";
    }
    return path.basename(workspaceRoot);
  }

  public async sendSettingsData(settings: DataObject): Promise<void> {
    const config = await getConfiguration();
    const metricsEnabled = config.enableMetrics ?? true;

    if (!metricsEnabled) {
      if (this.isDebugMode) {
        logMessage("📊 Metrics collection is disabled");
      }
      return;
    }

    try {
      const settingsCopy = JSON.parse(JSON.stringify(settings));

      if (settingsCopy.vendors && Array.isArray(settingsCopy.vendors)) {
        settingsCopy.vendors = settingsCopy.vendors.map(
          (vendor: DataObject) => ({
            ...vendor,
            apiKey: "",
          })
        );
      }

      this.isDebugMode = this.detectDebugMode();

      const projectName = this.getProjectName();
      const url = this.isDebugMode
        ? "http://100.64.0.5:8080/api/project-translator/data"
        : "https://collect.jqknono.com/api/project-translator/data";

      const payload = {
        machine_id: this.machineId,
        project_name: projectName,
        config: Buffer.from(JSON.stringify(settingsCopy)).toString("base64"),
      };

      if (this.isDebugMode) {
        logMessage(`📤 Sending data to: ${url}`);
        logMessage(`📦 Data payload: ${JSON.stringify(payload, null, 2)}`);
      }

      await axios.post(url, payload);

      if (this.isDebugMode) {
        logMessage(
          `📤 Usage data sent successfully to ${
            this.isDebugMode ? "debug" : "production"
          } endpoint`
        );
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      if (this.isDebugMode) {
        logMessage(`⚠️ Failed to send usage data: ${errorMessage}`);
      }
    }
  }

  static async getMachineId(runtimeContext?: RuntimeContext): Promise<string> {
    const context = runtimeContext || getRuntimeContext();
    return context.getMachineId();
  }
}
