import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { DiffInfo, TranslationDiffResult } from '../types/types';

/**
 * Diff Application Service
 * Responsible for precisely applying translation results to target files
 */
export class DiffApplier {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    /**
     * Apply translation diff to target file
     * @param sourcePath Source file path
     * @param targetPath Target file path
     * @param diffInfo Diff information
     * @param translatedContents Array of translated content
     * @returns Application result
     */
    public async applyTranslationDiff(
        sourcePath: string,
        targetPath: string,
        diffInfo: DiffInfo,
        translatedContents: string[]
    ): Promise<TranslationDiffResult> {
        try {
            this.outputChannel.appendLine(`🔧 Starting to apply translation diff to: ${path.basename(targetPath)}`);

            // Ensure the target directory exists
            const targetDir = path.dirname(targetPath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
                this.outputChannel.appendLine(`📁 Created target directory: ${targetDir}`);
            }

            // Read the source file content
            const sourceContent = fs.readFileSync(sourcePath, 'utf8');
            let targetContent = '';

            // If the target file exists, read its content as the base
            if (fs.existsSync(targetPath)) {
                targetContent = fs.readFileSync(targetPath, 'utf8');
                this.outputChannel.appendLine("📖 Read existing target file content");
            } else {
                // If the target file does not exist, use the source file content as the base
                targetContent = sourceContent;
                this.outputChannel.appendLine("📄 Using source file content as base");
            }

            // Apply the diff
            const result = await this.applyChangesToContent(
                targetContent,
                diffInfo,
                translatedContents
            );

            if (result.success) {
                // Write to the target file
                fs.writeFileSync(targetPath, result.finalContent!, 'utf8');
                this.outputChannel.appendLine("💾 Successfully wrote translation result");

                return {
                    success: true,
                    translatedChanges: result.appliedChanges!
                };
            } else {
                return {
                    success: false,
                    translatedChanges: [],
                    error: result.error
                };
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.outputChannel.appendLine(`❌ Failed to apply translation diff: ${errorMessage}`);
            
            return {
                success: false,
                translatedChanges: [],
                error: errorMessage
            };
        }
    }

    /**
     * Apply translated diffs to content
     */
    private async applyChangesToContent(
        baseContent: string,
        diffInfo: DiffInfo,
        translatedContents: string[]
    ): Promise<{
        success: boolean;
        finalContent?: string;
        appliedChanges?: Array<{
            lineNumber: number;
            translatedContent: string;
            changeType: 'added' | 'deleted' | 'modified';
        }>;
        error?: string;
    }> {
        try {
            const lines = baseContent.split('\n');
            const appliedChanges: Array<{
                lineNumber: number;
                translatedContent: string;
                changeType: 'added' | 'deleted' | 'modified';
            }> = [];

            let translatedIndex = 0;

            // Process changes in reverse line order to avoid line number shifting issues
            const sortedChanges = [...diffInfo.changedLines].sort((a, b) => b.lineNumber - a.lineNumber);

            for (const change of sortedChanges) {
                const lineIndex = Math.max(0, change.lineNumber - 1);

                switch (change.changeType) {
                    case 'added':
                        if (translatedIndex < translatedContents.length) {
                            const translatedContent = translatedContents[translatedIndex++];
                            lines.splice(lineIndex, 0, translatedContent);
                            
                            appliedChanges.push({
                                lineNumber: change.lineNumber,
                                translatedContent,
                                changeType: 'added'
                            });
                            
                            this.outputChannel.appendLine(`➕ Added line ${change.lineNumber}: ${translatedContent.substring(0, 50)}${translatedContent.length > 50 ? '...' : ''}`);
                        }
                        break;

                    case 'modified':
                        if (translatedIndex < translatedContents.length && lineIndex < lines.length) {
                            const translatedContent = translatedContents[translatedIndex++];
                            lines[lineIndex] = translatedContent;
                            
                            appliedChanges.push({
                                lineNumber: change.lineNumber,
                                translatedContent,
                                changeType: 'modified'
                            });
                            
                            this.outputChannel.appendLine(`🔄 Modified line ${change.lineNumber}: ${translatedContent.substring(0, 50)}${translatedContent.length > 50 ? '...' : ''}`);
                        }
                        break;

                    case 'deleted':
                        if (lineIndex < lines.length) {
                            const deletedContent = lines[lineIndex];
                            lines.splice(lineIndex, 1);
                            
                            appliedChanges.push({
                                lineNumber: change.lineNumber,
                                translatedContent: '', // Deleted content is empty
                                changeType: 'deleted'
                            });
                            
                            this.outputChannel.appendLine(`➖ Deleted line ${change.lineNumber}: ${deletedContent.substring(0, 50)}${deletedContent.length > 50 ? '...' : ''}`);
                        }
                        break;
                }
            }

            // Handle context lines if needed
            // Context lines usually do not require translation, but may need formatting consistency
            for (const contextLine of diffInfo.contextLines) {
                // Context lines remain unchanged; formatting logic can be added here if needed
            }

            const finalContent = lines.join('\n');
            
            return {
                success: true,
                finalContent,
                appliedChanges
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                success: false,
                error: `Failed to apply content: ${errorMessage}`
            };
        }
    }

    /**
     * Validate the integrity of the application result
     * @param originalDiffInfo Original diff information
     * @param appliedChanges Applied changes
     * @returns Validation result
     */
    public validateApplication(
        originalDiffInfo: DiffInfo,
        appliedChanges: Array<{
            lineNumber: number;
            translatedContent: string;
            changeType: 'added' | 'deleted' | 'modified';
        }>
    ): { isValid: boolean; issues: string[] } {
        const issues: string[] = [];

        // Check if the number of changes matches
        const expectedChanges = originalDiffInfo.changedLines.filter(
            change => change.changeType === 'added' || change.changeType === 'modified'
        ).length;
        
        const actualChanges = appliedChanges.filter(
            change => change.changeType === 'added' || change.changeType === 'modified'
        ).length;

        if (expectedChanges !== actualChanges) {
            issues.push(`Number of changes does not match: expected ${expectedChanges}, actual ${actualChanges}`);
        }

        // Check if line numbers match
        for (const originalChange of originalDiffInfo.changedLines) {
            const appliedChange = appliedChanges.find(
                change => change.lineNumber === originalChange.lineNumber && 
                         change.changeType === originalChange.changeType
            );

            if (!appliedChange && originalChange.changeType !== 'deleted') {
                issues.push(`Missing change: line ${originalChange.lineNumber} (${originalChange.changeType})`);
            }
        }

        return {
            isValid: issues.length === 0,
            issues
        };
    }

    /**
     * Create a backup before applying the diff
     * @param targetPath Target file path
     * @returns Backup file path
     */
    public createBackup(targetPath: string): string | null {
        try {
            if (!fs.existsSync(targetPath)) {
                return null; // File does not exist, no backup needed
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = `${targetPath}.backup.${timestamp}`;
            
            fs.copyFileSync(targetPath, backupPath);
            this.outputChannel.appendLine(`💾 Created backup file: ${path.basename(backupPath)}`);
            
            return backupPath;
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ Failed to create backup: ${error}`);
            return null;
        }
    }

    /**
     * Restore from backup file
     * @param targetPath Target file path
     * @param backupPath Backup file path
     * @returns Whether restore was successful
     */
    public restoreFromBackup(targetPath: string, backupPath: string): boolean {
        try {
            if (!fs.existsSync(backupPath)) {
                this.outputChannel.appendLine(`❌ Backup file does not exist: ${backupPath}`);
                return false;
            }

            fs.copyFileSync(backupPath, targetPath);
            this.outputChannel.appendLine(`🔄 Restored file from backup: ${path.basename(targetPath)}`);
            
            // Delete the backup file
            fs.unlinkSync(backupPath);
            this.outputChannel.appendLine(`🗑️ Deleted backup file: ${path.basename(backupPath)}`);
            
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`❌ Failed to restore from backup: ${error}`);
            return false;
        }
    }
}
