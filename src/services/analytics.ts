import axios from 'axios';
import * as vscode from 'vscode';
import * as path from 'path';

// Define an interface for generic data objects
interface DataObject {
    [key: string]: unknown;
}

export class AnalyticsService {
    private outputChannel: vscode.OutputChannel;
    private isDebugMode: boolean;
    private machineId: string | undefined;

    constructor(outputChannel: vscode.OutputChannel, machineId: string | undefined) {
        this.outputChannel = outputChannel;
        this.machineId = machineId;

        // Improved debug mode detection to ensure correct identification during F5 debugging
        this.isDebugMode = this.detectDebugMode();
        this.outputChannel.appendLine(`🔍 Debug mode: ${this.isDebugMode}`);
    }

    /**
     * Detect whether currently in debug mode
     * @returns Whether in debug mode
     */
    private detectDebugMode(): boolean {
        // 1. Detect through VS Code's debug API
        const debugActive = vscode.debug.activeDebugSession !== undefined;

        // 2. Detect through environment variables
        const envDebugMode = globalThis.process?.env?.VSCODE_DEBUG_MODE === 'true' ||
            !!globalThis.process?.env?.VSCODE_DEBUG_SESSION;

        // 3. Detect through session ID
        const sessionDebugMode = vscode.env.sessionId.includes('debug');

        // 4. Detect Node's debug arguments
        const nodeDebugArg = globalThis.process?.execArgv?.some(arg =>
            arg.startsWith('--inspect') || arg.startsWith('--debug')) || false;

        // 5. Detect through debug port
        const debugPort = typeof globalThis.process?.env?.DEBUG_PORT !== 'undefined';

        // If any condition is met, consider it in debug mode
        return debugActive || envDebugMode || sessionDebugMode || nodeDebugArg || debugPort;
    }

    /**
     * Gets the project name from the current workspace
     * @returns The name of the project (last part of the workspace path)
     */
    private getProjectName(): string {
        // Default project name if workspace can't be determined
        let projectName = "unknown_project";

        // Get the first workspace folder if available
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            // Extract just the last part of the path (directory name only)
            projectName = path.basename(workspaceFolders[0].uri.fsPath);
        }

        return projectName;
    }

    public async sendSettingsData(settings: DataObject): Promise<void> {
        // Check if metrics are enabled
        const config = vscode.workspace.getConfiguration('projectTranslator');
        const metricsEnabled = config.get<boolean>('enableMetrics', true);

        if (!metricsEnabled) {
            if (this.isDebugMode) {
                this.outputChannel.appendLine('📊 Metrics collection is disabled');
            }
            return;
        }

        try {
            // Create a deep copy of the settings object to avoid modifying the original
            const settingsCopy = JSON.parse(JSON.stringify(settings));

            // Filter out API key information from the copy
            if (settingsCopy.vendors && Array.isArray(settingsCopy.vendors)) {
                settingsCopy.vendors = settingsCopy.vendors.map((vendor: DataObject) => {
                    // set apikey of vendors to empty string to avoid sending sensitive data
                    return {
                        ...vendor,
                        apiKey: ''
                    };
                });
            }

            // Check debug status again in case it changes during runtime
            this.isDebugMode = this.detectDebugMode();

            // Get the project name (source root directory name)
            const projectName = this.getProjectName();

            // Choose different URLs based on the environment
            const url = this.isDebugMode
                // ? 'http://100.64.0.5:8080/api/project-translator/data' :
                ? 'https://collect.jqknono.com/api/project-translator/data' :
                'https://collect.jqknono.com/api/project-translator/data';

            // Prepare the payload according to the required format
            const payload = {
                machine_id: this.machineId,
                project_name: projectName,
                config: Buffer.from(JSON.stringify(settingsCopy)).toString('base64')
            };

            if (this.isDebugMode) {
                this.outputChannel.appendLine(`📤 Sending data to: ${url}`);
                this.outputChannel.appendLine(`📦 Data payload: ${JSON.stringify(payload, null, 2)}`);
            }

            await axios.post(url, payload);

            if (this.isDebugMode) {
                this.outputChannel.appendLine(`📤 Usage data sent successfully to ${this.isDebugMode ? 'debug' : 'production'} endpoint`);
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            if (this.isDebugMode) {
                this.outputChannel.appendLine(`⚠️ Failed to send usage data: ${errorMessage}`);
            }
        }
    }

    static async getMachineId(): Promise<string> {
        const envMachineId = await vscode.env.machineId;
        return envMachineId;
    }
}