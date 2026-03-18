import { spawnSync } from 'node:child_process';

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

runCommand('npm', ['audit', '--audit-level=high', '--omit=dev'], 'npm audit --audit-level=high --omit=dev');
runCommand('npm', ['run', 'lint'], 'npm run lint');

console.log('\n✅ pre-push 校验通过。');