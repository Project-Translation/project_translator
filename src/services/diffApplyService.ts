import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { DiffOperation, DiffApplyRequest, DiffApplyResponse, DiffApplyConfig, SupportedLanguage } from "../types/types";
import { logMessage } from "../extension";
import { getConfiguration } from "../config/config";

export class DiffApplyService {
    private outputChannel: vscode.OutputChannel;
    private workspaceRoot: string | null = null;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            this.workspaceRoot = workspaceFolders[0].uri.fsPath;
        }
    }

    /**
     * Create a diff apply request for translation
     */
    public createDiffApplyRequest(
        sourceFilePath: string,
        targetFilePath: string,
        sourceLang: SupportedLanguage,
        targetLang: SupportedLanguage
    ): DiffApplyRequest | null {
        try {
            // Read source file
            if (!fs.existsSync(sourceFilePath)) {
                logMessage(`❌ Source file not found: ${sourceFilePath}`);
                return null;
            }

            const sourceContent = fs.readFileSync(sourceFilePath, 'utf-8');
            
            // Read target file (if exists)
            let targetContent = '';
            if (fs.existsSync(targetFilePath)) {
                targetContent = fs.readFileSync(targetFilePath, 'utf-8');
            }

            const request: DiffApplyRequest = {
                operation: 'diff_apply_translation',
                source_language: sourceLang,
                target_language: targetLang,
                source_document: {
                    path: sourceFilePath,
                    content: sourceContent
                },
                target_document: {
                    path: targetFilePath,
                    content: targetContent
                }
            };

            return request;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logMessage(`❌ Failed to create diff apply request: ${errorMessage}`);
            return null;
        }
    }

    /**
     * Parse AI response and extract diff operations
     */
    public parseDiffApplyResponse(aiResponse: string): DiffApplyResponse {
        try {
            // Try to extract JSON from the response
            const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return {
                    status: 'error',
                    error_message: 'No valid JSON found in AI response'
                };
            }

            const parsed = JSON.parse(jsonMatch[0]) as DiffApplyResponse;
            
            // Validate the response structure
            if (!this.validateDiffApplyResponse(parsed)) {
                return {
                    status: 'error',
                    error_message: 'Invalid response structure from AI'
                };
            }

            return parsed;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                status: 'error',
                error_message: `Failed to parse AI response: ${errorMessage}`
            };
        }
    }

    /**
     * Apply diff operations to a target file
     */
    public async applyDiffOperations(
        targetFilePath: string,
        operations: DiffOperation[],
        config: DiffApplyConfig
    ): Promise<boolean> {
        try {
            // Create backup if enabled
            if (config.autoBackup) {
                await this.createBackup(targetFilePath);
            }

            // Read current file content
            let fileContent = '';
            if (fs.existsSync(targetFilePath)) {
                fileContent = fs.readFileSync(targetFilePath, 'utf-8');
            }

            const lines = fileContent.split('\n');
            
            // Sort operations by line number in descending order to avoid index shifting
            const sortedOps = [...operations].sort((a, b) => b.line_number - a.line_number);

            // Apply operations
            for (const operation of sortedOps) {
                if (!this.validateOperation(operation, lines, config.validationLevel)) {
                    logMessage(`⚠️ Skipping invalid operation at line ${operation.line_number}`);
                    continue;
                }

                switch (operation.type) {
                    case 'update':
                        await this.applyUpdateOperation(lines, operation);
                        break;
                    case 'insert':
                        await this.applyInsertOperation(lines, operation);
                        break;
                    case 'delete':
                        await this.applyDeleteOperation(lines, operation);
                        break;
                }
            }

            // Write updated content back to file
            const updatedContent = lines.join('\n');
            
            // Ensure target directory exists
            const targetDir = path.dirname(targetFilePath);
            if (!fs.existsSync(targetDir)) {
                fs.mkdirSync(targetDir, { recursive: true });
            }

            fs.writeFileSync(targetFilePath, updatedContent, 'utf-8');
            
            logMessage(`✅ Successfully applied ${operations.length} diff operations to ${targetFilePath}`);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logMessage(`❌ Failed to apply diff operations: ${errorMessage}`);
            return false;
        }
    }

    /**
     * Validate diff apply response structure
     */
    private validateDiffApplyResponse(response: any): response is DiffApplyResponse {
        if (!response || typeof response !== 'object') {
            return false;
        }

        if (!['success', 'error', 'no_changes'].includes(response.status)) {
            return false;
        }

        if (response.status === 'success' && response.operations) {
            if (!Array.isArray(response.operations)) {
                return false;
            }

            for (const op of response.operations) {
                if (!this.validateDiffOperation(op)) {
                    return false;
                }
            }
        }

        return true;
    }

    /**
     * Validate a single diff operation
     */
    private validateDiffOperation(operation: any): operation is DiffOperation {
        if (!operation || typeof operation !== 'object') {
            return false;
        }

        if (!['update', 'insert', 'delete'].includes(operation.type)) {
            return false;
        }

        if (typeof operation.line_number !== 'number' || operation.line_number < 0) {
            return false;
        }

        // Type-specific validations
        switch (operation.type) {
            case 'update':
                return typeof operation.new_content === 'string' || typeof operation.content === 'string';
            case 'insert':
                return typeof operation.content === 'string';
            case 'delete':
                return true; // line_number is sufficient for delete
        }

        return false;
    }

    /**
     * Validate operation against current file state
     */
    private validateOperation(
        operation: DiffOperation,
        lines: string[],
        validationLevel: 'strict' | 'normal' | 'loose'
    ): boolean {
        const lineIndex = operation.line_number - 1; // Convert to 0-based index

        switch (validationLevel) {
            case 'strict':
                // Strict validation: check line content matches
                if (operation.type === 'update' && operation.old_content) {
                    return lineIndex < lines.length && lines[lineIndex] === operation.old_content;
                }
                if (operation.type === 'delete' && operation.content) {
                    return lineIndex < lines.length && lines[lineIndex] === operation.content;
                }
                return lineIndex <= lines.length;

            case 'normal':
                // Normal validation: check line exists for update/delete
                if (operation.type === 'update' || operation.type === 'delete') {
                    return lineIndex < lines.length;
                }
                return lineIndex <= lines.length;

            case 'loose':
                // Loose validation: minimal checks
                return operation.line_number > 0;

            default:
                return false;
        }
    }

    /**
     * Apply update operation
     */
    private async applyUpdateOperation(lines: string[], operation: DiffOperation): Promise<void> {
        const lineIndex = operation.line_number - 1;
        const newContent = operation.new_content || operation.content;
        if (lineIndex < lines.length && newContent !== undefined) {
            lines[lineIndex] = newContent;
            logMessage(`🔄 Updated line ${operation.line_number}`);
        }
    }

    /**
     * Apply insert operation
     */
    private async applyInsertOperation(lines: string[], operation: DiffOperation): Promise<void> {
        const lineIndex = operation.line_number - 1;
        if (operation.content !== undefined) {
            lines.splice(lineIndex, 0, operation.content);
            logMessage(`➕ Inserted content at line ${operation.line_number}`);
        }
    }

    /**
     * Apply delete operation
     */
    private async applyDeleteOperation(lines: string[], operation: DiffOperation): Promise<void> {
        const lineIndex = operation.line_number - 1;
        if (lineIndex < lines.length) {
            lines.splice(lineIndex, 1);
            logMessage(`➖ Deleted line ${operation.line_number}`);
        }
    }

    /**
     * Create backup of target file
     */
    private async createBackup(filePath: string): Promise<void> {
        if (!fs.existsSync(filePath)) {
            return;
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupPath = `${filePath}.backup.${timestamp}`;
        
        try {
            fs.copyFileSync(filePath, backupPath);
            logMessage(`💾 Created backup: ${backupPath}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            logMessage(`⚠️ Failed to create backup: ${errorMessage}`);
        }
    }

    /**
     * Get diff apply configuration from VS Code settings
     */
    public getDiffApplyConfig(): DiffApplyConfig {
        const config = vscode.workspace.getConfiguration('projectTranslator.diffApply');
        
        return {
            enabled: config.get<boolean>('enabled', false),
            validationLevel: config.get<'strict' | 'normal' | 'loose'>('validationLevel', 'normal'),
            autoBackup: config.get<boolean>('autoBackup', true),
            maxOperationsPerFile: config.get<number>('maxOperationsPerFile', 100)
        };
    }
}