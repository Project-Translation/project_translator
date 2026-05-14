import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSIONED_PACKAGE_PATHS = [
  'package.json',
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/vscode-extension/package.json',
];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function parseSemVer(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported version format: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function compareSemVer(leftVersion, rightVersion) {
  const left = parseSemVer(leftVersion);
  const right = parseSemVer(rightVersion);

  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

export function bumpSemVer(version, releaseType) {
  const parsed = parseSemVer(version);
  if (releaseType === 'patch') {
    return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
  }
  if (releaseType === 'minor') {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  if (releaseType === 'major') {
    return `${parsed.major + 1}.0.0`;
  }
  throw new Error(`Unsupported --release-type: ${releaseType}`);
}

function setVersionOrThrow(json, filePath, nextVersion) {
  if (!json || typeof json !== 'object') {
    throw new Error(`Invalid JSON document: ${filePath}`);
  }
  json.version = nextVersion;
}

export function getWorkspaceVersions(workspaceRoot) {
  return VERSIONED_PACKAGE_PATHS.map((relativePath) => {
    const filePath = resolve(workspaceRoot, relativePath);
    const json = readJson(filePath);
    const version = String(json.version || '').trim();
    if (!version) {
      throw new Error(`Missing version in ${relativePath}`);
    }
    parseSemVer(version);
    return {
      relativePath,
      filePath,
      version,
    };
  });
}

export function getHighestWorkspaceVersion(workspaceRoot) {
  const versions = getWorkspaceVersions(workspaceRoot);
  return versions.reduce((highest, entry) => {
    if (!highest) {
      return entry.version;
    }
    return compareSemVer(entry.version, highest) > 0 ? entry.version : highest;
  }, '');
}

export function syncWorkspaceVersions(workspaceRoot, nextVersion) {
  parseSemVer(nextVersion);

  for (const relativePath of VERSIONED_PACKAGE_PATHS) {
    const filePath = resolve(workspaceRoot, relativePath);
    const json = readJson(filePath);
    setVersionOrThrow(json, relativePath, nextVersion);
    writeJson(filePath, json);
  }

  const packageLockPath = resolve(workspaceRoot, 'package-lock.json');
  const packageLock = readJson(packageLockPath);
  setVersionOrThrow(packageLock, 'package-lock.json', nextVersion);

  if (packageLock.packages?.['']) {
    setVersionOrThrow(packageLock.packages[''], 'package-lock.json#packages[""]', nextVersion);
  }
  if (packageLock.packages?.['packages/core']) {
    setVersionOrThrow(packageLock.packages['packages/core'], 'package-lock.json#packages["packages/core"]', nextVersion);
  }
  if (packageLock.packages?.['packages/cli']) {
    setVersionOrThrow(packageLock.packages['packages/cli'], 'package-lock.json#packages["packages/cli"]', nextVersion);
  }
  if (packageLock.packages?.['packages/vscode-extension']) {
    setVersionOrThrow(packageLock.packages['packages/vscode-extension'], 'package-lock.json#packages["packages/vscode-extension"]', nextVersion);
  }

  writeJson(packageLockPath, packageLock);
}
