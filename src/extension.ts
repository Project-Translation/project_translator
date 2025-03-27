import * as vscode from "vscode";
import * as path from "path";
import { TranslationDatabase } from "./translationDatabase";
import { FileProcessor } from "./services/fileProcessor";
import { TranslatorService } from "./services/translatorService";
import { AnalyticsService } from "./services/analytics";
import { getConfiguration } from "./config/config";
import { DestFolder, DestFile, SupportedLanguage } from "./types/types";
import * as fs from "fs";

// Global state
let translationDb: TranslationDatabase | null = null;
let isPaused = false;
let pauseResumeButton: vscode.StatusBarItem | undefined;
let stopButton: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel;
let machineId: string | undefined;
const translations: any = {};

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

    return [
        translateProjectCommand,
        translateFoldersCommand,
        translateFilesCommand,
        pauseCommand,
        resumeCommand,
        stopCommand
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
        const specifiedFolders = config.get<Array<any>>("specifiedFolders") || [];
        if (specifiedFolders.length === 0) {
            throw new Error("No folder groups configured. Please configure projectTranslator.specifiedFolders in settings.");
        }

        // Initialize database and ensure it exists
        const translationDatabase = new TranslationDatabase(workspace.uri.fsPath);
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
                        const destFolders = folderGroup.destFolders;

                        if (!sourceFolder?.path || !sourceFolder?.lang || !destFolders?.length) {
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
                        destFolders.forEach((target: DestFolder) => translationDatabase.setTargetRoot(target.path, target.lang));

                        // Process this folder group
                        await fileProcessor.processDirectory(sourceFolder.path, destFolders, sourceFolder.lang);

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
        const translationDatabase = new TranslationDatabase(workspace.uri.fsPath);
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
                fileGroup.destFiles && fileGroup.destFiles.length > 0) {
                totalFiles += fileGroup.destFiles.length;
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
                    const destFiles = fileGroup.destFiles;
                    
                    if (!sourceFile || !sourceFile.path || !destFiles || destFiles.length === 0) {
                        outputChannel.appendLine(`⚠️ Skipping invalid file group configuration`);
                        continue;
                    }
                    
                    outputChannel.appendLine(`\n📄 Processing source file: ${sourceFile.path}`);
                    
                    // Set source directory and language for this file
                    const sourceDir = path.dirname(sourceFile.path);
                    translationDatabase.setSourceRoot(sourceDir);
                    
                    // Register target directories
                    for (const destFile of destFiles) {
                        const targetDir = path.dirname(destFile.path);
                        translationDatabase.setTargetRoot(targetDir, destFile.lang);
                    }
                    
                    // Process each destination file
                    for (const destFile of destFiles) {
                        outputChannel.appendLine(`  🔄 Translating to ${destFile.lang}: ${destFile.path}`);
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
        const specifiedFolders = vscode.workspace.getConfiguration("projectTranslator").get<Array<any>>("specifiedFolders") || [];
        if (specifiedFolders.length > 0) {
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

async function getSourceFolderPath(): Promise<string> {
    const config = vscode.workspace.getConfiguration("projectTranslator");
    const specifiedFolders = config.get<Array<any>>("specifiedFolders") || [];
    
    if (specifiedFolders.length === 0 || !specifiedFolders[0].sourceFolder?.path) {
        throw new Error("No source folder configured. Please configure projectTranslator.specifiedFolders in settings.");
    }

    return specifiedFolders[0].sourceFolder.path;
}

async function getTargetPaths(): Promise<DestFolder[]> {
    const config = vscode.workspace.getConfiguration("projectTranslator");
    const specifiedFolders = config.get<Array<any>>("specifiedFolders") || [];
    
    if (specifiedFolders.length === 0 || !specifiedFolders[0].destFolders?.length) {
        throw new Error("No destination folders configured. Please configure projectTranslator.specifiedFolders in settings.");
    }

    return specifiedFolders[0].destFolders;
}

function createStatusBarButtons() {
    pauseResumeButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        1
    );
    stopButton = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        0
    );

    updatePauseResumeButton();
    stopButton.text = "$(debug-stop) Stop Translation";
    stopButton.command = "extension.stopTranslation";
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
    const stats = fileProcessor.getProcessingStats();
    const tokenCounts = translatorService.getTokenCounts();

    const settingsToCollect = {
        sourceFolder: config.get('sourceFolder'),
        destFolders: config.get('destFolders'),
        translationIntervalDays: config.get('translationIntervalDays'),
        ignoreTranslationExtensions: config.get('ignoreTranslationExtensions'),
        ignorePaths: config.get('ignorePaths'),
        currentVendor: config.get('currentVendor'),
        vendors: config.get('vendors'),
        systemPrompts: config.get('systemPrompts'),
        userPrompts: config.get('userPrompts'),
        segmentationMarkers: config.get('segmentationMarkers'),
        stats: {
            processedFiles: stats.processedFiles,
            skippedFiles: stats.skippedFiles,
            failedFiles: stats.failedFiles,
            totalInputTokens: tokenCounts.inputTokens,
            totalOutputTokens: tokenCounts.outputTokens,
            tokensPerMinute: Math.round(tokenCounts.totalTokens / 60)
        }
    };

    await analyticsService.sendSettingsData(settingsToCollect);
}

function cleanup() {
    translationDb?.close().catch((error) => {
        outputChannel.appendLine(`Error closing database: ${error}`);
    });
    translationDb = null;

    pauseResumeButton?.dispose();
    pauseResumeButton = undefined;
    stopButton?.dispose();
    stopButton = undefined;
}

export function deactivate(): void {
    cleanup();
    outputChannel.dispose();
}
