#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  bumpSemVer,
  getHighestWorkspaceVersion,
  parseSemVer,
  syncWorkspaceVersions,
} from '../../../scripts/workspace-version.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, '..', '..', '..');

function printHelp() {
  console.log(`Usage: node packages/vscode-extension/scripts/vscode-publish.mjs [options]

Options:
  --release-type <patch|minor|major>  Auto bump strategy. Default: patch
  --version <x.y.z>                   Set an explicit release version
  --help                              Show this help message
`);
}

function parseArgs(argv) {
  let releaseType = 'patch';
  let explicitVersion = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return { help: true, releaseType, explicitVersion };
    }
    if (arg === '--release-type') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --release-type');
      }
      releaseType = next;
      index += 1;
      continue;
    }
    if (arg === '--version') {
      const next = argv[index + 1];
      if (!next) {
        throw new Error('Missing value for --version');
      }
      explicitVersion = next;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { help: false, releaseType, explicitVersion };
}

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
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const currentVersion = getHighestWorkspaceVersion(workspaceRoot);
  const nextVersion = args.explicitVersion || bumpSemVer(currentVersion, args.releaseType);
  parseSemVer(nextVersion);

  console.log(`🔢 Bumping release version: ${currentVersion} -> ${nextVersion}`);
  syncWorkspaceVersions(workspaceRoot, nextVersion);

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

  console.log('🚀 Running build and VSCode publish...');
  const buildResult = runNpm(['run', 'build']);
  if (buildResult.status !== 0) {
    throw new Error('Extension build failed');
  }

  const publishResult = runNpm([
    'exec',
    '--',
    'vsce',
    'publish',
    '--baseContentUrl',
    'https://github.com/Project-Translation/project_translator/tree/main',
    '--no-dependencies',
  ]);
  if (publishResult.status !== 0) {
    throw new Error('VSCode publish failed');
  }

  console.log('🎉 Successfully published to VSCode Marketplace!');
} catch (error) {
  console.error('❌ Error during VSCode publish:', error.message);
  process.exitCode = 1;
}
