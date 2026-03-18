import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const gitDir = path.join(projectRoot, '.git');
const hooksDir = path.join(gitDir, 'hooks');
const hookFile = path.join(hooksDir, 'pre-push');

if (!existsSync(gitDir)) {
	console.log('ℹ️ 未检测到 .git 目录，跳过 Git hooks 安装。');
	process.exit(0);
}

mkdirSync(hooksDir, { recursive: true });

const hookContent = `#!/usr/bin/env sh
node scripts/pre-push-check.mjs
`;

writeFileSync(hookFile, hookContent, 'utf8');
chmodSync(hookFile, 0o755);

console.log('✅ 已安装 Git pre-push hook。');