import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { DiffInfo, DiffStrategy, DiffGranularity } from '../types/types';

/**
 * Git Diff Analysis Service
 * Responsible for detecting file changes and providing diff information
 */
export class GitDiffAnalyzer {
    private outputChannel: vscode.OutputChannel;
    private strategy: DiffStrategy;
    private granularity: DiffGranularity;
    private contextLines: number;

    constructor(
        outputChannel: vscode.OutputChannel,
        strategy: DiffStrategy = 'auto',
        granularity: DiffGranularity = 'line',
        contextLines: number = 3
    ) {
        this.outputChannel = outputChannel;
        this.strategy = strategy;
        this.granularity = granularity;
        this.contextLines = contextLines;
    }

    /**
     * Get file diff information
     * @param filePath File path
     * @param lastCommitId Commit ID from last translation
     * @param strategy Optional strategy parameter, uses constructor strategy if not provided
     * @returns Diff information
     */
    public async getDiffInfo(filePath: string, lastCommitId?: string, strategy?: DiffStrategy): Promise<DiffInfo> {
        const useStrategy = strategy || this.strategy;
        this.outputChannel.appendLine(`🔍 Starting file diff analysis: ${path.basename(filePath)}`);
        
        try {
            // Select diff method based on strategy
            switch (useStrategy) {
                case 'vscode-api':
                    return await this.getDiffUsingVSCodeAPI(filePath, lastCommitId);
                case 'git-command':
                    return await this.getDiffUsingGitCommand(filePath, lastCommitId);
                case 'auto':
                default:
                    // Auto strategy: prioritize VSCode API, fallback to git command on failure
                    try {
                        return await this.getDiffUsingVSCodeAPI(filePath, lastCommitId);
                    } catch (error) {
                        this.outputChannel.appendLine(`⚠️ VSCode API failed, falling back to git command: ${error}`);
                        return await this.getDiffUsingGitCommand(filePath, lastCommitId);
                    }
            }
        } catch (error) {
            this.outputChannel.appendLine(`❌ Diff analysis failed: ${error}`);
            // Return empty diff info, indicating no changes
            return {
                hasChanges: false,
                changedLines: [],
                contextLines: []
            };
        }
    }

    /**
     * Get diff using VS Code Git API
     */
    private async getDiffUsingVSCodeAPI(filePath: string, lastCommitId?: string): Promise<DiffInfo> {
        this.outputChannel.appendLine('📡 Using VS Code Git API for diff detection');

        // Get git extension
        const gitExtension = vscode.extensions.getExtension('vscode.git');
        if (!gitExtension) {
            throw new Error('Git extension not found');
        }

        // Ensure git extension is activated
        if (!gitExtension.isActive) {
            await gitExtension.activate();
        }

        const git = gitExtension.exports.getAPI(1);
        if (!git) {
            throw new Error('Git API unavailable');
        }

        // Find repository containing this file
        const fileUri = vscode.Uri.file(filePath);
        const repository = git.getRepository(fileUri);
        if (!repository) {
            throw new Error('Git repository not found');
        }

        // If no lastCommitId specified, compare with working directory
        if (!lastCommitId) {
            return await this.getWorkingDirectoryDiff(repository, filePath);
        }

        // Compare with specified commit
        return await this.getCommitDiff(repository, filePath, lastCommitId);
    }

    /**
     * Get diff using git command
     */
    private async getDiffUsingGitCommand(filePath: string, lastCommitId?: string): Promise<DiffInfo> {
        this.outputChannel.appendLine('⚡ Using git command for diff detection');

        const workspaceRoot = this.getWorkspaceRoot();
        if (!workspaceRoot) {
            throw new Error('Workspace root directory not found');
        }

        // Build git diff command
        const relativePath = path.relative(workspaceRoot, filePath);
        let gitArgs: string[];

        if (lastCommitId) {
            // Compare with specified commit
            gitArgs = ['diff', '--unified=' + this.contextLines, lastCommitId, 'HEAD', '--', relativePath];
        } else {
            // Compare with staging area
            gitArgs = ['diff', '--unified=' + this.contextLines, 'HEAD', '--', relativePath];
        }

        return new Promise((resolve, reject) => {
            const gitProcess = spawn('git', gitArgs, {
                cwd: workspaceRoot,
                stdio: ['ignore', 'pipe', 'pipe']
            });

            let stdout = '';
            let stderr = '';

            gitProcess.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            gitProcess.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            gitProcess.on('close', (code) => {
                if (code === 0 || code === 1) { // git diff returns 1 when there are differences
                    try {
                        const diffInfo = this.parseUnifiedDiff(stdout);
                        resolve(diffInfo);
                    } catch (parseError) {
                        reject(new Error(`Failed to parse diff output: ${parseError}`));
                    }
                } else {
                    reject(new Error(`Git command failed: ${stderr}`));
                }
            });

            gitProcess.on('error', (error) => {
                reject(new Error(`Failed to execute git command: ${error.message}`));
            });
        });
    }

    /**
     * Get working directory diff (compare with HEAD)
     */
    private async getWorkingDirectoryDiff(repository: any, filePath: string): Promise<DiffInfo> {
        // Note: This is a simplified implementation, actual implementation requires more complex logic for VS Code git API
        // Currently serves as a fallback for git command
        this.outputChannel.appendLine('📋 Detecting working directory diff');
        
        // Temporarily return empty diff, actual implementation requires more VSCode git API calls
        return {
            hasChanges: false,
            changedLines: [],
            contextLines: []
        };
    }

    /**
     * Get diff with specified commit
     */
    private async getCommitDiff(repository: any, filePath: string, commitId: string): Promise<DiffInfo> {
        this.outputChannel.appendLine(`📊 Detecting diff with commit ${commitId.substring(0, 8)}...`);
        
        // Temporarily return empty diff, actual implementation requires more VSCode git API calls
        return {
            hasChanges: false,
            changedLines: [],
            contextLines: []
        };
    }

    /**
     * Parse unified diff format
     */
    private parseUnifiedDiff(diffOutput: string): DiffInfo {
        if (!diffOutput.trim()) {
            return {
                hasChanges: false,
                changedLines: [],
                contextLines: []
            };
        }

        const lines = diffOutput.split('\n');
        const changedLines: DiffInfo['changedLines'] = [];
        const contextLines: DiffInfo['contextLines'] = [];
        let currentLineNumber = 0;

        for (const line of lines) {
            // Skip diff header information
            if (line.startsWith('diff --git') || 
                line.startsWith('index ') || 
                line.startsWith('---') || 
                line.startsWith('+++')) {
                continue;
            }

            // Handle hunk header (@@ format)
            const hunkMatch = line.match(/^@@\s+-(\d+),?\d*\s+\+(\d+),?\d*\s+@@/);
            if (hunkMatch) {
                currentLineNumber = parseInt(hunkMatch[2]);
                continue;
            }

            // Handle changed lines
            if (line.startsWith('+') && !line.startsWith('+++')) {
                changedLines.push({
                    lineNumber: currentLineNumber,
                    oldContent: '',
                    newContent: line.substring(1),
                    changeType: 'added'
                });
                currentLineNumber++;
            } else if (line.startsWith('-') && !line.startsWith('---')) {
                changedLines.push({
                    lineNumber: currentLineNumber,
                    oldContent: line.substring(1),
                    newContent: '',
                    changeType: 'deleted'
                });
            } else if (line.startsWith(' ')) {
                // Context lines
                contextLines.push({
                    lineNumber: currentLineNumber,
                    content: line.substring(1)
                });
                currentLineNumber++;
            }
        }

        return {
            hasChanges: changedLines.length > 0,
            changedLines,
            contextLines
        };
    }

    /**
     * Get workspace root directory
     */
    private getWorkspaceRoot(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        return workspaceFolders && workspaceFolders.length > 0 
            ? workspaceFolders[0].uri.fsPath 
            : undefined;
    }

    /**
     * Update configuration
     */
    public updateConfig(strategy: DiffStrategy, granularity: DiffGranularity, contextLines: number): void {
        this.strategy = strategy;
        this.granularity = granularity;
        this.contextLines = contextLines;
        this.outputChannel.appendLine(`🔧 Updated diff analysis config: strategy=${strategy}, granularity=${granularity}, contextLines=${contextLines}`);
    }
}
