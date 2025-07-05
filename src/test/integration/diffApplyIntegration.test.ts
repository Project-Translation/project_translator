import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { FileProcessor } from '../../services/fileProcessor';
import { TranslatorService } from '../../services/translatorService';
import { TranslationDatabase } from '../../translationDatabase';
import { DiffApplyResponse } from '../../types/types';

describe('Diff Apply Integration Tests', () => {
    let fileProcessor: FileProcessor;
    let mockOutputChannel: vscode.OutputChannel;
    let testDir: string;
    let translationDb: TranslationDatabase;
    let translatorService: TranslatorService;

    before(async () => {
        // Create mock output channel
        mockOutputChannel = {
            name: 'Test Channel',
            append: () => {},
            appendLine: () => {},
            clear: () => {},
            show: () => {},
            hide: () => {},
            dispose: () => {},
            replace: () => {}
        } as vscode.OutputChannel;

        // Create test directory
        testDir = path.join(__dirname, 'test-integration');
        if (!fs.existsSync(testDir)) {
            fs.mkdirSync(testDir, { recursive: true });
        }

        // Initialize services
        translationDb = new TranslationDatabase('/test/workspace', mockOutputChannel);
        translatorService = new TranslatorService(mockOutputChannel);
        fileProcessor = new FileProcessor(mockOutputChannel, translationDb, translatorService);
    });

    after(() => {
        // Clean up test directory
        if (fs.existsSync(testDir)) {
            fs.rmSync(testDir, { recursive: true, force: true });
        }
    });

    describe('End-to-End Diff Apply Translation', () => {
        it('should handle diff apply translation workflow', async function() {
            this.timeout(10000); // Increase timeout for integration test

            // Create source file
            const sourceDir = path.join(testDir, 'source');
            const targetDir = path.join(testDir, 'target');
            
            fs.mkdirSync(sourceDir, { recursive: true });
            fs.mkdirSync(targetDir, { recursive: true });

            const sourceFile = path.join(sourceDir, 'test.md');
            const targetFile = path.join(targetDir, 'test.md');

            // Create source content
            const sourceContent = `# Project Documentation

## Introduction

This is a sample project documentation.

## Features

- Feature 1: Basic functionality
- Feature 2: Advanced options
- Feature 3: Integration support

## Installation

To install this project:

\`\`\`bash
npm install
\`\`\`

## Usage

Basic usage example:

\`\`\`javascript
const project = require('project');
project.start();
\`\`\`

## Contributing

We welcome contributions!
`;

            // Create existing target content (partially translated)
            const existingTargetContent = `# 项目文档

## 介绍

This is a sample project documentation.

## 功能特性

- Feature 1: Basic functionality
- Feature 2: Advanced options
- Feature 3: Integration support

## 安装

To install this project:

\`\`\`bash
npm install
\`\`\`

## 使用方法

Basic usage example:

\`\`\`javascript
const project = require('project');
project.start();
\`\`\`

## 贡献

We welcome contributions!
`;

            fs.writeFileSync(sourceFile, sourceContent);
            fs.writeFileSync(targetFile, existingTargetContent);

            // Mock configuration to enable diff apply
            const originalGetConfiguration = vscode.workspace.getConfiguration;
            vscode.workspace.getConfiguration = (section?: string) => {
                const mockConfig = {
                    get: (key: string, defaultValue?: any) => {
                        if (key === 'diffApply.enabled') return true;
                        if (key === 'diffApply.validationLevel') return 'normal';
                        if (key === 'diffApply.autoBackup') return true;
                        if (key === 'diffApply.maxOperationsPerFile') return 100;
                        if (key === 'openaiApiKey') return 'test-key';
                        if (key === 'model') return 'gpt-3.5-turbo';
                        if (key === 'enableStream') return false;
                        return defaultValue;
                    },
                    has: () => true,
                    inspect: () => undefined,
                    update: () => Promise.resolve()
                };
                return mockConfig as any;
            };

            try {
                // Mock the translator service to return a diff apply response
                const originalTranslateWithDiffApply = translatorService.translateWithDiffApply;
                translatorService.translateWithDiffApply = async (request) => {
                    // Simulate AI response with diff operations
                    const response: DiffApplyResponse = {
                        status: 'success',
                        operations: [
                            {
                                type: 'update',
                                line_number: 4,
                                content: '这是一个示例项目文档。'
                            },
                            {
                                type: 'update',
                                line_number: 8,
                                content: '- 功能 1: 基础功能'
                            },
                            {
                                type: 'update',
                                line_number: 9,
                                content: '- 功能 2: 高级选项'
                            },
                            {
                                type: 'update',
                                line_number: 10,
                                content: '- 功能 3: 集成支持'
                            },
                            {
                                type: 'update',
                                line_number: 14,
                                content: '要安装此项目：'
                            },
                            {
                                type: 'update',
                                line_number: 22,
                                content: '基本使用示例：'
                            },
                            {
                                type: 'update',
                                line_number: 30,
                                content: '我们欢迎贡献！'
                            }
                        ],
                        metadata: {
                            totalOperations: 7,
                            processingTime: 1500
                        }
                    };
                    return ['0', response];
                };

                // Process the file with diff apply
                const result = await fileProcessor.processFile(
                    sourceFile,
                    targetFile,
                    'en',
                    'zh-cn'
                );

                // Verify the result
                expect(result).to.have.property('success', true);
                expect(result).to.have.property('usedDiffApply', true);

                // Check that the target file was updated
                const updatedContent = fs.readFileSync(targetFile, 'utf-8');
                
                // Verify specific translations were applied
                expect(updatedContent).to.include('这是一个示例项目文档。');
                expect(updatedContent).to.include('- 功能 1: 基础功能');
                expect(updatedContent).to.include('- 功能 2: 高级选项');
                expect(updatedContent).to.include('- 功能 3: 集成支持');
                expect(updatedContent).to.include('要安装此项目：');
                expect(updatedContent).to.include('基本使用示例：');
                expect(updatedContent).to.include('我们欢迎贡献！');

                // Verify that code blocks and structure were preserved
                expect(updatedContent).to.include('```bash\nnpm install\n```');
                expect(updatedContent).to.include('```javascript\nconst project = require(\'project\');\nproject.start();\n```');

                // Check that backup file was created
                const backupFiles = fs.readdirSync(targetDir).filter(f => f.includes('.backup.'));
                expect(backupFiles).to.have.length.greaterThan(0);

                // Restore original method
                translatorService.translateWithDiffApply = originalTranslateWithDiffApply;

            } finally {
                // Restore original configuration
                vscode.workspace.getConfiguration = originalGetConfiguration;
            }
        });

        it('should fallback to standard translation when diff apply fails', async function() {
            this.timeout(5000);

            const sourceFile = path.join(testDir, 'fallback-source.md');
            const targetFile = path.join(testDir, 'fallback-target.md');

            const sourceContent = '# Test\n\nContent to translate.';
            const existingTargetContent = '# 测试\n\n需要翻译的内容。';

            fs.writeFileSync(sourceFile, sourceContent);
            fs.writeFileSync(targetFile, existingTargetContent);

            // Mock configuration
            const originalGetConfiguration = vscode.workspace.getConfiguration;
            vscode.workspace.getConfiguration = () => ({
                get: (key: string, defaultValue?: any) => {
                    if (key === 'diffApply.enabled') return true;
                    if (key === 'openaiApiKey') return 'test-key';
                    if (key === 'model') return 'gpt-3.5-turbo';
                    return defaultValue;
                },
                has: () => true,
                inspect: () => undefined,
                update: () => Promise.resolve()
            } as any);

            try {
                // Mock diff apply to fail
                const originalTranslateWithDiffApply = translatorService.translateWithDiffApply;
                translatorService.translateWithDiffApply = async () => {
                    throw new Error('Diff apply failed');
                };

                // Mock standard translation to succeed
                const originalTranslateContent = translatorService.translateContent;
                translatorService.translateContent = async () => {
                    return ['0', '# 测试\n\n要翻译的内容。'];
                };

                const result = await fileProcessor.processFile(
                    sourceFile,
                    targetFile,
                    'en',
                    'zh-cn'
                );

                // Verify fallback occurred
                expect(result).to.have.property('success', true);
                expect(result).to.have.property('usedDiffApply', false);

                // Restore original methods
                translatorService.translateWithDiffApply = originalTranslateWithDiffApply;
                translatorService.translateContent = originalTranslateContent;

            } finally {
                vscode.workspace.getConfiguration = originalGetConfiguration;
            }
        });
    });
});