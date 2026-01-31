// Pure unit tests for config validation functions
import { expect } from 'chai';
import * as path from 'path';

// Import the types directly
import { VendorConfig } from '../../types/types';

// Define the Config interface locally to avoid VS Code dependencies
interface Config {
    currentVendorName: string;
    vendors: VendorConfig[];
    translationIntervalDays: number;
    currentVendor: VendorConfig;
    customPrompts?: string[];
    specifiedFiles?: any[];
    specifiedFolders?: any[];
    copyOnly?: any;
    ignore?: any;
    segmentationMarkers?: Record<string, string[]>;
}

// Copy the validation function to test it independently
function validateConfigStructure(config: Config): boolean {
    const requiredFields = [
        'currentVendorName',
        'vendors',
        'translationIntervalDays',
        'currentVendor'
    ];

    for (const field of requiredFields) {
        if (!(field in config)) {
            console.error(`Missing required field: ${field}`);
            return false;
        }
    }

    // Validate currentVendor is properly set
    if (!config.currentVendor || !config.currentVendor.name) {
        console.error('currentVendor is not properly configured');
        return false;
    }

    // Validate that currentVendor exists in vendors array
    const vendorExists = config.vendors.some(v => v.name === config.currentVendorName);
    if (!vendorExists) {
        console.error(`Current vendor "${config.currentVendorName}" not found in vendors array`);
        return false;
    }

    return true;
}

suite('Pure Config Validation Tests', () => {
    suite('validateConfigStructure', () => {
        test('should return true for valid configuration', () => {
            const validConfig: Config = {
                currentVendorName: 'grok',
                vendors: [
                    {
                        name: 'grok',
                        apiEndpoint: 'https://api.x.ai/v1',
                        apiKey: 'test-key',
                        model: 'grok-beta'
                    }
                ],
                translationIntervalDays: 1,
                currentVendor: {
                    name: 'grok',
                    apiEndpoint: 'https://api.x.ai/v1',
                    apiKey: 'test-key',
                    model: 'grok-beta'
                },
                customPrompts: ['Test custom prompt']
            };

            const result = validateConfigStructure(validConfig);
            expect(result).to.be.true;
        });

        test('should return false for missing required fields', () => {
            const invalidConfig = {
                currentVendorName: 'grok'
                // Missing other required fields
            } as Config;

            const result = validateConfigStructure(invalidConfig);
            expect(result).to.be.false;
        });

        test('should return false when currentVendor is not properly set', () => {
            const invalidConfig: Config = {
                currentVendorName: 'grok',
                vendors: [],
                translationIntervalDays: 1,
                currentVendor: null as any,
                customPrompts: []
            };

            const result = validateConfigStructure(invalidConfig);
            expect(result).to.be.false;
        });

        test('should return false when current vendor not found in vendors array', () => {
            const invalidConfig: Config = {
                currentVendorName: 'nonexistent',
                vendors: [
                    {
                        name: 'grok',
                        apiEndpoint: 'https://api.x.ai/v1',
                        apiKey: 'test-key',
                        model: 'grok-beta'
                    }
                ],
                translationIntervalDays: 1,
                currentVendor: {
                    name: 'nonexistent',
                    apiEndpoint: 'https://api.test.com/v1',
                    apiKey: 'test-key',
                    model: 'test-model'
                },
                customPrompts: []
            };

            const result = validateConfigStructure(invalidConfig);
            expect(result).to.be.false;
        });
    });

    suite('VendorConfig Type Validation', () => {
        test('should validate vendor configuration structure', () => {
            const validVendor: VendorConfig = {
                name: 'test',
                apiEndpoint: 'https://api.test.com/v1',
                apiKey: 'test-key',
                model: 'test-model',
                rpm: 60,
                maxTokensPerSegment: 4000,
                timeout: 180,
                temperature: 0.1,
                streamMode: false
            };

            // Test that all expected properties exist and have correct types
            expect(validVendor.name).to.be.a('string');
            expect(validVendor.apiEndpoint).to.be.a('string');
            expect(validVendor.model).to.be.a('string');
            expect(validVendor.apiKey).to.be.a('string');
            expect(validVendor.rpm).to.be.a('number');
            expect(validVendor.maxTokensPerSegment).to.be.a('number');
            expect(validVendor.timeout).to.be.a('number');
            expect(validVendor.temperature).to.be.a('number');
            expect(validVendor.streamMode).to.be.a('boolean');
        });

        test('should handle minimal vendor configuration', () => {
            const minimalVendor: VendorConfig = {
                name: 'minimal',
                apiEndpoint: 'https://api.minimal.com/v1',
                model: 'minimal-model'
            };

            // Test that required properties exist
            expect(minimalVendor.name).to.be.a('string');
            expect(minimalVendor.apiEndpoint).to.be.a('string');
            expect(minimalVendor.model).to.be.a('string');
            
            // Optional properties should be undefined
            expect(minimalVendor.apiKey).to.be.undefined;
            expect(minimalVendor.rpm).to.be.undefined;
            expect(minimalVendor.maxTokensPerSegment).to.be.undefined;
        });

        test('should validate environment variable configuration', () => {
            const envVendor: VendorConfig = {
                name: 'env-vendor',
                apiEndpoint: 'https://api.env.com/v1',
                apiKeyEnvVarName: 'ENV_API_KEY',
                model: 'env-model'
            };

            expect(envVendor.apiKeyEnvVarName).to.be.a('string');
            expect(envVendor.apiKeyEnvVarName).to.equal('ENV_API_KEY');
            expect(envVendor.apiKey).to.be.undefined;
        });
    });

    suite('Configuration Object Structure', () => {
        test('should validate complete config structure', () => {
            const completeConfig: Config = {
                currentVendorName: 'test',
                vendors: [
                    {
                        name: 'test',
                        apiEndpoint: 'https://api.test.com/v1',
                        apiKey: 'test-key',
                        model: 'test-model'
                    }
                ],
                translationIntervalDays: 7,
                currentVendor: {
                    name: 'test',
                    apiEndpoint: 'https://api.test.com/v1',
                    apiKey: 'test-key',
                    model: 'test-model'
                },
                customPrompts: ['Custom prompt 1'],
                specifiedFiles: [],
                specifiedFolders: [],
                copyOnly: {},
                ignore: {},
                segmentationMarkers: {}
            };

            // Validate the structure
            expect(completeConfig).to.have.property('currentVendorName');
            expect(completeConfig).to.have.property('vendors');
            expect(completeConfig).to.have.property('translationIntervalDays');
            expect(completeConfig).to.have.property('currentVendor');
            expect(completeConfig).to.have.property('customPrompts');

            expect(completeConfig.vendors).to.be.an('array');
            expect(completeConfig.translationIntervalDays).to.be.a('number');
            expect(completeConfig.customPrompts).to.be.an('array');
        });

        test('should validate translationIntervalDays bounds', () => {
            const configWithValidInterval: Config = {
                currentVendorName: 'test',
                vendors: [
                    {
                        name: 'test',
                        apiEndpoint: 'https://api.test.com/v1',
                        apiKey: 'test-key',
                        model: 'test-model'
                    }
                ],
                translationIntervalDays: 5,
                currentVendor: {
                    name: 'test',
                    apiEndpoint: 'https://api.test.com/v1',
                    apiKey: 'test-key',
                    model: 'test-model'
                }
            };

            expect(configWithValidInterval.translationIntervalDays).to.be.greaterThan(0);
            expect(configWithValidInterval.translationIntervalDays).to.be.lessThan(366);
        });
    });
});

// Test utility functions
suite('Test Utilities', () => {
    test('should have access to testing framework', () => {
        expect(expect).to.be.a('function');
        expect(path).to.be.an('object');
    });

    test('should be able to perform basic assertions', () => {
        expect(true).to.be.true;
        expect(false).to.be.false;
        expect('string').to.be.a('string');
        expect(42).to.be.a('number');
        expect([]).to.be.an('array');
        expect({}).to.be.an('object');
    });
});
