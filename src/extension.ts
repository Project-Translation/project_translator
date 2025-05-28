import * as vscode from "vscode";
import * as path from "path";
import { TranslationDatabase } from "./translationDatabase";
import { FileProcessor } from "./services/fileProcessor";
import { TranslatorService } from "./services/translatorService";
import { AnalyticsService } from "./services/analytics";
import { getConfiguration, exportSettingsToConfigFile } from "./config/config";
import { DestFolder, SpecifiedFolder } from "./types/types";
import * as fs from "fs";

// Global state
let translationDb: TranslationDatabase | null = null;
let isPaused = false;
let pauseResumeButton: vscode.StatusBarItem | undefined;
let stopButton: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel;
let machineId: string | undefined;

export async function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("Project Translator");
    outputChannel.appendLine(vscode.l10n.t("extension.activated"));

    // Initialize machine ID
    machineId = await AnalyticsService.getMachineId();

    // Register commands
    const commands = registerCommands();
    context.subscriptions.push(...commands);
}

function registerCommands(): vscode.Disposable[] {
    // Pause translation command
    const pauseCommand = vscode.commands.registerCommand(
        "extension.pauseTranslation",
        () => {
            isPaused = true;
            outputChannel.appendLine(vscode.l10n.t("status.translation.paused"));
            vscode.window.showInformationMessage(vscode.l10n.t("status.translation.paused"));
            updatePauseResumeButton();
        }
    );

    // Resume translation command
    const resumeCommand = vscode.commands.registerCommand(
        "extension.resumeTranslation",
        () => {
            isPaused = false;
            outputChannel.appendLine(vscode.l10n.t("status.translation.resumed"));
            vscode.window.showInformationMessage(vscode.l10n.t("status.translation.resumed"));
            updatePauseResumeButton();
        }
    );

    // Stop translation command
    const stopCommand = vscode.commands.registerCommand(
        "extension.stopTranslation",
        () => {
            // We no longer need to set isStopped, VS Code will trigger cancellation
            outputChannel.appendLine(vscode.l10n.t("status.translation.stopped"));
            vscode.window.showInformationMessage(vscode.l10n.t("status.translation.stopped"));
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

    return [
        translateProjectCommand,
        translateFoldersCommand,
        translateFilesCommand,
        pauseCommand,
        resumeCommand,
        stopCommand,
        addFileCommand,
        addFolderCommand,
        exportSettingsCommand
    ];
}

async function handletranslateFolders() {
    try {
        // Show and focus output panel
        outputChannel.clear();
        outputChannel.show(true);
        outputChannel.appendLine("==========================================");
        outputChannel.appendLine("Starting folders translation task");
        outputChannel.appendLine("==========================================\n");

        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a target workspace first");
        }

        // Initialize services
        const translatorService = new TranslatorService(outputChannel);
        translatorService.initializeOpenAIClient();

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

        // Create status bar buttons
        createStatusBarButtons();

        // Reset state
        isPaused = false;
        translatorService.resetTokenCounts();

        // Record start time
        const startTime = Date.now();

        // Process with progress
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Translating folders...",
                cancellable: true,
            },
            async (progress, token) => {
                fileProcessor.setTranslationState(isPaused, token);

                const totalFolderGroups = specifiedFolders.length;
                let processedGroups = 0;

                try {
                    for (const folderGroup of specifiedFolders) {
                        const sourceFolder = folderGroup.sourceFolder;
                        const targetFolders = folderGroup.targetFolders;

                        if (!sourceFolder?.path || !sourceFolder?.lang || !targetFolders?.length) {
                            outputChannel.appendLine(`⚠️ Skipping invalid folder group configuration`);
                            continue;
                        }

                        outputChannel.appendLine(`\n📂 Processing source folder: ${sourceFolder.path}`);

                        // Use absolute path for source folder
                        if (!path.isAbsolute(sourceFolder.path)) {
                            sourceFolder.path = path.join(workspace.uri.fsPath, sourceFolder.path);
                        }
                        if (!fs.existsSync(sourceFolder.path)) {
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
                        progress.report({
                            message: `Processed ${processedGroups} of ${totalFolderGroups} folder groups (${totalFilesProcessed} files)`,
                            increment: (1 / totalFolderGroups) * 100
                        });
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
                        
                        outputChannel.appendLine("⛔ Translation cancelled by user");
                        vscode.window.showInformationMessage(`Folders translation cancelled! (${totalProcessed} files processed)`);
                        return;
                    }
                    throw error;
                }
            }
        );

        // Output summary
        outputSummary(startTime, fileProcessor, translatorService);

        // Send analytics
        const analyticsService = new AnalyticsService(outputChannel, machineId);
        await sendAnalytics(analyticsService, fileProcessor, translatorService);

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Translation failed: ${errorMessage}`);
        outputChannel.appendLine(`❌ Error: ${errorMessage}`);
    } finally {
        cleanup();
    }
}

async function handleTranslateFiles() {
    try {
        // Show and focus output panel
        outputChannel.clear();
        outputChannel.show(true);
        outputChannel.appendLine("==========================================");
        outputChannel.appendLine("Starting files translation task");
        outputChannel.appendLine("==========================================\n");

        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a workspace first");
        }

        // Initialize services
        const translatorService = new TranslatorService(outputChannel);
        translatorService.initializeOpenAIClient();

        // Get the configuration
        const config = getConfiguration();
        
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
        
        outputChannel.appendLine(`📊 Found ${totalFiles} files to translate`);

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Translating specified files...",
            cancellable: true
        }, async (progress, token) => {
            fileProcessor.setTranslationState(isPaused, token);
            
            const totalCount = specifiedFiles.length;
            let processedCount = 0;
            let processedFiles = 0;

            try {            
                for (const fileGroup of specifiedFiles) {
                    const sourceFile = fileGroup.sourceFile;
                    const targetFiles = fileGroup.targetFiles;
                    
                    if (!sourceFile || !sourceFile.path || !targetFiles || targetFiles.length === 0) {
                        outputChannel.appendLine(`⚠️ Skipping invalid file group configuration`);
                        continue;
                    }
                    
                    outputChannel.appendLine(`\n📄 Processing source file: ${sourceFile.path}`);
                    
                    // Set source directory and language for this file
                    const sourceDir = path.dirname(sourceFile.path);
                    translationDatabase.setSourceRoot(sourceDir);
                    
                    // Register target directories
                    for (const destFile of targetFiles) {
                        const targetDir = path.dirname(destFile.path);
                        translationDatabase.setTargetRoot(targetDir, destFile.lang);
                    }
                    
                    // Process each destination file
                    for (const destFile of targetFiles) {
                        await fileProcessor.processFile(sourceFile.path, destFile.path, sourceFile.lang, destFile.lang);
                        processedFiles++;
                        
                        // Update progress with both file groups and individual files
                        progress.report({ 
                            message: `Processed ${processedCount+1}/${totalCount} file groups (${processedFiles}/${totalFiles} files)`,
                            increment: (1 / totalFiles) * 100
                        });
                    }
                    
                    processedCount++;
                }
                vscode.window.showInformationMessage(`Files translation completed! (${processedFiles}/${totalFiles} files)`);
            } catch (error) {
                if (error instanceof vscode.CancellationError) {
                    outputChannel.appendLine("⛔ Translation cancelled by user");
                    vscode.window.showInformationMessage(`Files translation cancelled! (${processedFiles}/${totalFiles} files translated)`);
                    return;
                }
                throw error;
            }
        });
        
        // Output summary
        outputSummary(startTime, fileProcessor, translatorService);
        
        // Send analytics
        const analyticsService = new AnalyticsService(outputChannel, machineId);
        await sendAnalytics(analyticsService, fileProcessor, translatorService);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Files translation failed: ${errorMessage}`);
        outputChannel.appendLine(`❌ Error: ${errorMessage}`);
    } finally {
        cleanup();
    }
}

async function handleTranslateProject() {
    try {
        // Show and focus output panel
        outputChannel.clear();
        outputChannel.show(true);
        outputChannel.appendLine("==========================================");
        outputChannel.appendLine("Starting project translation");
        outputChannel.appendLine("==========================================\n");

        const workspace = vscode.workspace.workspaceFolders?.[0];
        if (!workspace) {
            throw new Error("Please open a target workspace first");
        }

        // Initialize services
        const translatorService = new TranslatorService(outputChannel);
        translatorService.initializeOpenAIClient();

        // Get configuration
        const config = getConfiguration();
        const translationTasks = [];

        // Add folder translation task if specifiedFolders is configured
        if (config.specifiedFolders && config.specifiedFolders.length > 0) {
            translationTasks.push(handletranslateFolders());
        }

        // Add file translation task if specifiedFiles is configured
        if (config.specifiedFiles && config.specifiedFiles.length > 0) {
            translationTasks.push(handleTranslateFiles());
        }

        // If no tasks configured, show error
        if (translationTasks.length === 0) {
            throw new Error("No translation tasks configured. Please configure either projectTranslator.specifiedFolders or projectTranslator.specifiedFiles in settings.");
        }

        // Reset state
        isPaused = false;
        translatorService.resetTokenCounts();

        // Create status bar buttons
        createStatusBarButtons();

        // Execute all translation tasks
        try {
            await Promise.all(translationTasks);
            vscode.window.showInformationMessage("Project translation completed!");
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                outputChannel.appendLine("⛔ Translation cancelled by user");
                vscode.window.showInformationMessage("Project translation cancelled!");
                return;
            }
            throw error;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Translation failed: ${errorMessage}`);
        outputChannel.appendLine(`❌ Error: ${errorMessage}`);
    } finally {
        cleanup();
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
        if (!fs.existsSync(fileUri.fsPath)) {
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
            outputChannel.appendLine(`File already exists in translation settings: ${relativePath}`);
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
        outputChannel.appendLine(`Added file to translation settings: ${relativePath} → ${targetPath}`);
        vscode.window.showInformationMessage(`Added file to translation settings: ${relativePath} → ${targetPath}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Failed to add file to translation settings: ${errorMessage}`);
        outputChannel.appendLine(`❌ Error: ${errorMessage}`);
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
        if (!fs.existsSync(folderUri.fsPath) || !fs.statSync(folderUri.fsPath).isDirectory()) {
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
            outputChannel.appendLine(`Folder already exists in translation settings: ${relativePath}`);
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
        outputChannel.appendLine(`Added folder to translation settings: ${relativePath} → ${targetPath}`);
        vscode.window.showInformationMessage(`Added folder to translation settings: ${relativePath} → ${targetPath}`);
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        vscode.window.showErrorMessage(`Failed to add folder to translation settings: ${errorMessage}`);
        outputChannel.appendLine(`❌ Error: ${errorMessage}`);
    }
}

function createStatusBarButtons() {
    // Only create pause/resume button if it doesn't exist
    if (!pauseResumeButton) {
        pauseResumeButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            1
        );
    }

    // Only create stop button if it doesn't exist
    if (!stopButton) {
        stopButton = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            0
        );
        stopButton.text = "$(debug-stop) Stop Translation";
        stopButton.command = "extension.stopTranslation";
    }

    updatePauseResumeButton();
    stopButton.show();
}

function updatePauseResumeButton() {
    if (pauseResumeButton) {
        if (isPaused) {
            pauseResumeButton.text = "$(debug-continue) Resume Translation";
            pauseResumeButton.command = "extension.resumeTranslation";
        } else {
            pauseResumeButton.text = "$(debug-pause) Pause Translation";
        }
        pauseResumeButton.show();
    }
}

function hideTranslationButtons() {
    pauseResumeButton?.hide();
    stopButton?.hide();
}

function outputSummary(startTime: number, fileProcessor: FileProcessor, translatorService: TranslatorService) {
    const endTime = Date.now();
    const totalTimeInSeconds = ((endTime - startTime) / 1000).toFixed(2);
    const stats = fileProcessor.getProcessingStats();
    const tokenCounts = translatorService.getTokenCounts();

    outputChannel.appendLine("\n==========================================");
    outputChannel.appendLine("Translation Task Summary");
    outputChannel.appendLine("==========================================");
    outputChannel.appendLine(`✅ Translated files: ${stats.processedFiles}`);
    outputChannel.appendLine(`⏭️ Skipped files: ${stats.skippedFiles}`);
    outputChannel.appendLine(`❌ Failed files: ${stats.failedFiles}`);

    if (stats.failedFiles > 0 && stats.failedPaths.length > 0) {
        outputChannel.appendLine("\n❌ Failed files list:");
        stats.failedPaths.forEach((filePath, index) => {
            outputChannel.appendLine(`   ${index + 1}. ${filePath}`);
        });
        outputChannel.appendLine("");
    }

    outputChannel.appendLine(`⌛ Total time: ${totalTimeInSeconds} seconds`);
    outputChannel.appendLine(`📊 Total tokens consumed:`);
    outputChannel.appendLine(`   - Input: ${tokenCounts.inputTokens.toLocaleString()} tokens`);
    outputChannel.appendLine(`   - Output: ${tokenCounts.outputTokens.toLocaleString()} tokens`);
    outputChannel.appendLine(`   - Total: ${tokenCounts.totalTokens.toLocaleString()} tokens`);

    const tokensPerMinute = Math.round(tokenCounts.totalTokens / (Number(totalTimeInSeconds) / 60));
    if (!isNaN(tokensPerMinute) && isFinite(tokensPerMinute)) {
        outputChannel.appendLine(`   - Processing speed: ${tokensPerMinute.toLocaleString()} tokens/minute`);
    }
}

async function sendAnalytics(analyticsService: AnalyticsService, fileProcessor: FileProcessor, translatorService: TranslatorService) {
    const config = vscode.workspace.getConfiguration('projectTranslator');
    await analyticsService.sendSettingsData(config);
}

function cleanup() {
    translationDb?.close().catch((error) => {
        outputChannel.appendLine(`Error closing database: ${error}`);
    });
    translationDb = null;

    // Hide buttons before disposing
    hideTranslationButtons();
    
    pauseResumeButton?.dispose();
    pauseResumeButton = undefined;
    stopButton?.dispose();
    stopButton = undefined;
}

export function deactivate(): void {
    cleanup();
    outputChannel.dispose();
}
