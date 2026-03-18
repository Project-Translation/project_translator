import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import type { RuntimeContext } from '../../runtime/types'
import { TranslationRunner } from '../../app/translationRunner'
import * as configModule from '../../config/config'
import * as translatorServiceModule from '../../services/translatorService'
import * as fileProcessorModule from '../../services/fileProcessor'
import * as translationDatabaseModule from '../../translationDatabase'
import * as analyticsModule from '../../services/analytics'

const CANCELLATION_CODE = 'E_OPERATION_CANCELLED'

interface HarnessOptions {
  workspaceRoot: string
  config: Record<string, unknown>
  processDirectoryError?: Error
  processFileError?: Error
}

interface HarnessCalls {
  clearConfigurationCache: number
  initializeOpenAIClient: number
  setTranslationState: number
  processDirectory: number
  processFile: number
  close: number
  sendSettingsData: number
}

function patchExport(
  moduleObject: Record<string, unknown>,
  key: string,
  replacement: unknown,
  restoreStack: Array<() => void>
): void {
  const original = moduleObject[key]
  moduleObject[key] = replacement
  restoreStack.push(() => {
    moduleObject[key] = original
  })
}

function createRuntimeContext(workspaceRoot: string): RuntimeContext {
  return {
    workspaceRoot,
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    },
    notifier: {
      showInfo: () => undefined,
      showWarn: () => undefined,
      showError: () => undefined,
    },
    configProvider: {
      async getConfiguration() {
        return {} as any
      },
    },
    createCancellationController() {
      const token = { isCancellationRequested: false }
      return {
        token,
        cancel() {
          token.isCancellationRequested = true
        },
        dispose() {
          token.isCancellationRequested = true
        },
      }
    },
    createCancellationError(message?: string) {
      const error = new Error(message || 'cancelled') as Error & { code: string }
      error.name = 'OperationCancelledError'
      error.code = CANCELLATION_CODE
      return error
    },
    isCancellationError(error: unknown) {
      if (!(error instanceof Error)) {
        return false
      }
      return error.name === 'OperationCancelledError' || (error as any).code === CANCELLATION_CODE
    },
    async getMachineId() {
      return 'machine-id-test'
    },
  }
}

function createCancelledError(message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string }
  error.name = 'OperationCancelledError'
  error.code = CANCELLATION_CODE
  return error
}

function setupHarness(
  options: HarnessOptions,
  restoreStack: Array<() => void>
): { runner: TranslationRunner; calls: HarnessCalls } {
  const calls: HarnessCalls = {
    clearConfigurationCache: 0,
    initializeOpenAIClient: 0,
    setTranslationState: 0,
    processDirectory: 0,
    processFile: 0,
    close: 0,
    sendSettingsData: 0,
  }

  patchExport(
    configModule,
    'clearConfigurationCache',
    () => {
      calls.clearConfigurationCache++
    },
    restoreStack
  )
  patchExport(
    configModule,
    'getConfiguration',
    async () => options.config,
    restoreStack
  )

  class FakeTranslatorService {
    constructor(_runtimeContext: RuntimeContext) {}

    async initializeOpenAIClient(): Promise<void> {
      calls.initializeOpenAIClient++
    }

    getTokenCounts() {
      return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    }
  }

  class FakeTranslationDatabase {
    constructor(_workspaceRoot: string, _runtimeContext: RuntimeContext) {}

    setSourceRoot(_sourceRoot: string): void {}

    clearTargetRoots(): void {}

    setTargetRoot(_targetRoot: string, _lang: string): void {}

    async close(): Promise<void> {
      calls.close++
    }
  }

  class FakeFileProcessor {
    constructor(_runtimeContext: RuntimeContext, _db: unknown, _translator: unknown) {}

    setTranslationState(_paused: boolean, _token: { isCancellationRequested: boolean }): void {
      calls.setTranslationState++
    }

    async processDirectory(
      _sourcePath: string,
      _targets: Array<{ path: string; lang: string }>,
      _sourceLang: string
    ): Promise<void> {
      calls.processDirectory++
      if (options.processDirectoryError) {
        throw options.processDirectoryError
      }
    }

    async processFile(
      _sourcePath: string,
      _targetPath: string,
      _sourceLang: string,
      _targetLang: string
    ): Promise<void> {
      calls.processFile++
      if (options.processFileError) {
        throw options.processFileError
      }
    }

    getProcessingStats() {
      return {
        processedFiles: 0,
        skippedFiles: 0,
        failedFiles: 0,
        failedPaths: [],
      }
    }
  }

  class FakeAnalyticsService {
    constructor(_runtimeContext: RuntimeContext, _machineId: string) {}

    async sendSettingsData(_settings: unknown): Promise<void> {
      calls.sendSettingsData++
    }
  }

  patchExport(translatorServiceModule, 'TranslatorService', FakeTranslatorService, restoreStack)
  patchExport(translationDatabaseModule, 'TranslationDatabase', FakeTranslationDatabase, restoreStack)
  patchExport(fileProcessorModule, 'FileProcessor', FakeFileProcessor, restoreStack)
  patchExport(analyticsModule, 'AnalyticsService', FakeAnalyticsService, restoreStack)

  const runtimeContext = createRuntimeContext(options.workspaceRoot)
  return {
    runner: new TranslationRunner(runtimeContext),
    calls,
  }
}

describe('TranslationRunner branches (folders/files)', () => {
  let restoreStack: Array<() => void> = []
  let tempDirs: string[] = []

  function createTempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (restoreStack.length > 0) {
      const restore = restoreStack.pop()
      restore?.()
    }
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
    tempDirs = []
  })

  it('runFolders returns cancelled when token is already cancelled', async () => {
    const workspaceRoot = createTempDir('runner-folders-cancel-token-')
    const sourceFolder = createTempDir('runner-folders-source-')

    const { runner, calls } = setupHarness(
      {
        workspaceRoot,
        config: {
          specifiedFolders: [
            {
              sourceFolder: { path: sourceFolder, lang: 'en-us' },
              targetFolders: [{ path: 'i18n/zh-cn/docs', lang: 'zh-cn' }],
            },
          ],
        },
      },
      restoreStack
    )

    const result = await runner.runFolders({ isCancellationRequested: true })

    expect(result.cancelled).to.eq(true)
    expect(result.fatalError).to.eq(undefined)
    expect(result.processedFiles).to.eq(0)
    expect(calls.processDirectory).to.eq(0)
    expect(calls.close).to.eq(1)
    expect(calls.sendSettingsData).to.eq(0)
  })

  it('runFolders returns cancelled when processor throws cancellation error', async () => {
    const workspaceRoot = createTempDir('runner-folders-cancel-error-')
    const sourceFolder = createTempDir('runner-folders-source-')

    const { runner, calls } = setupHarness(
      {
        workspaceRoot,
        config: {
          specifiedFolders: [
            {
              sourceFolder: { path: sourceFolder, lang: 'en-us' },
              targetFolders: [{ path: 'i18n/zh-cn/docs', lang: 'zh-cn' }],
            },
          ],
        },
        processDirectoryError: createCancelledError('cancel in processDirectory'),
      },
      restoreStack
    )

    const result = await runner.runFolders({ isCancellationRequested: false })

    expect(result.cancelled).to.eq(true)
    expect(result.fatalError).to.eq(undefined)
    expect(calls.processDirectory).to.eq(1)
    expect(calls.close).to.eq(1)
    expect(calls.sendSettingsData).to.eq(0)
  })

  it('runFolders returns fatalError when processor throws normal error', async () => {
    const workspaceRoot = createTempDir('runner-folders-fatal-error-')
    const sourceFolder = createTempDir('runner-folders-source-')

    const { runner, calls } = setupHarness(
      {
        workspaceRoot,
        config: {
          specifiedFolders: [
            {
              sourceFolder: { path: sourceFolder, lang: 'en-us' },
              targetFolders: [{ path: 'i18n/zh-cn/docs', lang: 'zh-cn' }],
            },
          ],
        },
        processDirectoryError: new Error('processDirectory failed'),
      },
      restoreStack
    )

    const result = await runner.runFolders({ isCancellationRequested: false })

    expect(result.cancelled).to.eq(false)
    expect(result.fatalError).to.contain('processDirectory failed')
    expect(calls.processDirectory).to.eq(1)
    expect(calls.close).to.eq(1)
    expect(calls.sendSettingsData).to.eq(0)
  })

  it('runFiles returns cancelled when token is already cancelled', async () => {
    const workspaceRoot = createTempDir('runner-files-cancel-token-')

    const { runner, calls } = setupHarness(
      {
        workspaceRoot,
        config: {
          specifiedFiles: [
            {
              sourceFile: { path: 'docs/en.md', lang: 'en-us' },
              targetFiles: [{ path: 'docs/zh.md', lang: 'zh-cn' }],
            },
          ],
        },
      },
      restoreStack
    )

    const result = await runner.runFiles({ isCancellationRequested: true })

    expect(result.cancelled).to.eq(true)
    expect(result.fatalError).to.eq(undefined)
    expect(calls.processFile).to.eq(0)
    expect(calls.close).to.eq(1)
    expect(calls.sendSettingsData).to.eq(0)
  })

  it('runFiles returns cancelled when processor throws cancellation error', async () => {
    const workspaceRoot = createTempDir('runner-files-cancel-error-')

    const { runner, calls } = setupHarness(
      {
        workspaceRoot,
        config: {
          specifiedFiles: [
            {
              sourceFile: { path: 'docs/en.md', lang: 'en-us' },
              targetFiles: [{ path: 'docs/zh.md', lang: 'zh-cn' }],
            },
          ],
        },
        processFileError: createCancelledError('cancel in processFile'),
      },
      restoreStack
    )

    const result = await runner.runFiles({ isCancellationRequested: false })

    expect(result.cancelled).to.eq(true)
    expect(result.fatalError).to.eq(undefined)
    expect(calls.processFile).to.eq(1)
    expect(calls.close).to.eq(1)
    expect(calls.sendSettingsData).to.eq(0)
  })

  it('runFiles returns fatalError when processor throws normal error', async () => {
    const workspaceRoot = createTempDir('runner-files-fatal-error-')

    const { runner, calls } = setupHarness(
      {
        workspaceRoot,
        config: {
          specifiedFiles: [
            {
              sourceFile: { path: 'docs/en.md', lang: 'en-us' },
              targetFiles: [{ path: 'docs/zh.md', lang: 'zh-cn' }],
            },
          ],
        },
        processFileError: new Error('processFile failed'),
      },
      restoreStack
    )

    const result = await runner.runFiles({ isCancellationRequested: false })

    expect(result.cancelled).to.eq(false)
    expect(result.fatalError).to.contain('processFile failed')
    expect(calls.processFile).to.eq(1)
    expect(calls.close).to.eq(1)
    expect(calls.sendSettingsData).to.eq(0)
  })
})
