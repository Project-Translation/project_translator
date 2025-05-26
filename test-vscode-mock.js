// Mock VSCode API for testing purposes
const path = require('path');
const fs = require('fs');

// Mock workspace
const mockWorkspace = {
    workspaceFolders: [{
        uri: {
            fsPath: path.join(__dirname, 'sample')
        }
    }],
    getConfiguration: (section) => {
        // Return mock configuration based on package.json defaults
        if (section === 'projectTranslator') {
            return {
                get: (key, defaultValue) => {
                    const defaults = {
                        currentVendor: 'grok',
                        vendors: [
                            {
                                name: 'grok',
                                apiEndpoint: 'https://api.x.ai/v1',
                                apiKey: '',
                                apiKeyEnvVarName: 'GROK_API_KEY',
                                model: 'grok-2',
                                rpm: 20,
                                maxTokensPerSegment: 1500,
                                timeout: 30,
                                temperature: 0,
                                streamMode: true
                            }
                        ],
                        specifiedFiles: [],
                        specifiedFolders: [],
                        translationIntervalDays: 7,
                        copyOnly: {
                            paths: [],
                            extensions: ['.svg']
                        },
                        ignore: {
                            paths: ['**/node_modules/**', '**/.git/**'],
                            extensions: []
                        },
                        systemPrompts: ['You are a professional translator.'],
                        userPrompts: [],
                        segmentationMarkers: {
                            markdown: ['^#\\s', '^##\\s', '^###\\s']
                        }
                    };
                    return defaults[key] || defaultValue;
                }
            };
        }
        return { get: () => undefined };
    }
};

// Mock window
const mockWindow = {
    showErrorMessage: (message) => {
        console.error('VSCode Error:', message);
    },
    showInformationMessage: (message) => {
        console.log('VSCode Info:', message);
    },
    showTextDocument: () => Promise.resolve()
};

// Mock vscode module
const vscode = {
    workspace: mockWorkspace,
    window: mockWindow,
    Uri: {
        file: (path) => ({ fsPath: path })
    }
};

module.exports = vscode;
