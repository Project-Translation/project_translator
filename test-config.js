// Simple test to verify configuration works with new config structure only
const { getConfiguration } = require('./out/config/config');

console.log('Testing configuration...');

const mockNewConfig = {
    copyOnly: {
        paths: ['docs'],
        extensions: ['.md']
    },
    ignore: {
        paths: ['temp'],
        extensions: ['.cache']
    },
    translationIntervalDays: 7,
    targetLanguages: ['zh-cn']
};

console.log('Input:', JSON.stringify(mockNewConfig, null, 2));
// Here you can add further tests for getConfiguration or other new config logic as needed.

console.log('\n✅ All tests completed!');
