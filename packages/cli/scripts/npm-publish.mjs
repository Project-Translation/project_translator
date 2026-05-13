#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, '..', '..', '..');

function relay(text, stream) {
  if (typeof text === 'string' && text.length > 0) {
    stream.write(text);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  relay(result.stdout, process.stdout);
  relay(result.stderr, process.stderr);
  return result;
}

function runNpm(args, options = {}) {
  const npmExecPath = process.env.npm_execpath;
  if (typeof npmExecPath === 'string' && npmExecPath.trim().length > 0) {
    return run(process.execPath, [npmExecPath, ...args], options);
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return run(npmCommand, args, {
    shell: process.platform === 'win32',
    ...options,
  });
}

try {
  console.log('📝 Generating CHANGELOG.md...');
  const changelogResult = runNpm(['run', 'changelog'], {
    cwd: workspaceRoot,
  });
  if (changelogResult.status !== 0) {
    throw new Error('Changelog generation failed');
  }

  console.log('🏗️ Building shared core...');
  const coreBuildResult = runNpm(['run', 'build', '-w', 'packages/core'], {
    cwd: workspaceRoot,
  });
  if (coreBuildResult.status !== 0) {
    throw new Error('Core build failed');
  }

  console.log('🚀 Running build and publish...');
  const result = runNpm(['run', 'build']);
  if (result.status !== 0) {
    throw new Error('Build failed');
  }

  const publishResult = runNpm(['publish', '--access', 'public']);
  if (publishResult.status !== 0) {
    const publishOutput = `${publishResult.stdout ?? ''}\n${publishResult.stderr ?? ''}`;
    if (publishOutput.includes('You cannot publish over the previously published versions')) {
      console.log('ℹ️ npm 上已存在相同版本，按幂等成功处理。');
      process.exit(0);
    }
    throw new Error('Publish failed');
  }

  console.log('🎉 Successfully published to npm!');
} catch (error) {
  console.error('❌ Error during publish:', error.message);
  process.exitCode = 1;
}
