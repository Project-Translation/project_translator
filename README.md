# Project Translator Monorepo

`project_translator` 已重构为 `npm workspaces` monorepo，统一管理共享核心、VSCode 扩展和 CLI。

## Packages

| Package | Path | Purpose | Publish Target |
| --- | --- | --- | --- |
| `@project-translator/core` | `packages/core` | 共享翻译核心、配置、运行时、测试 | Private workspace |
| `project-translator` | `packages/vscode-extension` | VSCode 扩展 | VS Marketplace / Open VSX |
| `project-translator-cli` | `packages/cli` | 命令行工具 | npm |

```mermaid
flowchart LR
  Root[workspace root]
  Core[@project-translator/core]
  Ext[project-translator]
  Cli[project-translator-cli]

  Root --> Core
  Root --> Ext
  Root --> Cli
  Ext --> Core
  Cli --> Core
```

## Install

| Channel | Command / Link |
| --- | --- |
| VSCode Marketplace | `techfetch-dev.project-translator` |
| Open VSX | `https://open-vsx.org/extension/techfetch-dev/project-translator` |
| CLI | `npx project-translator-cli --help` |

## Workspace Commands

| Command | Purpose |
| --- | --- |
| `npm install` | 安装所有 workspace 依赖 |
| `npm run build` | 构建 `core`、扩展、CLI |
| `npm run test` | 运行 `core` 与 `cli` 测试 |
| `npm run lint` | 检查全部包 |
| `npm run package:extension` | 生成 VSIX |
| `npm run publish:vscode` | 自动递增版本并发布 VSCode 扩展 |
| `npm run publish:ovsx` | 发布 Open VSX 扩展 |
| `npm run publish:npm` | 自动递增版本并发布 CLI 到 npm |
| `npm pack -w packages/cli` | 生成 CLI npm tarball |

## CLI Usage

```bash
npx project-translator-cli translate project --workspace . --config project.translation.json
npx project-translator-cli translate project --workspace . --config project.translation.json --lang ja-jp
npx project-translator-cli config list --workspace . --config project.translation.json --json
npx project-translator-cli config validate --workspace . --config project.translation.json
```

## Docs

| Doc | Path |
| --- | --- |
| Architecture | [docs/architecture.md](./docs/architecture.md) |
| Development | [docs/development.md](./docs/development.md) |
| Deployment | [docs/deployment.md](./docs/deployment.md) |
| Testing | [docs/testing.md](./docs/testing.md) |

## Legacy Localized Readmes

- [简体中文](./readmes/README.zh-cn.md)
- [繁體中文](./readmes/README.zh-tw.md)
- [日本語](./readmes/README.ja-jp.md)
- [한국어](./readmes/README.ko-kr.md)
- [Français](./readmes/README.fr-fr.md)
- [Deutsch](./readmes/README.de-de.md)
- [Español](./readmes/README.es-es.md)
- [Português](./readmes/README.pt-br.md)
- [Русский](./readmes/README.ru-ru.md)
- [العربية (SA)](./readmes/README.ar-sa.md)
