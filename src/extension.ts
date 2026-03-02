import * as vscode from "vscode";
import * as path from "path";
import { TranslationDatabase } from "./translationDatabase";
import { FileProcessor } from "./services/fileProcessor";
import { TranslatorService } from "./services/translatorService";
import { AnalyticsService } from "./services/analytics";
import { getConfiguration, exportSettingsToConfigFile, clearConfigurationCache } from "./config/config";
import { createVscodeConfigProvider } from "./config/config.vscode";
import { DestFolder } from "./types/types";
import { LogFileManager } from "./services/logFileManager";
import * as fs from "fs";
import { getRuntimeContext, setRuntimeContext } from "./runtime/context";
import { OperationCancelledError, isOperationCancelledError } from "./runtime/errors";
import { TranslationRunner, TranslationRunResult } from "./app/translationRunner";

function localize(id: string, defaultMessage: string): string {
    const result = vscode.l10n.t(id)
    return result === id ? defaultMessage : result
}

// Global state
let translationDb: TranslationDatabase | null = null;
let isPaused = false;
let pauseResumeButton: vscode.StatusBarItem | undefined;
let cancelButton: vscode.StatusBarItem | undefined;
let progressStatusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel;
let logFileManager: LogFileManager | null = null;
let machineId: string | undefined;
let cancellationTokenSource: vscode.CancellationTokenSource | undefined;
let isProjectTranslation = false; // 标记是否在项目翻译模式

export async function activate(context: vscode.ExtensionContext) {
    const runtimeContext = buildVscodeRuntimeContext();
    setRuntimeContext(runtimeContext);

    outputChannel = vscode.window.createOutputChannel("Project Translator");
    logMessage(localize("extension.activated", "Project Translator extension is now active!"));

    // 不在 activate/改设置时创建日志目录/文件；仅在真正启动翻译时创建
    await syncLogFileManagerWithConfig();

    // Initialize machine ID
    machineId = await AnalyticsService.getMachineId();

    // Register commands
    const commands = registerCommands();
    context.subscriptions.push(...commands);

    // Listen for configuration changes
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('projectTranslator')) {
            clearConfigurationCache();
        }

        if (event.affectsConfiguration('projectTranslator.logFile') || 
            event.affectsConfiguration('projectTranslator.debug')) {
            // 仅同步状态（必要时关闭现有日志），不要在此创建目录/文件
            await syncLogFileManagerWithConfig();
        }
    });
    context.subscriptions.push(configChangeListener);

    // Clean up on deactivation
    context.subscriptions.push({
        dispose: () => {
            if (logFileManager) {
                logFileManager.dispose();
            }
        }
    });
}

function registerCommands(): vscode.Disposable[] {
    // Pause translation command
    const pauseCommand = vscode.commands.registerCommand(
        "extension.pauseTranslation",
        () => {
            isPaused = true;
            const message = localize("status.translation.paused", "Translation paused")
            logMessage(message);
            vscode.window.showInformationMessage(message);
            updatePauseResumeButton();
        }
    );

    // Resume translation command
    const resumeCommand = vscode.commands.registerCommand(
        "extension.resumeTranslation",
        () => {
            isPaused = false;
            const message = localize("status.translation.resumed", "Translation resumed")
            logMessage(message);
            vscode.window.showInformationMessage(message);
            updatePauseResumeButton();
        }
    );

    // Cancel translation command
    const cancelCommand = vscode.commands.registerCommand(
        "extension.cancelTranslation",
        () => {
            if (cancellationTokenSource) {
                cancellationTokenSource.cancel();
                const message = localize("status.translation.cancelled", "Translation cancelled")
                logMessage(message);
                vscode.window.showInformationMessage(message);
            }
        }
    );

    // Project translation command (combines folders and files)
    const translateProjectCommand = vscode.commands.registerCommand(
        "extension.translateProject",
        handleTranslateProject
    );

    // Folder translation command
    const translateFoldersCommand = vscode.commands.registerCommand(
        "extension.translateFolders",
        handletranslateFolders
    );

    // File translation command
    const translateFilesCommand = vscode.commands.registerCommand(
        "extension.translateFiles",
        handleTranslateFiles
    );

    // Add file to translation settings command
    const addFileCommand = vscode.commands.registerCommand(
        "extension.addFileToTranslationSettings",
        handleAddFileToSettings
    );

    // Add folder to translation settings command
    const addFolderCommand = vscode.commands.registerCommand(
        "extension.addFolderToTranslationSettings",
        handleAddFolderToSettings
    );

    // Export settings to project.translation.json command
    const exportSettingsCommand = vscode.commands.registerCommand(
        "extension.exportSettingsToConfig",
        exportSettingsToConfigFile
    );

    // Enable auto-translate task on folder open
    const enableAutoTranslateTaskCommand = vscode.commands.registerCommand(
        "extension.enableAutoTranslateOnOpen",
        handleEnableAutoTranslateOnOpen
    );

    // Disable auto-translate task on folder open
    const disableAutoTranslateTaskCommand = vscode.commands.registerCommand(
        "extension.disableAutoTranslateOnOpen",
        handleDisableAutoTranslateOnOpen
    );

    return [
        translateProjectCommand,
        translateFoldersCommand,
        translateFilesCommand,
        pauseCommand,
        resumeCommand,
        cancelCommand,
        addFileCommand,
        addFolderCommand,
        exportSettingsCommand,
        enableAutoTranslateTaskCommand,
        disableAutoTranslateTaskCommand
    ];
}

function buildVscodeRuntimeContext() {
    return {
        workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        logger: {
            info: (message: string) => {
                if (outputChannel) {outputChannel.appendLine(message);}
                if (logFileManager) {logFileManager.writeLog(message);}
            },
            warn: (message: string) => {
                if (outputChannel) {outputChannel.appendLine(message);}
                if (logFileManager) {logFileManager.writeLog(message);}
            },
            error: (message: string) => {
                if (outputChannel) {outputChannel.appendLine(message);}
                if (logFileManager) {logFileManager.writeLog(message);}
            },
            debug: (message: string) => {
                if (outputChannel) {outputChannel.appendLine(message);}
                if (logFileManager) {logFileManager.writeLog(message);}
            }
        },
        notifier: {
            showInfo: (message: string) => { void vscode.window.showInformationMessage(message); },
            showWarn: (message: string) => { void vscode.window.showWarningMessage(message); },
            showError: (message: string) => { void vscode.window.showErrorMessage(message); }
        },
        configProvider: createVscodeConfigProvider(),
        createCancellationController: () => {
            const source = new vscode.CancellationTokenSource();
            return {
                token: source.token,
                cancel: () => source.cancel(),
                dispose: () => source.dispose()
            };
        },
        createCancellationError: (message?: string) => new OperationCancelledError(message),
        isCancellationError: (error: unknown) => isOperationCancelledError(error) || error instanceof vscode.CancellationError,
        getMachineId: async () => vscode.env.machineId
    };
}

/**
 * 在当前工作区创建/更新 .vscode/tasks.json，添加一个在文件夹打开时触发翻译的任务
 */
async function handleEnableAutoTranslateOnOpen() {
    try {
        const workspace = vscode.workspace.workspaceFolders?.[0]
        if (!workspace) {
            throw new Error(
                localize(
                    "autoTranslate.common.noWorkspace",
                    "Please open a workspace first"
                )
            )
        }

        const vscodeDir = path.join(workspace.uri.fsPath, ".vscode")
        const tasksPath = path.join(vscodeDir, "tasks.json")

        // 目标任务定义（与用户提供的已验证片段一致）
        const targetTaskLabel = "Translate project on open"
        const targetTask: any = {
            label: targetTaskLabel,
            type: "shell",
            command: "echo",
            args: [
                "Triggering Project Translator on workspace open",
                "${command:extension.translateProject}"
            ],
            problemMatcher: [],
            runOptions: {
                runOn: "folderOpen"
            },
            presentation: {
                reveal: "never",
                panel: "dedicated"
            }
        }

        // 确保 .vscode 目录存在（使用异步 mkdir 避免阻塞）
        await fs.promises.mkdir(vscodeDir, { recursive: true })

        // 读取并容错解析现有 tasks.json（允许 JSONC 注释/尾随逗号）
        let content: any = { version: "2.0.0", tasks: [] as any[] }
        try {
            const raw = await fs.promises.readFile(tasksPath, "utf8")
            const sanitized = raw
                .replace(/\/\*[\s\S]*?\*\//g, "") // 块注释
                .replace(/^\s*\/\/.*$/gm, "") // 行注释
                .replace(/,\s*([}\]])/g, "$1") // 尾随逗号
            const parsed = JSON.parse(sanitized)
            if (parsed && typeof parsed === "object") {
                content = parsed
                if (!Array.isArray(content.tasks)) {content.tasks = []}
                if (!content.version) {content.version = "2.0.0"}
            }
        } catch (e) {
            // 文件不存在或解析失败：保留默认结构，避免破坏原文件；提示用户
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                const parseErrorPrefix = localize(
                    "autoTranslate.enable.parseTasksJsonError",
                    "⚠️ Failed to parse existing tasks.json, will create a minimal structure with the new task. Error:"
                )
                logMessage(`${parseErrorPrefix} ${e}`, "warn")
            }
        }

        // 如已存在相同 label 的任务，则更新其关键字段；否则追加
        const tasks: any[] = content.tasks || []
        const existing = tasks.find(t => t && t.label === targetTaskLabel)
        if (existing) {
            existing.type = targetTask.type
            existing.command = targetTask.command
            existing.args = targetTask.args
            existing.problemMatcher = targetTask.problemMatcher
            existing.runOptions = { ...(existing.runOptions || {}), runOn: "folderOpen" }
            existing.presentation = { ...(existing.presentation || {}), reveal: "never", panel: "dedicated" }
        } else {
            tasks.push(targetTask)
        }
        content.tasks = tasks

        // 写回文件（标准 JSON 缩进）
        fs.writeFileSync(tasksPath, JSON.stringify(content, null, 2) + "\n", "utf8")

        const successLogPrefix = localize(
            "autoTranslate.enable.successLog",
            "✅ Auto-translate task has been written to"
        )
        logMessage(`${successLogPrefix} ${path.relative(workspace.uri.fsPath, tasksPath)}.`)

        // 询问是否立即重载以触发 folderOpen 任务
        const reloadPrompt = localize(
            "autoTranslate.enable.reloadPrompt",
            "Auto-translate on folder open has been enabled. Reload the window now to take effect?"
        )
        const reloadNowLabel = localize(
            "autoTranslate.enable.reloadNow",
            "Reload Window"
        )
        const reloadLaterLabel = localize(
            "autoTranslate.enable.reloadLater",
            "Later"
        )
        const action = await vscode.window.showInformationMessage(
            reloadPrompt,
            reloadNowLabel,
            reloadLaterLabel
        )
        if (action === reloadNowLabel) {
            await vscode.commands.executeCommand("workbench.action.reloadWindow")
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const errorPrefix = localize(
            "autoTranslate.enable.error",
            "Failed to enable auto-translate task:"
        )
        vscode.window.showErrorMessage(`${errorPrefix} ${msg}`)
        logMessage(`❌ ${errorPrefix} ${msg}`, "error")
    }
}

/**
 * 取消在文件夹打开时自动触发翻译：
 * - 定位并解析 .vscode/tasks.json
 * - 找到标签为 "Translate project on open" 或包含 ${command:extension.translateProject} 的任务
 * - 移除其 runOptions.runOn，从而不再在打开工作区时自动执行
 */
async function handleDisableAutoTranslateOnOpen() {
    try {
        const workspace = vscode.workspace.workspaceFolders?.[0]
        if (!workspace) {
            throw new Error(
                localize(
                    "autoTranslate.common.noWorkspace",
                    "Please open a workspace first"
                )
            )
        }

        const vscodeDir = path.join(workspace.uri.fsPath, ".vscode")
        const tasksPath = path.join(vscodeDir, "tasks.json")

        try {
            await fs.promises.access(tasksPath, fs.constants.F_OK)
        } catch {
            const noTasksMessage = localize(
                "autoTranslate.disable.noTasks",
                "No tasks.json found; auto-translate on folder open does not seem to be enabled."
            )
            vscode.window.showInformationMessage(noTasksMessage)
            logMessage(noTasksMessage, "warn")
            return
        }

        const raw = await fs.promises.readFile(tasksPath, "utf8")
        const sanitized = raw
            .replace(/\/\*[\s\S]*?\*\//g, "")
            .replace(/^\s*\/\/.*$/gm, "")
            .replace(/,\s*([}\]])/g, "$1")
        let content: any
        try {
            content = JSON.parse(sanitized)
        } catch (e) {
            const parseErrorMessage = localize(
                "autoTranslate.disable.parseErrorMessage",
                "Failed to parse tasks.json; skipping changes to avoid corrupting the file."
            )
            vscode.window.showErrorMessage(parseErrorMessage)
            const parseErrorLogPrefix = localize(
                "autoTranslate.disable.parseErrorLog",
                "Failed to parse tasks.json:"
            )
            logMessage(`${parseErrorLogPrefix} ${e}`, "error")
            return
        }

        if (!content || typeof content !== "object") {content = { version: "2.0.0", tasks: [] }}
        const tasks: any[] = Array.isArray(content.tasks) ? content.tasks : []

        const targetTaskLabel = "Translate project on open"
        let modified = false

        const hasTranslateProjectArg = (t: any) => {
            const args = t?.args
            return Array.isArray(args) && args.some((a) => typeof a === "string" && a.includes("${command:extension.translateProject}"))
        }

        for (const t of tasks) {
            if (!t || typeof t !== "object") {continue}
            if (t.label === targetTaskLabel || hasTranslateProjectArg(t)) {
                if (t.runOptions && typeof t.runOptions === "object" && "runOn" in t.runOptions) {
                    delete t.runOptions.runOn
                    // 清理空对象
                    if (Object.keys(t.runOptions).length === 0) {delete t.runOptions}
                    modified = true
                }
            }
        }

        if (!modified) {
            const alreadyDisabledMessage = localize(
                "autoTranslate.disable.alreadyDisabled",
                "Auto-translate on folder open already appears to be disabled."
            )
            vscode.window.showInformationMessage(alreadyDisabledMessage)
            const alreadyDisabledLog = localize(
                "autoTranslate.disable.alreadyDisabledLog",
                "No runOn setting found to disable; it may already be disabled."
            )
            logMessage(alreadyDisabledLog)
            return
        }

        fs.writeFileSync(tasksPath, JSON.stringify({ ...content, tasks }, null, 2) + "\n", "utf8")
        const disableSuccessLogPrefix = localize(
            "autoTranslate.disable.successLog",
            "✅ Disabled auto-translate task (removed runOn) in"
        )
        logMessage(`${disableSuccessLogPrefix} ${path.relative(workspace.uri.fsPath, tasksPath)}.`)
        const disableSuccessMessage = localize(
            "autoTranslate.disable.successInfo",
            "Auto-translate on folder open has been disabled."
        )
        vscode.window.showInformationMessage(disableSuccessMessage)
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const disableErrorPrefix = localize(
            "autoTranslate.disable.error",
            "Failed to disable auto-translate task:"
        )
        vscode.window.showErrorMessage(`${disableErrorPrefix} ${msg}`)
        logMessage(`❌ ${disableErrorPrefix} ${msg}`, "error")
    }
}

async function handletranslateFolders() {
    try {
        setRuntimeContext(buildVscodeRuntimeContext());
        clearConfigurationCache();
        await ensureLogFileManagerForTranslation();

        outputChannel.clear();
        outputChannel.show(true);
        logMessage("==========================================");
		logMessage("Starting folders translation task");
		logMessage("==========================================\n");

        if (!cancellationTokenSource) {
            cancellationTokenSource = new vscode.CancellationTokenSource();
        }
        const token = cancellationTokenSource.token;
        createStatusBarButtons();
        const runner = new TranslationRunner(getRuntimeContext());
        const result = await runner.runFolders(token);

        if (result.cancelled) {
            logMessage("⛔ Translation cancelled by user", "warn");
            vscode.window.showInformationMessage("Folders translation cancelled!");
            return;
        }

        if (result.fatalError) {
            throw new Error(result.fatalError);
        }
        const totalProcessed = result.processedFiles + result.skippedFiles;
        vscode.window.showInformationMessage(`Folders translation completed! (${totalProcessed} files processed)`);
        outputRunnerSummary(result);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Translation failed: ${errorMessage}`);
        logMessage(`❌ Error: ${errorMessage}`, "error");
    } finally {
        cleanup();
    }
}

async function handleTranslateFiles() {
    try {
        setRuntimeContext(buildVscodeRuntimeContext());
        clearConfigurationCache();
        await ensureLogFileManagerForTranslation();

        outputChannel.clear();
        outputChannel.show(true);
        logMessage("==========================================");
		logMessage("Starting files translation task");
		logMessage("==========================================\n");

        if (!cancellationTokenSource) {
            cancellationTokenSource = new vscode.CancellationTokenSource();
        }
        const token = cancellationTokenSource.token;
        createStatusBarButtons();
        const runner = new TranslationRunner(getRuntimeContext());
        const result = await runner.runFiles(token);
        if (result.cancelled) {
            logMessage("⛔ Translation cancelled by user", "warn");
            vscode.window.showInformationMessage("Files translation cancelled!");
            return;
        }
        if (result.fatalError) {
            throw new Error(result.fatalError);
        }
        const totalProcessed = result.processedFiles + result.skippedFiles;
        vscode.window.showInformationMessage(`Files translation completed! (${totalProcessed} files)`);
        outputRunnerSummary(result);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Files translation failed: ${errorMessage}`);
        logMessage(`❌ Error: ${errorMessage}`, "error");
    } finally {
        cleanup();
    }
}

async function handleTranslateProject() {
    try {
        setRuntimeContext(buildVscodeRuntimeContext());
        clearConfigurationCache();
        await ensureLogFileManagerForTranslation();

        outputChannel.clear();
        outputChannel.show(true);
        logMessage("==========================================");
		logMessage("Starting project translation");
		logMessage("==========================================\n");

        cancellationTokenSource = new vscode.CancellationTokenSource();
        createStatusBarButtons();

        const runner = new TranslationRunner(getRuntimeContext());
        const result = await runner.runProject(cancellationTokenSource.token);
        if (result.cancelled) {
            logMessage("⛔ Translation cancelled by user", "warn");
            vscode.window.showInformationMessage("Project translation cancelled!");
            return;
        }
        if (result.fatalError) {
            throw new Error(result.fatalError);
        }
        vscode.window.showInformationMessage("Project translation completed!");
        outputRunnerSummary(result);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Translation failed: ${errorMessage}`);
        logMessage(`❌ Error: ${errorMessage}`, "error");
    } finally {
        cleanup(true); // 强制清理
    }
}

async function handleAddFileToSettings(fileUri: vscode.Uri) {
    try {
        // Get the workspace folder
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a workspace first");
        }

        // Get the file path relative to the workspace
        let relativePath = path.relative(workspace.uri.fsPath, fileUri.fsPath);
        if (path.isAbsolute(relativePath)) {
            // If it's still absolute, it means the file is not inside the workspace
            throw new Error("File must be inside the workspace");
        }

        // Verify the file exists
        try {
            const stat = await fs.promises.stat(fileUri.fsPath);
            if (!stat.isFile()) {
                throw new Error(`File does not exist: ${relativePath}`);
            }
        } catch {
            throw new Error(`File does not exist: ${relativePath}`);
        }

        // Detect the source language (default to en-us)
        const sourceLang = "en-us";
        
        // Default target language
        const targetLang = "zh-cn";

        // Generate target path using the pattern i18n/{target_lang}/{relativePath}
        const targetDir = path.join("i18n", targetLang);
        const targetPath = path.join(targetDir, relativePath);

        // Get existing configuration
        const config = vscode.workspace.getConfiguration("projectTranslator");
        let specifiedFiles = config.get<Array<any>>("specifiedFiles") || [];

        // Check if the file is already in the configuration
        const existingEntry = specifiedFiles.find(entry => 
            entry.sourceFile && 
            entry.sourceFile.path === relativePath);

        if (existingEntry) {
            logMessage(`File already exists in translation settings: ${relativePath}`);
            vscode.window.showInformationMessage(`File already exists in translation settings: ${relativePath}`);
            return;
        }

        // Create new file entry
        const newFileEntry = {
            sourceFile: {
                path: relativePath,
                lang: sourceLang
            },
            targetFiles: [
                {
                    path: targetPath,
                    lang: targetLang
                }
            ]
        };

        // Add to the configuration
        specifiedFiles.push(newFileEntry);

        // Update configuration
        await config.update("specifiedFiles", specifiedFiles, vscode.ConfigurationTarget.Workspace);

        // Show success message
        logMessage(`Added file to translation settings: ${relativePath} → ${targetPath}`);
        vscode.window.showInformationMessage(`Added file to translation settings: ${relativePath} → ${targetPath}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Failed to add file to translation settings: ${errorMessage}`);
        logMessage(`❌ Error: ${errorMessage}`, "error");
    }
}

async function handleAddFolderToSettings(folderUri: vscode.Uri) {
    try {
        // Get the workspace folder
        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a workspace first");
        }

        // Get the folder path relative to the workspace
        let relativePath = path.relative(workspace.uri.fsPath, folderUri.fsPath);
        if (path.isAbsolute(relativePath)) {
            // If it's still absolute, it means the folder is not inside the workspace
            throw new Error("Folder must be inside the workspace");
        }

        // Verify the folder exists
        try {
            const stat = await fs.promises.stat(folderUri.fsPath);
            if (!stat.isDirectory()) {
                throw new Error(`Folder does not exist: ${relativePath}`);
            }
        } catch {
            throw new Error(`Folder does not exist: ${relativePath}`);
        }

        // Detect the source language (default to en-us)
        const sourceLang = "en-us";
        
        // Default target language
        const targetLang = "zh-tw";

        // Generate target path using the pattern i18n/{target_lang}/{relativePath}
        const targetDir = path.join("i18n", targetLang);
        const targetPath = path.join(targetDir, relativePath);

        // Get existing configuration
        const config = vscode.workspace.getConfiguration("projectTranslator");
        let specifiedFolders = config.get<Array<any>>("specifiedFolders") || [];

        // Check if the folder is already in the configuration
        const existingEntry = specifiedFolders.find(entry => 
            entry.sourceFolder && 
            entry.sourceFolder.path === relativePath);

        if (existingEntry) {
            logMessage(`Folder already exists in translation settings: ${relativePath}`);
            vscode.window.showInformationMessage(`Folder already exists in translation settings: ${relativePath}`);
            return;
        }

        // Create new folder entry
        const newFolderEntry = {
            sourceFolder: {
                path: relativePath,
                lang: sourceLang
            },
            targetFolders: [
                {
                    path: targetPath,
                    lang: targetLang
                }
            ]
        };

        // Add to the configuration
        specifiedFolders.push(newFolderEntry);

        // Update configuration
        await config.update("specifiedFolders", specifiedFolders, vscode.ConfigurationTarget.Workspace);

        // Show success message
        logMessage(`Added folder to translation settings: ${relativePath} → ${targetPath}`);
        vscode.window.showInformationMessage(`Added folder to translation settings: ${relativePath} → ${targetPath}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Failed to add folder to translation settings: ${errorMessage}`);
        logMessage(`❌ Error: ${errorMessage}`, "error");
    }
}

function createStatusBarButtons() {
    // Create progress status bar item (leftmost)
    if (!progressStatusBarItem) {
        progressStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            2
        );
    }
    progressStatusBarItem.text = `$(sync~spin) ${localize("status.translation.inProgress", "Translating...")}`;
    progressStatusBarItem.show();

    // Only create pause/resume button if it doesn't exist
    if (!pauseResumeButton) {
        pauseResumeButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            1
        );
    }

    // Only create cancel button if it doesn't exist
    if (!cancelButton) {
        cancelButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            0
        );
        cancelButton.text = `$(close) ${localize("status.translation.cancel", "Cancel translation")}`;
        cancelButton.command = "extension.cancelTranslation";
    }

    updatePauseResumeButton();
    cancelButton.show();
}

function updatePauseResumeButton() {
    if (pauseResumeButton) {
        if (isPaused) {
            pauseResumeButton.text = `$(debug-continue) ${localize("status.translation.resume", "Resume translation")}`;
            pauseResumeButton.command = "extension.resumeTranslation";
        } else {
            pauseResumeButton.text = `$(debug-pause) ${localize("status.translation.pause", "Pause translation")}`;
            pauseResumeButton.command = "extension.pauseTranslation";
        }
        pauseResumeButton.show();
    }
}

function updateProgressStatusBar(message: string) {
    if (progressStatusBarItem) {
        progressStatusBarItem.text = `$(sync~spin) ${message}`;
    }
}

function hideTranslationButtons() {
    pauseResumeButton?.hide();
    cancelButton?.hide();
    progressStatusBarItem?.hide();
}

function outputSummary(startTime: number, fileProcessor: FileProcessor, translatorService: TranslatorService) {
    const endTime = Date.now();
    const totalTimeInSeconds = ((endTime - startTime) / 1000).toFixed(2);
    const stats = fileProcessor.getProcessingStats();
    const tokenCounts = translatorService.getTokenCounts();

    logMessage("\n==========================================");
    logMessage("Translation Task Summary");
    logMessage("==========================================");
    logMessage(`✅ Translated files: ${stats.processedFiles}`);
    logMessage(`⏭️ Skipped files: ${stats.skippedFiles}`);
    logMessage(`❌ Failed files: ${stats.failedFiles}`);

    if (stats.failedFiles > 0 && stats.failedPaths.length > 0) {
        logMessage("\n❌ Failed files list:");
        stats.failedPaths.forEach((filePath, index) => {
            logMessage(`   ${index + 1}. ${filePath}`);
        });
        logMessage("");
    }

    logMessage(`⌛ Total time: ${totalTimeInSeconds} seconds`);
    logMessage(`📊 Total tokens consumed:`);
    logMessage(`   - Input: ${tokenCounts.inputTokens.toLocaleString()} tokens`);
    logMessage(`   - Output: ${tokenCounts.outputTokens.toLocaleString()} tokens`);
    logMessage(`   - Total: ${tokenCounts.totalTokens.toLocaleString()} tokens`);

    const tokensPerMinute = Math.round(tokenCounts.totalTokens / (Number(totalTimeInSeconds) / 60));
    if (!isNaN(tokensPerMinute) && isFinite(tokensPerMinute)) {
        logMessage(`   - Processing speed: ${tokensPerMinute.toLocaleString()} tokens/minute`);
    }
}

function outputRunnerSummary(result: TranslationRunResult) {
    logMessage("\n==========================================");
    logMessage("Translation Task Summary");
    logMessage("==========================================");
    logMessage(`✅ Translated files: ${result.processedFiles}`);
    logMessage(`⏭️ Skipped files: ${result.skippedFiles}`);
    logMessage(`❌ Failed files: ${result.failedFiles}`);

    if (result.failedFiles > 0 && result.failedPaths.length > 0) {
        logMessage("\n❌ Failed files list:");
        result.failedPaths.forEach((filePath, index) => {
            logMessage(`   ${index + 1}. ${filePath}`);
        });
        logMessage("");
    }

    logMessage(`⌛ Total time: ${(result.durationMs / 1000).toFixed(2)} seconds`);
    logMessage(`📊 Total tokens consumed:`);
    logMessage(`   - Input: ${result.tokenCounts.inputTokens.toLocaleString()} tokens`);
    logMessage(`   - Output: ${result.tokenCounts.outputTokens.toLocaleString()} tokens`);
    logMessage(`   - Total: ${result.tokenCounts.totalTokens.toLocaleString()} tokens`);

    const tokensPerMinute = Math.round(result.tokenCounts.totalTokens / (result.durationMs / 1000 / 60));
    if (!isNaN(tokensPerMinute) && isFinite(tokensPerMinute)) {
        logMessage(`   - Processing speed: ${tokensPerMinute.toLocaleString()} tokens/minute`);
    }
}

/**
 * 同步日志管理器状态（不产生文件系统副作用）。
 * - 不会在这里创建日志目录/文件
 * - 仅在禁用时关闭已有的日志写入
 */
async function syncLogFileManagerWithConfig(): Promise<void> {
    try {
        const config = await getConfiguration();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : undefined;

        const logFile = config.logFile;
        const enabled = !!(config.debug && logFile && logFile.enabled);
        if (!enabled) {
            if (logFileManager) {
                logFileManager.writeLog(`=== Project Translator Debug Session Ended ===`);
                logFileManager.dispose();
                logFileManager = null;
            }
            return;
        }

        // enabled=true：仅更新已有 manager 配置（若尚未创建，保持懒加载）
        if (logFileManager) {
            logFileManager.updateConfig(logFile, workspaceRoot);
        }
    } catch (error) {
        logMessage(`Failed to sync log file manager: ${error}`, "error");
    }
}

/**
 * 启动翻译任务时确保日志目录/文件创建。
 * 这是唯一会“创建目录/文件”的入口，满足：改设置不落盘，启动翻译才落盘。
 */
async function ensureLogFileManagerForTranslation(): Promise<void> {
    try {
        const config = await getConfiguration();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : undefined;

        const logFile = config.logFile;
        if (!(config.debug && logFile && logFile.enabled)) {
            return;
        }

        if (logFileManager) {
            logFileManager.updateConfig(logFile, workspaceRoot);
        } else {
            logFileManager = new LogFileManager(logFile, workspaceRoot);
        }

        // 写入一条 session 头，触发目录/文件创建
        const logDir = logFileManager.getLogDirectory();
        logMessage(`Debug log file enabled: ${logFileManager.getCurrentLogFile()}`);
        logFileManager.writeLog(`=== Project Translator Debug Session Started ===`);
        logFileManager.writeLog(`Log directory: ${logDir}`);
        logFileManager.writeLog(`Configuration: ${JSON.stringify(logFile, null, 2)}`);
    } catch (error) {
        logMessage(`Failed to ensure log file manager for translation: ${error}`, "error");
    }
}

/**
 * Enhanced logging function that outputs to both outputChannel and log file
 * @param message The message to log
 * @param level Log level (info, warn, error)
 */
export function logMessage(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    // Always output to outputChannel if it exists
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (outputChannel && outputChannel.appendLine) {
        outputChannel.appendLine(formattedMessage);
    }

    // Also write to log file if debug mode and log file are enabled
    if (logFileManager) {
        logFileManager.writeLog(`[${level.toUpperCase()}] ${message}`);
    }
}

/**
 * Get the output channel for external use
 */
export function getOutputChannel(): vscode.OutputChannel {
    return outputChannel;
}

/**
 * Get the log file manager for external use
 */
export function getLogFileManager(): LogFileManager | null {
    return logFileManager;
}

async function sendAnalytics(analyticsService: AnalyticsService, fileProcessor: FileProcessor, translatorService: TranslatorService) {
    const config = vscode.workspace.getConfiguration('projectTranslator');
    await analyticsService.sendSettingsData(config);
}

function cleanup(force = false) {
    // 在项目翻译模式下，子任务不进行完全清理
    if (isProjectTranslation && !force) {
        return;
    }

    translationDb?.close().catch((error) => {
        logMessage(`Error closing database: ${error}`, "error");
    });
    translationDb = null;

    // Hide buttons before disposing
    hideTranslationButtons();
    
    pauseResumeButton?.dispose();
    pauseResumeButton = undefined;
    cancelButton?.dispose();
    cancelButton = undefined;
    progressStatusBarItem?.dispose();
    progressStatusBarItem = undefined;
    
    // Dispose cancellation token source
    cancellationTokenSource?.dispose();
    cancellationTokenSource = undefined;
    
    isProjectTranslation = false;
}

export function deactivate(): void {
    cleanup();
    outputChannel.dispose();
}
