import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'fs';
import * as path from 'path';

// Mock types for testing
interface MockOutputChannel {
    appendLine: sinon.SinonStub;
    append: sinon.SinonStub;
    clear: sinon.SinonStub;
    show: sinon.SinonStub;
    hide: sinon.SinonStub;
    dispose: sinon.SinonStub;
    name: string;
    replace: sinon.SinonStub;
}

interface DiffInfo {
    hasChanges: boolean;
    changedLines: {
        lineNumber: number;
        oldContent: string;
        newContent: string;
        changeType: 'added' | 'deleted' | 'modified';
    }[];
    contextLines: {
        lineNumber: number;
        content: string;
    }[];
}

interface TranslationDiffResult {
    success: boolean;
    translatedChanges: {
        lineNumber: number;
        translatedContent: string;
        changeType: 'added' | 'deleted' | 'modified';
    }[];
    error?: string;
}

// Simplified DiffApplier class for testing (without vscode dependency)
class DiffApplier {
    private outputChannel: MockOutputChannel;
    private fsWrapper: any;

    constructor(outputChannel: MockOutputChannel, fsWrapper?: any) {
        this.outputChannel = outputChannel;
        this.fsWrapper = fsWrapper || fs;
    }

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
            if (!this.fsWrapper.existsSync(targetDir)) {
                this.fsWrapper.mkdirSync(targetDir, { recursive: true });
                this.outputChannel.appendLine(`📁 Created target directory: ${targetDir}`);
            }

            // Read the source file content
            const sourceContent = this.fsWrapper.readFileSync(sourcePath, 'utf8');
            let targetContent = '';

            // If the target file exists, read its content as the base
            if (this.fsWrapper.existsSync(targetPath)) {
                targetContent = this.fsWrapper.readFileSync(targetPath, 'utf8');
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
                this.fsWrapper.writeFileSync(targetPath, result.finalContent!, 'utf8');
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

    public createBackup(targetPath: string): string | null {
        try {
            if (!this.fsWrapper.existsSync(targetPath)) {
                return null; // File does not exist, no backup needed
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = `${targetPath}.backup.${timestamp}`;
            
            this.fsWrapper.copyFileSync(targetPath, backupPath);
            this.outputChannel.appendLine(`💾 Created backup file: ${path.basename(backupPath)}`);
            
            return backupPath;
        } catch (error) {
            this.outputChannel.appendLine(`⚠️ Failed to create backup: ${error}`);
            return null;
        }
    }

    public restoreFromBackup(targetPath: string, backupPath: string): boolean {
        try {
            if (!this.fsWrapper.existsSync(backupPath)) {
                this.outputChannel.appendLine(`❌ Backup file does not exist: ${backupPath}`);
                return false;
            }

            this.fsWrapper.copyFileSync(backupPath, targetPath);
            this.outputChannel.appendLine(`🔄 Restored file from backup: ${path.basename(targetPath)}`);
            
            // Delete the backup file
            this.fsWrapper.unlinkSync(backupPath);
            this.outputChannel.appendLine(`🗑️ Deleted backup file: ${path.basename(backupPath)}`);
            
            return true;
        } catch (error) {
            this.outputChannel.appendLine(`❌ Failed to restore from backup: ${error}`);
            return false;
        }
    }
}

// Mock vscode module
const mockOutputChannel: MockOutputChannel = {
    appendLine: sinon.stub(),
    append: sinon.stub(),
    clear: sinon.stub(),
    show: sinon.stub(),
    hide: sinon.stub(),
    dispose: sinon.stub(),
    name: 'test-channel',
    replace: sinon.stub()
};

describe('DiffApplier', () => {
    let diffApplier: DiffApplier;
    let mockFs: any;

    beforeEach(() => {
        // Reset all stubs
        mockOutputChannel.appendLine.resetHistory();
        
        // Create mock fs wrapper
        mockFs = {
            existsSync: sinon.stub(),
            mkdirSync: sinon.stub(),
            readFileSync: sinon.stub(),
            writeFileSync: sinon.stub(),
            copyFileSync: sinon.stub(),
            unlinkSync: sinon.stub()
        };
        
        // Create fresh instance with mock fs
        diffApplier = new DiffApplier(mockOutputChannel, mockFs);
    });

    describe('applyTranslationDiff', () => {
        const sourcePath = '/test/source.md';
        const targetPath = '/test/target.md';
        const sourceContent = 'Line 1\nLine 2\nLine 3\nLine 4';
        const targetContent = 'Line 1\nOld Line 2\nLine 3\nLine 4';

        it('should successfully apply translation diff with modified lines', async () => {
            // Arrange
            const diffInfo: DiffInfo = {
                hasChanges: true,
                changedLines: [
                    {
                        lineNumber: 2,
                        oldContent: 'Old Line 2',
                        newContent: 'Line 2',
                        changeType: 'modified'
                    }
                ],
                contextLines: [
                    { lineNumber: 1, content: 'Line 1' },
                    { lineNumber: 3, content: 'Line 3' }
                ]
            };
            const translatedContents = ['Translated Line 2'];

            mockFs.existsSync.withArgs(path.dirname(targetPath)).returns(true);
            mockFs.existsSync.withArgs(targetPath).returns(true);
            mockFs.readFileSync.withArgs(sourcePath, 'utf8').returns(sourceContent);
            mockFs.readFileSync.withArgs(targetPath, 'utf8').returns(targetContent);

            // Act
            const result = await diffApplier.applyTranslationDiff(
                sourcePath,
                targetPath,
                diffInfo,
                translatedContents
            );

            // Assert
            expect(result.success).to.be.true;
            expect(result.translatedChanges).to.have.length(1);
            expect(result.translatedChanges[0]).to.deep.include({
                lineNumber: 2,
                translatedContent: 'Translated Line 2',
                changeType: 'modified'
            });
            expect(mockFs.writeFileSync.calledOnce).to.be.true;
        });

        it('should successfully apply translation diff with added lines', async () => {
            // Arrange
            const diffInfo: DiffInfo = {
                hasChanges: true,
                changedLines: [
                    {
                        lineNumber: 3,
                        oldContent: '',
                        newContent: 'New Line',
                        changeType: 'added'
                    }
                ],
                contextLines: []
            };
            const translatedContents = ['Translated New Line'];

            mockFs.existsSync.withArgs(path.dirname(targetPath)).returns(true);
            mockFs.existsSync.withArgs(targetPath).returns(true);
            mockFs.readFileSync.withArgs(sourcePath, 'utf8').returns(sourceContent);
            mockFs.readFileSync.withArgs(targetPath, 'utf8').returns(targetContent);

            // Act
            const result = await diffApplier.applyTranslationDiff(
                sourcePath,
                targetPath,
                diffInfo,
                translatedContents
            );

            // Assert
            expect(result.success).to.be.true;
            expect(result.translatedChanges).to.have.length(1);
            expect(result.translatedChanges[0]).to.deep.include({
                lineNumber: 3,
                translatedContent: 'Translated New Line',
                changeType: 'added'
            });
        });

        it('should successfully apply translation diff with deleted lines', async () => {
            // Arrange
            const diffInfo: DiffInfo = {
                hasChanges: true,
                changedLines: [
                    {
                        lineNumber: 2,
                        oldContent: 'Old Line 2',
                        newContent: '',
                        changeType: 'deleted'
                    }
                ],
                contextLines: []
            };
            const translatedContents: string[] = [];

            mockFs.existsSync.withArgs(path.dirname(targetPath)).returns(true);
            mockFs.existsSync.withArgs(targetPath).returns(true);
            mockFs.readFileSync.withArgs(sourcePath, 'utf8').returns(sourceContent);
            mockFs.readFileSync.withArgs(targetPath, 'utf8').returns(targetContent);

            // Act
            const result = await diffApplier.applyTranslationDiff(
                sourcePath,
                targetPath,
                diffInfo,
                translatedContents
            );

            // Assert
            expect(result.success).to.be.true;
            expect(result.translatedChanges).to.have.length(1);
            expect(result.translatedChanges[0]).to.deep.include({
                lineNumber: 2,
                translatedContent: '',
                changeType: 'deleted'
            });
        });

        it('should create target directory if it does not exist', async () => {
            // Arrange
            const diffInfo: DiffInfo = {
                hasChanges: false,
                changedLines: [],
                contextLines: []
            };
            const translatedContents: string[] = [];

            mockFs.existsSync.withArgs(path.dirname(targetPath)).returns(false);
            mockFs.existsSync.withArgs(targetPath).returns(false);
            mockFs.readFileSync.withArgs(sourcePath, 'utf8').returns(sourceContent);

            // Act
            await diffApplier.applyTranslationDiff(
                sourcePath,
                targetPath,
                diffInfo,
                translatedContents
            );

            // Assert
            expect(mockFs.mkdirSync.calledWith(path.dirname(targetPath), { recursive: true })).to.be.true;
        });

        it('should use source content as base when target file does not exist', async () => {
            // Arrange
            const diffInfo: DiffInfo = {
                hasChanges: false,
                changedLines: [],
                contextLines: []
            };
            const translatedContents: string[] = [];

            mockFs.existsSync.withArgs(path.dirname(targetPath)).returns(true);
            mockFs.existsSync.withArgs(targetPath).returns(false);
            mockFs.readFileSync.withArgs(sourcePath, 'utf8').returns(sourceContent);

            // Act
            const result = await diffApplier.applyTranslationDiff(
                sourcePath,
                targetPath,
                diffInfo,
                translatedContents
            );

            // Assert
            expect(result.success).to.be.true;
            expect(mockFs.writeFileSync.calledWith(targetPath, sourceContent, 'utf8')).to.be.true;
        });

        it('should handle file system errors gracefully', async () => {
            // Arrange
            const diffInfo: DiffInfo = {
                hasChanges: false,
                changedLines: [],
                contextLines: []
            };
            const translatedContents: string[] = [];

            mockFs.readFileSync.throws(new Error('File not found'));

            // Act
            const result = await diffApplier.applyTranslationDiff(
                sourcePath,
                targetPath,
                diffInfo,
                translatedContents
            );

            // Assert
            expect(result.success).to.be.false;
            expect(result.error).to.include('File not found');
            expect(result.translatedChanges).to.be.empty;
        });
    });

    describe('validateApplication', () => {
        it('should validate successful application', () => {
            // Arrange
            const originalDiffInfo: DiffInfo = {
                hasChanges: true,
                changedLines: [
                    {
                        lineNumber: 1,
                        oldContent: 'Old',
                        newContent: 'New',
                        changeType: 'modified'
                    }
                ],
                contextLines: []
            };
            const appliedChanges = [
                {
                    lineNumber: 1,
                    translatedContent: 'Translated',
                    changeType: 'modified' as const
                }
            ];

            // Act
            const result = diffApplier.validateApplication(originalDiffInfo, appliedChanges);

            // Assert
            expect(result.isValid).to.be.true;
            expect(result.issues).to.be.empty;
        });

        it('should detect missing changes', () => {
            // Arrange
            const originalDiffInfo: DiffInfo = {
                hasChanges: true,
                changedLines: [
                    {
                        lineNumber: 1,
                        oldContent: 'Old',
                        newContent: 'New',
                        changeType: 'modified'
                    },
                    {
                        lineNumber: 2,
                        oldContent: '',
                        newContent: 'Added',
                        changeType: 'added'
                    }
                ],
                contextLines: []
            };
            const appliedChanges = [
                {
                    lineNumber: 1,
                    translatedContent: 'Translated',
                    changeType: 'modified' as const
                }
            ];

            // Act
            const result = diffApplier.validateApplication(originalDiffInfo, appliedChanges);

            // Assert
            expect(result.isValid).to.be.false;
            expect(result.issues).to.have.length(2);
            expect(result.issues[0]).to.include('Number of changes does not match');
            expect(result.issues[1]).to.include('Missing change: line 2');
        });
    });

    describe('createBackup', () => {
        const targetPath = '/test/target.md';

        it('should create backup file successfully', () => {
            // Arrange
            mockFs.existsSync.withArgs(targetPath).returns(true);
            mockFs.copyFileSync.returns(undefined);

            // Act
            const backupPath = diffApplier.createBackup(targetPath);

            // Assert
            expect(backupPath).to.not.be.null;
            expect(backupPath).to.include('.backup.');
            expect(mockFs.copyFileSync.calledOnce).to.be.true;
        });

        it('should return null when target file does not exist', () => {
            // Arrange
            mockFs.existsSync.withArgs(targetPath).returns(false);

            // Act
            const backupPath = diffApplier.createBackup(targetPath);

            // Assert
            expect(backupPath).to.be.null;
            expect(mockFs.copyFileSync.called).to.be.false;
        });
    });

    describe('restoreFromBackup', () => {
        const targetPath = '/test/target.md';
        const backupPath = '/test/target.md.backup.2023-01-01';

        it('should restore from backup successfully', () => {
            // Arrange
            mockFs.existsSync.withArgs(backupPath).returns(true);
            mockFs.copyFileSync.returns(undefined);
            mockFs.unlinkSync.returns(undefined);

            // Act
            const result = diffApplier.restoreFromBackup(targetPath, backupPath);

            // Assert
            expect(result).to.be.true;
            expect(mockFs.copyFileSync.calledWith(backupPath, targetPath)).to.be.true;
            expect(mockFs.unlinkSync.calledWith(backupPath)).to.be.true;
        });

        it('should return false when backup file does not exist', () => {
            // Arrange
            mockFs.existsSync.withArgs(backupPath).returns(false);

            // Act
            const result = diffApplier.restoreFromBackup(targetPath, backupPath);

            // Assert
            expect(result).to.be.false;
            expect(mockFs.copyFileSync.called).to.be.false;
            expect(mockFs.unlinkSync.called).to.be.false;
        });
    });
});