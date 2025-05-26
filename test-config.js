// Simple test to verify configuration works with new config structure only

// Mock vscode module before requiring config
const vscode = require('./test-vscode-mock');
global.vscode = vscode;

// Mock the vscode module resolution
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(id) {
    if (id === 'vscode') {
        return vscode;
    }
    return originalRequire.apply(this, arguments);
};

// Set up test environment variable
process.env.GROK_API_KEY = 'test-api-key';

const { getConfiguration, validateConfigStructure } = require('./out/config/config');

console.log('Testing configuration...');

try {
    // Test getConfiguration function
    console.log('Testing getConfiguration...');
    const config = getConfiguration();
    
    console.log('Configuration loaded successfully!');
    console.log('Current vendor:', config.currentVendorName);
    console.log('Available vendors:', config.vendors.map(v => v.name));
    console.log('Translation interval:', config.translationIntervalDays, 'days');
    
    // Validate configuration structure
    console.log('\nValidating configuration structure...');
    const isValid = validateConfigStructure(config);
    
    if (isValid) {
        console.log('✅ Configuration structure is valid and consistent!');
    } else {
        console.log('❌ Configuration structure validation failed!');
        process.exit(1);
    }
    
    // Test that all required fields are present
    const requiredFields = ['currentVendorName', 'vendors', 'translationIntervalDays', 'currentVendor'];
    const missingFields = requiredFields.filter(field => !(field in config));
    
    if (missingFields.length === 0) {
        console.log('✅ All required fields are present in the configuration!');
    } else {
        console.log('❌ Missing required fields:', missingFields);
        process.exit(1);
    }

    // Test that config structure is the same regardless of source
    console.log('\n📋 Configuration structure summary:');
    console.log('- currentVendorName:', typeof config.currentVendorName);
    console.log('- vendors:', Array.isArray(config.vendors) ? `array (${config.vendors.length} items)` : typeof config.vendors);
    console.log('- currentVendor:', typeof config.currentVendor);
    console.log('- systemPrompts:', Array.isArray(config.systemPrompts) ? `array (${config.systemPrompts.length} items)` : typeof config.systemPrompts);
    console.log('- userPrompts:', Array.isArray(config.userPrompts) ? `array (${config.userPrompts.length} items)` : typeof config.userPrompts);
    console.log('- segmentationMarkers:', typeof config.segmentationMarkers);
    
    console.log('\n✅ All configuration tests passed!');
    
} catch (error) {
    console.error('❌ Configuration test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
}
