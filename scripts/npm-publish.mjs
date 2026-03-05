#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packageJsonPath = resolve(process.cwd(), 'package.json');
const originalPackageJson = readFileSync(packageJsonPath, 'utf8');

try {
  // 0. 生成 changelog（仅保留最近 10 个版本）
  console.log('📝 Generating CHANGELOG.md...');
  const changelogResult = spawnSync('npm', ['run', 'changelog'], { stdio: 'inherit' });
  if (changelogResult.status !== 0) {
    throw new Error('Changelog generation failed');
  }

  // 1. 修改 package.json 中的 name
  const pkg = JSON.parse(originalPackageJson);
  pkg.name = '@techfetch-dev/project-translator';
  writeFileSync(packageJsonPath, JSON.stringify(pkg, null, 4), 'utf8');
  console.log('✅ Temporarily updated package name to @techfetch-dev/project-translator');

  // 2. 执行 npm run build && npm publish --access public
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
} finally {
  // 3. 恢复 package.json
  writeFileSync(packageJsonPath, originalPackageJson, 'utf8');
  console.log('✅ Restored original package.json');
}
