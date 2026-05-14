# Deployment

## Release Targets

| Target | Workspace | Command |
| --- | --- | --- |
| VS Marketplace | `packages/vscode-extension` | `npm run publish:vscode` |
| Open VSX | `packages/vscode-extension` | `npm run publish:ovsx` |
| npm | `packages/cli` | `npm run publish:npm` |

## npm Versioning

| Action | Command |
| --- | --- |
| Patch release | `npm run publish:npm` |
| Minor release | `npm run publish:npm -- --release-type minor` |
| Major release | `npm run publish:npm -- --release-type major` |
| Explicit version | `npm run publish:npm -- --version 0.21.0` |

`publish:npm` 会在发布前自动同步更新 `package.json`、`packages/core/package.json`、`packages/cli/package.json`、`packages/vscode-extension/package.json` 和 `package-lock.json` 中的版本号，然后再生成 `CHANGELOG.md` 并执行发布。

## VSCode Versioning

| Action | Command |
| --- | --- |
| Patch release | `npm run publish:vscode` |
| Minor release | `npm run publish:vscode -- --release-type minor` |
| Major release | `npm run publish:vscode -- --release-type major` |
| Explicit version | `npm run publish:vscode -- --version 0.21.0` |

`publish:vscode` 与 `publish:npm` 共用同一套工作区版本同步逻辑，会先取 `root/core/cli/vscode-extension` 当前最高版本作为基线，再统一递增并写回所有工作区与 `package-lock.json`，从而保证 CLI 与扩展版本号一致。

## CI Flow

| Stage | Action |
| --- | --- |
| Install | `npm ci` |
| Build | `npm run build` |
| Test | `npm run test` |
| Package Extension | `npm run package:extension` |
| Publish Extension | VSCE / OVSX |
| Publish CLI | `npm publish --workspace packages/cli --access public` |

## GitHub Actions npm Publish

| Item | Requirement |
| --- | --- |
| Authentication mode | npm Trusted Publisher |
| GitHub Actions permission | `id-token: write` |
| Secret requirement | 不使用 `NPM_TOKEN` |
| Registry setup | `actions/setup-node` 配置 `registry-url: https://registry.npmjs.org` |

当前仓库的 npm 发布流程依赖 GitHub Actions OIDC 与 npm Trusted Publisher 绑定关系完成鉴权。若重新引入 `NODE_AUTH_TOKEN` / `NPM_TOKEN` 旧流程，Trusted Publisher 不会生效。

## Rollback

| Target | Rollback Strategy |
| --- | --- |
| VSCode extension | 重新发布上一个已知稳定版本 |
| Open VSX | 发布上一个版本的 VSIX |
| npm CLI | `npm deprecate` 当前坏版本并重新发布修复版本 |
