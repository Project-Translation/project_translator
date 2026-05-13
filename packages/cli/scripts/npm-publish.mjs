#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const workspaceRoot = resolve(process.cwd(), '../..');

try {
  console.log('📝 Generating CHANGELOG.md...');
  const changelogResult = spawnSync('npm', ['run', 'changelog'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (changelogResult.status !== 0) {
    throw new Error('Changelog generation failed');
  }

  console.log('🏗️ Building shared core...');
  const coreBuildResult = spawnSync('npm', ['run', 'build', '-w', 'packages/core'], {
    cwd: workspaceRoot,
    stdio: 'inherit',
  });
  if (coreBuildResult.status !== 0) {
    throw new Error('Core build failed');
  }

  console.log('🚀 Running build and publish...');
  const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error('Build failed');
  }

  const publishResult = spawnSync('npm', ['publish', '--access', 'public'], { stdio: 'inherit' });
  if (publishResult.status !== 0) {
    throw new Error('Publish failed');
  }

  console.log('🎉 Successfully published to npm!');
} catch (error) {
  console.error('❌ Error during publish:', error.message);
  process.exitCode = 1;
}
