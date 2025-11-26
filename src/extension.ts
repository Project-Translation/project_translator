import * as vscode from "vscode";
import * as path from "path";
import { TranslationDatabase } from "./translationDatabase";
import { FileProcessor } from "./services/fileProcessor";
import { TranslatorService } from "./services/translatorService";
import { AnalyticsService } from "./services/analytics";
import { getConfiguration, exportSettingsToConfigFile } from "./config/config";
import { DestFolder, SpecifiedFolder } from "./types/types";
import { LogFileManager } from "./services/logFileManager";
import * as fs from "fs";

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
    outputChannel = vscode.window.createOutputChannel("Project Translator");
    logMessage(localize("extension.activated", "Project Translator extension is now active!"));

    // Initialize log file manager
    await initializeLogFileManager();

    // Initialize machine ID
    machineId = await AnalyticsService.getMachineId();

    // Register commands
    const commands = registerCommands();
    context.subscriptions.push(...commands);

    // Listen for configuration changes
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (event) => {
        if (event.affectsConfiguration('projectTranslator.logFile') || 
            event.affectsConfiguration('projectTranslator.debug')) {
            await initializeLogFileManager();
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

/**
 * 在当前工作区创建/更新 .vscode/tasks.json，添加一个在文件夹打开时触发翻译的任务
 */
async function handleEnableAutoTranslateOnOpen() {
    try {
        const workspace = vscode.workspace.workspaceFolders?.[0]
        if (!workspace) {
            throw new Error("Please open a workspace first")
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
                if (!Array.isArray(content.tasks)) content.tasks = []
                if (!content.version) content.version = "2.0.0"
            }
        } catch (e) {
            // 文件不存在或解析失败：保留默认结构，避免破坏原文件；提示用户
            if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
                logMessage(
                    `⚠️ 无法解析现有 tasks.json，将创建最简结构写入新任务。错误: ${e}`,
                    "warn"
                )
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

        logMessage(`✅ 已在 ${path.relative(workspace.uri.fsPath, tasksPath)} 写入自动翻译任务。`)

        // 询问是否立即重载以触发 folderOpen 任务
        const action = await vscode.window.showInformationMessage(
            "已启用在工作区打开时自动翻译。是否现在重载窗口以立即生效？",
            "重载窗口",
            "稍后"
        )
        if (action === "重载窗口") {
            await vscode.commands.executeCommand("workbench.action.reloadWindow")
        }
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        vscode.window.showErrorMessage(`启用自动翻译任务失败: ${msg}`)
        logMessage(`❌ 启用自动翻译任务失败: ${msg}`, "error")
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
            throw new Error("Please open a workspace first")
        }

        const vscodeDir = path.join(workspace.uri.fsPath, ".vscode")
        const tasksPath = path.join(vscodeDir, "tasks.json")

        try {
            await fs.promises.access(tasksPath, fs.constants.F_OK)
        } catch {
            vscode.window.showInformationMessage("未发现 tasks.json，自动翻译似乎未启用。")
            logMessage("未发现 tasks.json，自动翻译似乎未启用。", "warn")
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
            vscode.window.showErrorMessage("无法解析 tasks.json，放弃修改以避免损坏文件。")
            logMessage(`无法解析 tasks.json: ${e}`, "error")
            return
        }

        if (!content || typeof content !== "object") content = { version: "2.0.0", tasks: [] }
        const tasks: any[] = Array.isArray(content.tasks) ? content.tasks : []

        const targetTaskLabel = "Translate project on open"
        let modified = false

        const hasTranslateProjectArg = (t: any) => {
            const args = t?.args
            return Array.isArray(args) && args.some((a) => typeof a === "string" && a.includes("${command:extension.translateProject}"))
        }

        for (const t of tasks) {
            if (!t || typeof t !== "object") continue
            if (t.label === targetTaskLabel || hasTranslateProjectArg(t)) {
                if (t.runOptions && typeof t.runOptions === "object" && "runOn" in t.runOptions) {
                    delete t.runOptions.runOn
                    // 清理空对象
                    if (Object.keys(t.runOptions).length === 0) delete t.runOptions
                    modified = true
                }
            }
        }

        if (!modified) {
            vscode.window.showInformationMessage("看起来自动翻译已处于禁用状态。")
            logMessage("未发现需要禁用的 runOn 设置，可能已禁用。")
            return
        }

        fs.writeFileSync(tasksPath, JSON.stringify({ ...content, tasks }, null, 2) + "\n", "utf8")
        logMessage(`✅ 已在 ${path.relative(workspace.uri.fsPath, tasksPath)} 禁用自动翻译（移除 runOn）。`)
        vscode.window.showInformationMessage("已禁用在工作区打开时自动翻译。")
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        vscode.window.showErrorMessage(`禁用自动翻译任务失败: ${msg}`)
        logMessage(`❌ 禁用自动翻译任务失败: ${msg}`, "error")
    }
}

async function handletranslateFolders() {
    try {
        // Show and focus output panel
        outputChannel.clear();
        outputChannel.show(true);
        logMessage("==========================================");
		logMessage("Starting folders translation task");
		logMessage("==========================================\n");

        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a target workspace first");
        }

        // Initialize services
        const translatorService = new TranslatorService(outputChannel);
        await translatorService.initializeOpenAIClient();

        // Get configuration and validate
        const config = vscode.workspace.getConfiguration("projectTranslator");
        const specifiedFolders = config.get<SpecifiedFolder[]>("specifiedFolders") || [];
        if (specifiedFolders.length === 0) {
            throw new Error("No folder groups configured. Please configure projectTranslator.specifiedFolders in settings.");
        }

        // Initialize database and ensure it exists
        const translationDatabase = new TranslationDatabase(workspace.uri.fsPath, outputChannel);
        translationDb = translationDatabase;

        // Initialize file processor
        const fileProcessor = new FileProcessor(outputChannel, translationDatabase, translatorService);

        // Create cancellation token source if not already exists
        const isSharedCancellation = !!cancellationTokenSource;
        if (!cancellationTokenSource) {
            cancellationTokenSource = new vscode.CancellationTokenSource();
        }
        const token = cancellationTokenSource.token;

        // Create status bar buttons
        createStatusBarButtons();

        // Reset state
        isPaused = false;
        translatorService.resetTokenCounts();

        // Record start time
        const startTime = Date.now();

        // Set translation state with our token
        fileProcessor.setTranslationState(isPaused, token);

        const totalFolderGroups = specifiedFolders.length;
        let processedGroups = 0;

        try {
            for (const folderGroup of specifiedFolders) {
                // Check for cancellation
                if (token.isCancellationRequested) {
                    throw new vscode.CancellationError();
                }

                const sourceFolder = folderGroup.sourceFolder;
                const targetFolders = folderGroup.targetFolders;

                if (!sourceFolder?.path || !sourceFolder?.lang || !targetFolders?.length) {
                    logMessage(`⚠️ Skipping invalid folder group configuration`);
                    continue;
                }

                logMessage(`\n📂 Processing source folder: ${sourceFolder.path}`);

                // Use absolute path for source folder
                if (!path.isAbsolute(sourceFolder.path)) {
                    sourceFolder.path = path.join(workspace.uri.fsPath, sourceFolder.path);
                }
                try {
                    const stat = await fs.promises.stat(sourceFolder.path);
                    if (!stat.isDirectory()) {
                        throw new Error(`Source folder is not a directory: ${sourceFolder.path}`);
                    }
                } catch {
                    throw new Error(`Source folder does not exist: ${sourceFolder.path}`);
                }
                // Register source directory and language
                translationDatabase.setSourceRoot(sourceFolder.path);

                // Reset target roots for this folder group
                translationDatabase.clearTargetRoots();
                targetFolders.forEach((target: DestFolder) => translationDatabase.setTargetRoot(target.path, target.lang));

                // Process this folder group
                await fileProcessor.processDirectory(sourceFolder.path, targetFolders, sourceFolder.lang);

                // Get updated stats after processing this folder group
                const stats = fileProcessor.getProcessingStats();
                const totalFilesProcessed = stats.processedFiles + stats.skippedFiles;
                
                processedGroups++;
                updateProgressStatusBar(`文件夹 ${processedGroups}/${totalFolderGroups} (${totalFilesProcessed} 文件)`);
            }
            
            // Get final stats for the completion message
            const finalStats = fileProcessor.getProcessingStats();
            const totalProcessed = finalStats.processedFiles + finalStats.skippedFiles;
            vscode.window.showInformationMessage(`Folders translation completed! (${totalProcessed} files processed)`);
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                // Get stats for cancellation message
                const currentStats = fileProcessor.getProcessingStats();
                const totalProcessed = currentStats.processedFiles + currentStats.skippedFiles;
                
                logMessage("⛔ Translation cancelled by user");
                vscode.window.showInformationMessage(`Folders translation cancelled! (${totalProcessed} files processed)`);
                return;
            }
            throw error;
        }

        // Output summary
        outputSummary(startTime, fileProcessor, translatorService);

        // Send analytics
        const analyticsService = new AnalyticsService(outputChannel, machineId);
        await sendAnalytics(analyticsService, fileProcessor, translatorService);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Translation failed: ${errorMessage}`);
        logMessage(`❌ Error: ${errorMessage}`);
    } finally {
        cleanup();
    }
}

async function handleTranslateFiles() {
    try {
        // Show and focus output panel
        outputChannel.clear();
        outputChannel.show(true);
        logMessage("==========================================");
		logMessage("Starting files translation task");
		logMessage("==========================================\n");

        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a workspace first");
        }

        // Initialize services
        const translatorService = new TranslatorService(outputChannel);
        await translatorService.initializeOpenAIClient();

        // Get the configuration
        const config = await getConfiguration();
        
        // Get specified files configuration
        const specifiedFiles = config.specifiedFiles;
        if (!specifiedFiles || specifiedFiles.length === 0) {
            throw new Error("No specified files configured. Please configure projectTranslator.specifiedFiles in settings.");
        }

        // Initialize database
        const translationDatabase = new TranslationDatabase(workspace.uri.fsPath, outputChannel);
        translationDb = translationDatabase;
        
        // Reset state
        isPaused = false;
        translatorService.resetTokenCounts();
        
        // Create cancellation token source if not already exists
        const isSharedCancellation = !!cancellationTokenSource;
        if (!cancellationTokenSource) {
            cancellationTokenSource = new vscode.CancellationTokenSource();
        }
        const token = cancellationTokenSource.token;

        // Create status bar buttons
        createStatusBarButtons();
        
        // Record start time
        const startTime = Date.now();

        // Initialize file processor
        const fileProcessor = new FileProcessor(outputChannel, translationDatabase, translatorService);

        // Calculate total files to translate
        let totalFiles = 0;
        for (const fileGroup of specifiedFiles) {
            if (fileGroup.sourceFile && fileGroup.sourceFile.path && 
                fileGroup.targetFiles && fileGroup.targetFiles.length > 0) {
                totalFiles += fileGroup.targetFiles.length;
            }
        }
        
        logMessage(`📊 Found ${totalFiles} files to translate`);

        // Set translation state with our token
        fileProcessor.setTranslationState(isPaused, token);
        
        const totalCount = specifiedFiles.length;
        let processedCount = 0;
        let processedFiles = 0;

        try {            
            for (const fileGroup of specifiedFiles) {
                // Check for cancellation
                if (token.isCancellationRequested) {
                    throw new vscode.CancellationError();
                }

                const sourceFile = fileGroup.sourceFile;
                const targetFiles = fileGroup.targetFiles;
                
                if (!sourceFile || !sourceFile.path || !targetFiles || targetFiles.length === 0) {
                    logMessage(`⚠️ Skipping invalid file group configuration`);
                    continue;
                }
                
                logMessage(`\n📄 Processing source file: ${sourceFile.path}`);
                
                // Set source directory and language for this file
                const sourceDir = path.dirname(sourceFile.path);
                translationDatabase.setSourceRoot(sourceDir);
                
                // Register target directories
                for (const targetFile of targetFiles) {
                    const targetDir = path.dirname(targetFile.path);
                    translationDatabase.setTargetRoot(targetDir, targetFile.lang);
                }
                
                // Process each destination file
                for (const targetFile of targetFiles) {
                    // Check for cancellation before each file
                    if (token.isCancellationRequested) {
                        throw new vscode.CancellationError();
                    }

                    await fileProcessor.processFile(sourceFile.path, targetFile.path, sourceFile.lang, targetFile.lang);
                    processedFiles++;
                    
                    // Update status bar progress
                    updateProgressStatusBar(`文件 ${processedFiles}/${totalFiles}`);
                }
                
                processedCount++;
            }
            vscode.window.showInformationMessage(`Files translation completed! (${processedFiles}/${totalFiles} files)`);
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                logMessage("⛔ Translation cancelled by user");
                vscode.window.showInformationMessage(`Files translation cancelled! (${processedFiles}/${totalFiles} files translated)`);
                return;
            }
            throw error;
        }
        
        // Output summary
        outputSummary(startTime, fileProcessor, translatorService);
        
        // Send analytics
        const analyticsService = new AnalyticsService(outputChannel, machineId);
        await sendAnalytics(analyticsService, fileProcessor, translatorService);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Files translation failed: ${errorMessage}`);
        logMessage(`❌ Error: ${errorMessage}`);
    } finally {
        cleanup();
    }
}

async function handleTranslateProject() {
    try {
        // 标记进入项目翻译模式
        isProjectTranslation = true;

        // Show and focus output panel
        outputChannel.clear();
        outputChannel.show(true);
        logMessage("==========================================");
		logMessage("Starting project translation");
		logMessage("==========================================\n");

        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a target workspace first");
        }

        // Initialize services
        const translatorService = new TranslatorService(outputChannel);
        await translatorService.initializeOpenAIClient();

        // Get configuration
        const config = await getConfiguration();

        const hasFolders = config.specifiedFolders && config.specifiedFolders.length > 0;
        const hasFiles = config.specifiedFiles && config.specifiedFiles.length > 0;

        // If no tasks configured, show error
        if (!hasFolders && !hasFiles) {
            throw new Error("No translation tasks configured. Please configure either projectTranslator.specifiedFolders or projectTranslator.specifiedFiles in settings.");
        }

        // Reset state
        isPaused = false;
        translatorService.resetTokenCounts();

        // Create cancellation token source for the entire project translation
        cancellationTokenSource = new vscode.CancellationTokenSource();

        // Create status bar buttons
        createStatusBarButtons();

        // Execute translation tasks sequentially
        try {
            if (hasFolders) {
                await handletranslateFolders();
            }
            
            // Check for cancellation before starting files
            if (cancellationTokenSource?.token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }

            if (hasFiles) {
                await handleTranslateFiles();
            }
            
            vscode.window.showInformationMessage("Project translation completed!");
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                logMessage("⛔ Translation cancelled by user");
                vscode.window.showInformationMessage("Project translation cancelled!");
                return;
            }
            throw error;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Translation failed: ${errorMessage}`);
        logMessage(`❌ Error: ${errorMessage}`);
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
        logMessage(`❌ Error: ${errorMessage}`);
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
        logMessage(`❌ Error: ${errorMessage}`);
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

/**
 * Initialize or update the log file manager based on current configuration
 */
async function initializeLogFileManager(): Promise<void> {
    try {
        const config = await getConfiguration();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const workspaceRoot = workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0].uri.fsPath : undefined;

        if (config.debug && config.logFile && config.logFile.enabled) {
            if (logFileManager) {
                // Update existing manager
                logFileManager.updateConfig(config.logFile, workspaceRoot);
            } else {
                // Create new manager
                logFileManager = new LogFileManager(config.logFile, workspaceRoot);
            }
            
            // Log initialization
            const logDir = logFileManager.getLogDirectory();
            logMessage(`Debug log file enabled: ${logFileManager.getCurrentLogFile()}`);
            logFileManager.writeLog(`=== Project Translator Debug Session Started ===`);
            logFileManager.writeLog(`Log directory: ${logDir}`);
            logFileManager.writeLog(`Configuration: ${JSON.stringify(config.logFile, null, 2)}`);
        } else {
            // Disable logging
            if (logFileManager) {
                logFileManager.writeLog(`=== Project Translator Debug Session Ended ===`);
                logFileManager.dispose();
                logFileManager = null;
            }
        }
    } catch (error) {
        logMessage(`Failed to initialize log file manager: ${error}`);
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
        logMessage(`Error closing database: ${error}`);
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
