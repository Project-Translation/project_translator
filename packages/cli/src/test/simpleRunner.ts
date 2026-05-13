import Mocha from 'mocha';
import { glob } from 'glob';
import * as path from 'path';

// Simple test runner that doesn't require VS Code GUI
async function runTests() {
    console.log('Running simple unit tests...');
    
    // Create the mocha test
    const mocha = new Mocha({
        ui: 'bdd',
        color: true,
        timeout: 10000,
        reporter: 'spec'
    });
    mocha.suite.emit('pre-require', globalThis, 'global', mocha);
    (globalThis as typeof globalThis & Record<string, unknown>).suite = globalThis.describe;
    (globalThis as typeof globalThis & Record<string, unknown>).test = globalThis.it;
    (globalThis as typeof globalThis & Record<string, unknown>).setup = globalThis.beforeEach;
    (globalThis as typeof globalThis & Record<string, unknown>).teardown = globalThis.afterEach;

    try {
        const testsRoot = path.resolve(__dirname, '.');
        console.log('Looking for tests in:', testsRoot);
        
        const files = await glob('services/*.test.js', { cwd: testsRoot });
        console.log('Found test files:', files);

        if (files.length === 0) {
            console.log('No simple test files found.');
            return;
        }

        // Add files to the test suite
        files.forEach((f: string) => {
            const testFile = path.resolve(testsRoot, f);
            console.log('Adding test file:', testFile);
            mocha.addFile(testFile);
        });

        // Run the tests
        const failures = await new Promise<number>((resolve) => {
            mocha.run((failures: number) => {
                resolve(failures);
            });
        });

        if (failures > 0) {
            console.error(`${failures} tests failed.`);
            process.exit(1);
        } else {
            console.log('All tests passed!');
            process.exit(0);
        }
    } catch (error) {
        console.error('Error running tests:', error);
        process.exit(1);
    }
}

runTests();
