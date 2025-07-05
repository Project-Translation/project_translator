import { expect } from 'chai';
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Create a mock output channel instance first
const mockOutputChannel = {
    name: 'test',
    append: () => {},
    appendLine: () => {},
    clear: () => {},
    show: () => {},
    hide: () => {},
    dispose: () => {},
    replace: () => {}
};

// Mock vscode module before importing services that depend on it
const mockVscode = {
    workspace: {
        workspaceFolders: [{
            uri: { fsPath: '/test/workspace' },
            name: 'test',
            index: 0
        }],
        getConfiguration: () => ({
            get: (key: string, defaultValue?: any) => defaultValue
        })
    },
    window: {
        createOutputChannel: () => mockOutputChannel
    },
    OutputChannel: class {
        name = 'test';
        append() {}
        appendLine() {}
        clear() {}
        show() {}
        hide() {}
        dispose() {}
        replace() {}
    }
};

// Mock the vscode module
(global as any).vscode = mockVscode;

// Also set up module mock for require
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id: string) {
    if (id === 'vscode') {
        return mockVscode;
    }
    return originalRequire.apply(this, arguments);
};

// Set up global outputChannel for logMessage function BEFORE importing anything
// We need to set outputChannel in the compiled extension module
const extensionModule = require('../../../out/extension');
// Use Object.defineProperty to ensure the outputChannel is properly set
Object.defineProperty(extensionModule, 'outputChannel', {
    value: mockOutputChannel,
    writable: true,
    configurable: true
});

// Also try to set it as a direct property
extensionModule.outputChannel = mockOutputChannel;

// Verify it's set correctly
console.log('Extension outputChannel set:', extensionModule.outputChannel !== undefined);

// Now import the services
import { DiffApplyService } from '../../services/diffApplyService';
import { DiffApplyResponse, DiffOperation } from '../../types/types';

describe('DiffApplyService', () => {
    let diffApplyService: DiffApplyService;
    let testDir: string;

    beforeEach(() => {
        // Create the service with the mock output channel
        diffApplyService = new DiffApplyService(mockOutputChannel);
        
        // Create test directory
        testDir = path.join(__dirname, 'test-diff-apply');
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }
    });

    afterEach(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('createDiffApplyRequest', () => {
        it('should create a valid diff apply request', async () => {
            // Create test files
            const sourcePath = path.join(testDir, 'source.md');
            const targetPath = path.join(testDir, 'target.md');
            
            const sourceContent = '# Title\n\nThis is source content.\n';
            const targetContent = '# 标题\n\n这是目标内容。\n';
            
            fs.writeFileSync(sourcePath, sourceContent);
            fs.writeFileSync(targetPath, targetContent);

            const request = await diffApplyService.createDiffApplyRequest(
                sourcePath,
                targetPath,
                'en',
                'zh-cn'
            );

            expect(request).to.have.property('source_document');
            expect(request).to.have.property('target_document');
            expect(request?.source_document.content).to.equal(sourceContent);
            expect(request?.target_document.content).to.equal(targetContent);
            expect(request?.source_language).to.equal('en');
            expect(request?.target_language).to.equal('zh-cn');
        });
    });

    describe('parseDiffApplyResponse', () => {
        it('should parse valid diff apply response', () => {
            const responseText = JSON.stringify({
                status: 'success',
                operations: [
                    {
                        type: 'update',
                        line_number: 1,
                        content: 'Updated content'
                    }
                ],
                metadata: {
                    totalOperations: 1,
                    processingTime: 100
                }
            });

            const response = diffApplyService.parseDiffApplyResponse(responseText);

            expect(response).to.have.property('status', 'success');
            expect(response.operations).to.have.length(1);
            expect(response.operations?.[0]).to.deep.include({
                type: 'update',
                line_number: 1,
                content: 'Updated content'
            });
        });

        it('should handle invalid JSON response', () => {
            const invalidJson = 'invalid json';
            
            const result = diffApplyService.parseDiffApplyResponse(invalidJson);
            expect(result.status).to.equal('error');
            expect(result.error_message).to.include('No valid JSON found in AI response');
        });
    });

    describe('applyDiffOperations', () => {
        it('should apply update operations correctly', async () => {
            const targetPath = path.join(testDir, 'target.md');
            const originalContent = 'Line 1\nLine 2\nLine 3\n';
            fs.writeFileSync(targetPath, originalContent);

            const diffResponse: DiffApplyResponse = {
                status: 'success',
                operations: [
                    {
                        type: 'update',
                        line_number: 2,
                        content: 'Updated Line 2'
                    }
                ],
                metadata: {
                    totalOperations: 1,
                    processingTime: 100
                }
            };

            const config = {
                enabled: true,
                validationLevel: 'normal' as const,
                autoBackup: true,
                maxOperationsPerFile: 100
            };

            const success = await diffApplyService.applyDiffOperations(targetPath, diffResponse.operations || [], config);
            expect(success).to.be.true;
            
            const result = fs.readFileSync(targetPath, 'utf8');
            expect(result).to.include('Updated Line 2');
            expect(result).to.include('Line 1');
            expect(result).to.include('Line 3');
        });

        it('should apply insert operations correctly', async () => {
            const targetPath = path.join(testDir, 'target.md');
            const originalContent = 'Line 1\nLine 3\n';
            fs.writeFileSync(targetPath, originalContent);

            const diffResponse: DiffApplyResponse = {
                status: 'success',
                operations: [
                    {
                        type: 'insert',
                        line_number: 2,
                        content: 'Inserted Line 2'
                    }
                ],
                metadata: {
                    totalOperations: 1,
                    processingTime: 100
                }
            };

            const config = {
                enabled: true,
                validationLevel: 'normal' as const,
                autoBackup: true,
                maxOperationsPerFile: 100
            };

            const success = await diffApplyService.applyDiffOperations(targetPath, diffResponse.operations || [], config);
            expect(success).to.be.true;
            
            const result = fs.readFileSync(targetPath, 'utf8');
            const lines = result.split('\n');
            expect(lines[0]).to.equal('Line 1');
            expect(lines[1]).to.equal('Inserted Line 2');
            expect(lines[2]).to.equal('Line 3');
        });

        it('should apply delete operations correctly', async () => {
            const targetPath = path.join(testDir, 'target.md');
            const originalContent = 'Line 1\nLine 2\nLine 3\n';
            fs.writeFileSync(targetPath, originalContent);

            const diffResponse: DiffApplyResponse = {
                status: 'success',
                operations: [
                    {
                        type: 'delete',
                        line_number: 2
                    }
                ],
                metadata: {
                    totalOperations: 1,
                    processingTime: 100
                }
            };

            const config = {
                enabled: true,
                validationLevel: 'normal' as const,
                autoBackup: true,
                maxOperationsPerFile: 100
            };

            const success = await diffApplyService.applyDiffOperations(targetPath, diffResponse.operations || [], config);
            expect(success).to.be.true;
            
            const result = fs.readFileSync(targetPath, 'utf8');
            expect(result).to.include('Line 1');
            expect(result).to.not.include('Line 2');
            expect(result).to.include('Line 3');
        });

        it('should create backup when autoBackup is enabled', async () => {
            const targetPath = path.join(testDir, 'target.md');
            const originalContent = 'Original content';
            fs.writeFileSync(targetPath, originalContent);

            const diffResponse: DiffApplyResponse = {
                status: 'success',
                operations: [],
                metadata: {
                    totalOperations: 0,
                    processingTime: 100
                }
            };

            const config = {
                enabled: true,
                validationLevel: 'normal' as const,
                autoBackup: true,
                maxOperationsPerFile: 100
            };

            await diffApplyService.applyDiffOperations(targetPath, diffResponse.operations || [], config);
            
            // Check if backup file was created
            const backupFiles = fs.readdirSync(testDir).filter(f => f.includes('.backup.'));
            expect(backupFiles).to.have.length.greaterThan(0);
        });
    });
});