# Deployment

## Release Targets

| Target | Workspace | Command |
| --- | --- | --- |
| VS Marketplace | `packages/vscode-extension` | `npm run publish:vscode` |
| Open VSX | `packages/vscode-extension` | `npm run publish:ovsx` |
| npm | `packages/cli` | `npm run publish:npm` |

## CI Flow

| Stage | Action |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` |
| Test | `npm run test` |
| Package Extension | `npm run package:extension` |
| Publish Extension | VSCE / OVSX |
| Publish CLI | `npm publish --workspace packages/cli --access public` |

## Rollback

| Target | Rollback Strategy |
| --- | --- |
| VSCode extension | 重新发布上一个已知稳定版本 |
| Open VSX | 发布上一个版本的 VSIX |
| npm CLI | `npm deprecate` 当前坏版本并重新发布修复版本 |
