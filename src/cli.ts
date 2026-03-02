#!/usr/bin/env node

import { Command } from "commander";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import { TranslationRunner } from "./app/translationRunner";
import { resolveConfigPath, getConfigurationFromProjectFile, clearConfigReaderCache } from "./config/config.reader";
import {
  getByKeyPath,
  loadRawConfigForEdit,
  parseValueByType,
  removeByKeyPath,
  saveRawConfigCanonical,
  setByKeyPath,
} from "./config/config.writer";
import { getProjectTranslationSchemaJson } from "./config/config.schema";
import { validateProjectTranslationConfig } from "./config/config.schema.validator";
import { setRuntimeContext } from "./runtime/context";
import { isOperationCancelledError, OperationCancelledError } from "./runtime/errors";
import { RuntimeContext } from "./runtime/types";
import { logMessage } from "./runtime/logging";

interface GlobalOptions {
  workspace?: string;
  config?: string;
  json?: boolean;
}

function resolveWorkspaceRoot(input?: string): string {
  return path.resolve(input || process.cwd());
}

function resolveConfigFilePath(workspaceRoot: string, config?: string): string {
  return resolveConfigPath(workspaceRoot, config);
}

function createMachineIdStorePath(): string {
  return path.join(os.homedir(), ".project-translator", "machine-id");
}

async function getOrCreateCliMachineId(): Promise<string> {
  const storePath = createMachineIdStorePath();
  await fs.promises.mkdir(path.dirname(storePath), { recursive: true });

  try {
    const existing = (await fs.promises.readFile(storePath, "utf-8")).trim();
    if (existing) {
      return existing;
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const id = randomUUID();
  await fs.promises.writeFile(storePath, `${id}\n`, "utf-8");
  return id;
}

function createCliRuntimeContext(workspaceRoot: string, configPath: string): RuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: (message: string) => console.log(message),
      warn: (message: string) => console.warn(message),
      error: (message: string) => console.error(message),
      debug: (message: string) => console.debug(message),
    },
    notifier: {
      showInfo: (message: string) => console.log(`[INFO] ${message}`),
      showWarn: (message: string) => console.warn(`[WARN] ${message}`),
      showError: (message: string) => console.error(`[ERROR] ${message}`),
    },
    configProvider: {
      async getConfiguration() {
        return getConfigurationFromProjectFile(workspaceRoot, configPath);
      },
      clearCache() {
        clearConfigReaderCache();
      },
    },
    createCancellationController: () => {
      const token = { isCancellationRequested: false };
      return {
        token,
        cancel() {
          token.isCancellationRequested = true;
        },
        dispose() {
          token.isCancellationRequested = true;
        },
      };
    },
    createCancellationError: (message?: string) => new OperationCancelledError(message),
    isCancellationError: (error: unknown) => isOperationCancelledError(error),
    getMachineId: async () => getOrCreateCliMachineId(),
  };
}

function printTranslationResult(result: any, jsonOutput: boolean | undefined): void {
  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  logMessage("==========================================");
  logMessage("Translation Task Summary");
  logMessage("==========================================");
  logMessage(`✅ Translated files: ${result.processedFiles}`);
  logMessage(`⏭️ Skipped files: ${result.skippedFiles}`);
  logMessage(`❌ Failed files: ${result.failedFiles}`);
  logMessage(`⌛ Total time: ${(result.durationMs / 1000).toFixed(2)} seconds`);
  logMessage(
    `📊 Tokens: input=${result.tokenCounts.inputTokens}, output=${result.tokenCounts.outputTokens}, total=${result.tokenCounts.totalTokens}`
  );

  if (result.failedPaths && result.failedPaths.length > 0) {
    logMessage("❌ Failed file list:");
    for (const failedPath of result.failedPaths) {
      logMessage(` - ${failedPath}`);
    }
  }

  if (result.cancelled) {
    logMessage("⛔ Translation cancelled", "warn");
  }

  if (result.fatalError) {
    logMessage(`❌ Fatal error: ${result.fatalError}`, "error");
  }
}

async function runTranslateTask(
  mode: "project" | "folders" | "files",
  options: GlobalOptions
): Promise<number> {
  const workspaceRoot = resolveWorkspaceRoot(options.workspace);
  const configPath = resolveConfigFilePath(workspaceRoot, options.config);
  const runtimeContext = createCliRuntimeContext(workspaceRoot, configPath);
  setRuntimeContext(runtimeContext);

  const runner = new TranslationRunner(runtimeContext);
  const cancellationController = runtimeContext.createCancellationController();
  const sigintHandler = () => cancellationController.cancel();
  process.on("SIGINT", sigintHandler);

  try {
    const result =
      mode === "project"
        ? await runner.runProject(cancellationController.token)
        : mode === "folders"
        ? await runner.runFolders(cancellationController.token)
        : await runner.runFiles(cancellationController.token);

    printTranslationResult(result, options.json);

    if (result.fatalError) {
      return 1;
    }
    return 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(
        JSON.stringify(
          {
            fatalError: errorMessage,
            cancelled: isOperationCancelledError(error),
          },
          null,
          2
        )
      );
    } else {
      logMessage(`❌ Fatal error: ${errorMessage}`, "error");
    }
    return 1;
  } finally {
    process.off("SIGINT", sigintHandler);
    cancellationController.dispose();
  }
}

async function withConfigDocument(
  options: GlobalOptions,
  fn: (workspaceRoot: string, configPath: string, raw: Record<string, unknown>) => Promise<void>
): Promise<number> {
  try {
    const workspaceRoot = resolveWorkspaceRoot(options.workspace);
    const configPath = resolveConfigFilePath(workspaceRoot, options.config);
    const raw = await loadRawConfigForEdit(configPath);
    await fn(workspaceRoot, configPath, raw);
    return 0;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Fatal: ${errorMessage}`);
    return 1;
  }
}

function addCommonOptions(command: Command): Command {
  return command
    .option("--workspace <path>", "工作区根目录，默认为当前目录")
    .option("--config <path>", "配置文件路径，默认 project.translation.json")
    .option("--json", "输出 JSON 结构化结果");
}

function mergeGlobalOptions(options: GlobalOptions, command?: Command): GlobalOptions {
  const merged: GlobalOptions = { ...options };
  let current: Command | null = command?.parent ?? null;

  while (current) {
    const parentOptions = current.opts() as GlobalOptions;
    if (merged.workspace === undefined && parentOptions.workspace !== undefined) {
      merged.workspace = parentOptions.workspace;
    }
    if (merged.config === undefined && parentOptions.config !== undefined) {
      merged.config = parentOptions.config;
    }
    if (merged.json === undefined && parentOptions.json !== undefined) {
      merged.json = parentOptions.json;
    }
    current = current.parent;
  }

  return merged;
}

async function main(): Promise<void> {
  const program = new Command();
  program.name("project-translator").description("Project Translator CLI").version("0.0.0-dev");

  const translate = addCommonOptions(program.command("translate").description("执行翻译任务"));

  addCommonOptions(
    translate.command("project").description("翻译项目")
  ).action(async (options: GlobalOptions, command: Command) => {
    process.exitCode = await runTranslateTask("project", mergeGlobalOptions(options, command));
  });

  addCommonOptions(
    translate.command("folders").description("按指定文件夹翻译")
  ).action(async (options: GlobalOptions, command: Command) => {
    process.exitCode = await runTranslateTask("folders", mergeGlobalOptions(options, command));
  });

  addCommonOptions(
    translate.command("files").description("按指定文件翻译")
  ).action(async (options: GlobalOptions, command: Command) => {
    process.exitCode = await runTranslateTask("files", mergeGlobalOptions(options, command));
  });

  const configCommand = program.command("config").description("配置管理");

  addCommonOptions(configCommand.command("list").description("查看完整配置"))
    .action(async (options: GlobalOptions) => {
      process.exitCode = await withConfigDocument(options, async (_workspaceRoot, _configPath, raw) => {
        if (options.json) {
          console.log(JSON.stringify(raw, null, 2));
        } else {
          console.log(JSON.stringify(raw, null, 2));
        }
      });
    });

  addCommonOptions(
    configCommand
      .command("get")
      .description("读取指定 keyPath")
      .argument("<keyPath...>", "配置键路径，例如 vendors.0.model")
  ).action(async (keyPaths: string[], options: GlobalOptions) => {
    process.exitCode = await withConfigDocument(options, async (_workspaceRoot, _configPath, raw) => {
      const result: Record<string, unknown> = {};
      for (const keyPath of keyPaths) {
        result[keyPath] = getByKeyPath(raw, keyPath);
      }
      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        for (const keyPath of keyPaths) {
          console.log(`${keyPath}=${JSON.stringify(result[keyPath])}`);
        }
      }
    });
  });

  addCommonOptions(
    configCommand
      .command("set")
      .description("设置指定 keyPath 的值")
      .argument("<keyPath>")
      .argument("<value>")
      .option("--type <type>", "auto|string|number|boolean|json", "auto")
  ).action(async (keyPath: string, value: string, cmdOptions: GlobalOptions & { type: string }) => {
    process.exitCode = await withConfigDocument(cmdOptions, async (_workspaceRoot, configPath, raw) => {
      const parsedValue = parseValueByType(value, cmdOptions.type || "auto");
      setByKeyPath(raw, keyPath, parsedValue);
      await saveRawConfigCanonical(configPath, raw);
      console.log(`Updated ${keyPath}`);
    });
  });

  const addCommand = configCommand.command("add").description("新增文件或文件夹映射");
  addCommonOptions(
    addCommand
      .command("file")
      .requiredOption("--source <path>")
      .requiredOption("--source-lang <lang>")
      .requiredOption("--target <path>")
      .requiredOption("--target-lang <lang>")
  ).action(async (cmdOptions: GlobalOptions & { source: string; sourceLang: string; target: string; targetLang: string }) => {
    process.exitCode = await withConfigDocument(cmdOptions, async (_workspaceRoot, configPath, raw) => {
      const specifiedFiles = (Array.isArray(raw.specifiedFiles) ? raw.specifiedFiles : []) as any[];
      const existing = specifiedFiles.find(
        (item) => item?.sourceFile?.path === cmdOptions.source && item?.sourceFile?.lang === cmdOptions.sourceLang
      );
      const newTarget = { path: cmdOptions.target, lang: cmdOptions.targetLang };

      if (existing) {
        existing.targetFiles = Array.isArray(existing.targetFiles) ? existing.targetFiles : [];
        const duplicated = existing.targetFiles.some(
          (t: any) => t?.path === newTarget.path && t?.lang === newTarget.lang
        );
        if (!duplicated) {
          existing.targetFiles.push(newTarget);
        }
      } else {
        specifiedFiles.push({
          sourceFile: { path: cmdOptions.source, lang: cmdOptions.sourceLang },
          targetFiles: [newTarget],
        });
      }

      raw.specifiedFiles = specifiedFiles;
      await saveRawConfigCanonical(configPath, raw);
      console.log("File mapping added");
    });
  });

  addCommonOptions(
    addCommand
      .command("folder")
      .requiredOption("--source <path>")
      .requiredOption("--source-lang <lang>")
      .requiredOption("--target <path>")
      .requiredOption("--target-lang <lang>")
  ).action(async (cmdOptions: GlobalOptions & { source: string; sourceLang: string; target: string; targetLang: string }) => {
    process.exitCode = await withConfigDocument(cmdOptions, async (_workspaceRoot, configPath, raw) => {
      const specifiedFolders = (Array.isArray(raw.specifiedFolders) ? raw.specifiedFolders : []) as any[];
      const existing = specifiedFolders.find(
        (item) => item?.sourceFolder?.path === cmdOptions.source && item?.sourceFolder?.lang === cmdOptions.sourceLang
      );
      const newTarget = { path: cmdOptions.target, lang: cmdOptions.targetLang };

      if (existing) {
        existing.targetFolders = Array.isArray(existing.targetFolders) ? existing.targetFolders : [];
        const duplicated = existing.targetFolders.some(
          (t: any) => t?.path === newTarget.path && t?.lang === newTarget.lang
        );
        if (!duplicated) {
          existing.targetFolders.push(newTarget);
        }
      } else {
        specifiedFolders.push({
          sourceFolder: { path: cmdOptions.source, lang: cmdOptions.sourceLang },
          targetFolders: [newTarget],
        });
      }

      raw.specifiedFolders = specifiedFolders;
      await saveRawConfigCanonical(configPath, raw);
      console.log("Folder mapping added");
    });
  });

  const removeCommand = configCommand.command("remove").description("删除文件或文件夹映射");

  addCommonOptions(
    removeCommand
      .command("file")
      .requiredOption("--source <path>")
      .option("--source-lang <lang>")
      .option("--target <path>")
      .option("--target-lang <lang>")
      .option("--all-targets")
  ).action(async (cmdOptions: GlobalOptions & { source: string; sourceLang?: string; target?: string; targetLang?: string; allTargets?: boolean }) => {
    process.exitCode = await withConfigDocument(cmdOptions, async (_workspaceRoot, configPath, raw) => {
      const specifiedFiles = (Array.isArray(raw.specifiedFiles) ? raw.specifiedFiles : []) as any[];
      const matchedIndexes = specifiedFiles
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          if (item?.sourceFile?.path !== cmdOptions.source) {
            return false;
          }
          if (cmdOptions.sourceLang && item?.sourceFile?.lang !== cmdOptions.sourceLang) {
            return false;
          }
          return true;
        })
        .map(({ index }) => index);

      if (matchedIndexes.length > 1 && !cmdOptions.sourceLang) {
        console.log("Multiple file mappings match this source path. Please specify --source-lang.");
        return;
      }
      const index = matchedIndexes[0] ?? -1;
      if (index < 0) {
        console.log("No matching file mapping found");
        return;
      }

      if (cmdOptions.allTargets || (!cmdOptions.target && !cmdOptions.targetLang)) {
        specifiedFiles.splice(index, 1);
      } else {
        const entry = specifiedFiles[index];
        const targetFiles = (Array.isArray(entry.targetFiles) ? entry.targetFiles : []).filter((target: any) => {
          if (cmdOptions.target && target?.path !== cmdOptions.target) {
            return true;
          }
          if (cmdOptions.targetLang && target?.lang !== cmdOptions.targetLang) {
            return true;
          }
          return false;
        });

        if (targetFiles.length === 0) {
          specifiedFiles.splice(index, 1);
        } else {
          entry.targetFiles = targetFiles;
        }
      }

      raw.specifiedFiles = specifiedFiles;
      await saveRawConfigCanonical(configPath, raw);
      console.log("File mapping removed");
    });
  });

  addCommonOptions(
    removeCommand
      .command("folder")
      .requiredOption("--source <path>")
      .option("--source-lang <lang>")
      .option("--target <path>")
      .option("--target-lang <lang>")
      .option("--all-targets")
  ).action(async (cmdOptions: GlobalOptions & { source: string; sourceLang?: string; target?: string; targetLang?: string; allTargets?: boolean }) => {
    process.exitCode = await withConfigDocument(cmdOptions, async (_workspaceRoot, configPath, raw) => {
      const specifiedFolders = (Array.isArray(raw.specifiedFolders) ? raw.specifiedFolders : []) as any[];
      const matchedIndexes = specifiedFolders
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          if (item?.sourceFolder?.path !== cmdOptions.source) {
            return false;
          }
          if (cmdOptions.sourceLang && item?.sourceFolder?.lang !== cmdOptions.sourceLang) {
            return false;
          }
          return true;
        })
        .map(({ index }) => index);

      if (matchedIndexes.length > 1 && !cmdOptions.sourceLang) {
        console.log("Multiple folder mappings match this source path. Please specify --source-lang.");
        return;
      }
      const index = matchedIndexes[0] ?? -1;
      if (index < 0) {
        console.log("No matching folder mapping found");
        return;
      }

      if (cmdOptions.allTargets || (!cmdOptions.target && !cmdOptions.targetLang)) {
        specifiedFolders.splice(index, 1);
      } else {
        const entry = specifiedFolders[index];
        const targetFolders = (Array.isArray(entry.targetFolders) ? entry.targetFolders : []).filter((target: any) => {
          if (cmdOptions.target && target?.path !== cmdOptions.target) {
            return true;
          }
          if (cmdOptions.targetLang && target?.lang !== cmdOptions.targetLang) {
            return true;
          }
          return false;
        });

        if (targetFolders.length === 0) {
          specifiedFolders.splice(index, 1);
        } else {
          entry.targetFolders = targetFolders;
        }
      }

      raw.specifiedFolders = specifiedFolders;
      await saveRawConfigCanonical(configPath, raw);
      console.log("Folder mapping removed");
    });
  });

  addCommonOptions(
    configCommand
      .command("export")
      .description("导出规范化配置")
      .option("--out <path>", "导出路径")
  ).action(async (cmdOptions: GlobalOptions & { out?: string }) => {
    process.exitCode = await withConfigDocument(cmdOptions, async (workspaceRoot, _configPath, raw) => {
      const outPath = cmdOptions.out
        ? path.resolve(workspaceRoot, cmdOptions.out)
        : path.join(workspaceRoot, "project.translation.export.json");
      await fs.promises.writeFile(outPath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
      console.log(`Exported to ${outPath}`);
    });
  });

  addCommonOptions(
    configCommand
      .command("schema")
      .description("导出配置 JSON Schema")
      .option("--out <path>", "schema 导出路径，默认 project.translation.schema.json")
  ).action(async (cmdOptions: GlobalOptions & { out?: string }) => {
    try {
      const workspaceRoot = resolveWorkspaceRoot(cmdOptions.workspace);
      const outPath = cmdOptions.out
        ? path.resolve(workspaceRoot, cmdOptions.out)
        : path.join(workspaceRoot, "project.translation.schema.json");
      await fs.promises.writeFile(outPath, getProjectTranslationSchemaJson(), "utf-8");
      console.log(`Schema exported to ${outPath}`);
      process.exitCode = 0;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Fatal: ${errorMessage}`);
      process.exitCode = 1;
    }
  });

  addCommonOptions(configCommand.command("validate").description("按 schema 校验配置文件"))
    .action(async (options: GlobalOptions) => {
      try {
        const workspaceRoot = resolveWorkspaceRoot(options.workspace);
        const configPath = resolveConfigFilePath(workspaceRoot, options.config);
        const raw = await loadRawConfigForEdit(configPath);
        const validationResult = validateProjectTranslationConfig(raw);

        if (options.json) {
          if (validationResult.valid) {
            console.log(JSON.stringify({ valid: true }, null, 2));
          } else {
            console.log(
              JSON.stringify(
                {
                  valid: false,
                  errors: validationResult.issues.map((issue) => ({
                    path: issue.path,
                    message: issue.message,
                  })),
                },
                null,
                2
              )
            );
          }
        } else if (validationResult.valid) {
          console.log("Config is valid");
        } else {
          console.log("Config is invalid");
          for (const issue of validationResult.issues) {
            console.log(` - ${issue.path}: ${issue.message}`);
          }
        }

        process.exitCode = validationResult.valid ? 0 : 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Fatal: ${errorMessage}`);
        process.exitCode = 1;
      }
    });

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Fatal: ${message}`);
  process.exit(1);
});
