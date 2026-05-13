import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

function resolveNpmInvocation() {
    const npmExecPath = process.env.npm_execpath;
    if (typeof npmExecPath === 'string' && npmExecPath.trim().length > 0 && existsSync(npmExecPath)) {
        return {
            command: process.execPath,
            baseArgs: [npmExecPath],
        };
    }

    const nodeDir = dirname(process.execPath);
    const candidates = [
        join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        join(nodeDir, '..', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ];

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return {
                command: process.execPath,
                baseArgs: [candidate],
            };
        }
    }

    return {
        command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
        baseArgs: [],
    };
}

function runCommand(command, args, label) {
    console.log(`\n▶ ${label}`);
    const result = spawnSync(command, args, {
        stdio: 'inherit',
        shell: false,
    });

    if (result.error) {
        console.error(`❌ 执行失败: ${label}`);
        console.error(result.error.message);
        process.exit(1);
    }

    if (result.status !== 0) {
        console.error(`❌ 校验未通过: ${label}`);
        process.exit(result.status ?? 1);
    }
}

const npm = resolveNpmInvocation();

runCommand(
    npm.command,
    [...npm.baseArgs, 'audit', '--audit-level=high', '--omit=dev'],
    'npm audit --audit-level=high --omit=dev'
);
runCommand(
    npm.command,
    [...npm.baseArgs, 'run', 'lint'],
    'npm run lint'
);

console.log('\n✅ pre-push 校验通过。');
