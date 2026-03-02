import { expect } from 'chai'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawnSync } from 'child_process'

interface CliRunResult {
  status: number
  stdout: string
  stderr: string
}

const cliEntry = path.resolve(__dirname, '../../cli.js')

function runCli(args: string[], cwd: string): CliRunResult {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: 'utf-8',
  })

  if (result.error) {
    throw result.error
  }

  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function expectSuccess(result: CliRunResult): void {
  expect(result.status, `stderr: ${result.stderr}\nstdout: ${result.stdout}`).to.eq(0)
}

function readJsonFile(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
}

function writeJsonFile(filePath: string, data: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

describe('CLI mode', () => {
  let workspaceRoot = ''

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-translator-cli-'))
  })

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('supports config set/get with json typed values', () => {
    expectSuccess(
      runCli(
        ['config', 'set', 'currentVendor', 'deepseek', '--workspace', workspaceRoot],
        workspaceRoot
      )
    )
    expectSuccess(
      runCli(
        [
          'config',
          'set',
          'vendors',
          '[{"name":"deepseek","apiEndpoint":"https://api.deepseek.com/v1","model":"deepseek-chat"}]',
          '--type',
          'json',
          '--workspace',
          workspaceRoot,
        ],
        workspaceRoot
      )
    )

    const result = runCli(
      ['config', 'get', 'currentVendor', 'vendors', '--json', '--workspace', workspaceRoot],
      workspaceRoot
    )
    expectSuccess(result)

    const parsed = JSON.parse(result.stdout)
    expect(parsed.currentVendor).to.eq('deepseek')
    expect(parsed.vendors).to.be.an('array').with.length(1)
    expect(parsed.vendors[0].model).to.eq('deepseek-chat')
  })

  it('supports array index keyPath operations', () => {
    expectSuccess(
      runCli(
        ['config', 'set', 'currentVendor', 'deepseek', '--workspace', workspaceRoot],
        workspaceRoot
      )
    )
    expectSuccess(
      runCli(
        [
          'config',
          'set',
          'vendors',
          '[{"name":"deepseek","apiEndpoint":"https://api.deepseek.com/v1","model":"deepseek-chat"}]',
          '--type',
          'json',
          '--workspace',
          workspaceRoot,
        ],
        workspaceRoot
      )
    )
    expectSuccess(
      runCli(
        ['config', 'set', 'vendors.0.model', 'deepseek-reasoner', '--workspace', workspaceRoot],
        workspaceRoot
      )
    )

    const getResult = runCli(
      ['config', 'get', 'vendors.0.model', '--json', '--workspace', workspaceRoot],
      workspaceRoot
    )
    expectSuccess(getResult)

    const parsed = JSON.parse(getResult.stdout)
    expect(parsed['vendors.0.model']).to.eq('deepseek-reasoner')
    expect(readJsonFile(path.join(workspaceRoot, 'project.translation.json')).vendors[0].model).to.eq(
      'deepseek-reasoner'
    )
  })

  it('deduplicates targets when adding file mappings repeatedly', () => {
    const addArgs = [
      'config',
      'add',
      'file',
      '--source',
      'docs/en.md',
      '--source-lang',
      'en-us',
      '--target',
      'docs/zh.md',
      '--target-lang',
      'zh-cn',
      '--workspace',
      workspaceRoot,
    ]

    expectSuccess(runCli(addArgs, workspaceRoot))
    expectSuccess(runCli(addArgs, workspaceRoot))

    const configPath = path.join(workspaceRoot, 'project.translation.json')
    const raw = readJsonFile(configPath)

    expect(raw.specifiedFiles).to.be.an('array').with.length(1)
    expect(raw.specifiedFiles[0].sourceFile.path).to.eq('docs/en.md')
    expect(raw.specifiedFiles[0].targetFiles).to.be.an('array').with.length(1)
    expect(raw.specifiedFiles[0].targetFiles[0]).to.deep.eq({
      path: 'docs/zh.md',
      lang: 'zh-cn',
    })
  })

  it('removes file mappings by target and by all-targets', () => {
    const configPath = path.join(workspaceRoot, 'project.translation.json')
    writeJsonFile(configPath, {
      specifiedFiles: [
        {
          sourceFile: { path: 'docs/en.md', lang: 'en-us' },
          targetFiles: [
            { path: 'docs/zh.md', lang: 'zh-cn' },
            { path: 'docs/ja.md', lang: 'ja-jp' },
          ],
        },
      ],
    })

    expectSuccess(
      runCli(
        [
          'config',
          'remove',
          'file',
          '--source',
          'docs/en.md',
          '--target',
          'docs/zh.md',
          '--workspace',
          workspaceRoot,
        ],
        workspaceRoot
      )
    )

    let raw = readJsonFile(configPath)
    expect(raw.specifiedFiles).to.be.an('array').with.length(1)
    expect(raw.specifiedFiles[0].targetFiles).to.deep.eq([{ path: 'docs/ja.md', lang: 'ja-jp' }])

    expectSuccess(
      runCli(
        [
          'config',
          'remove',
          'file',
          '--source',
          'docs/en.md',
          '--all-targets',
          '--workspace',
          workspaceRoot,
        ],
        workspaceRoot
      )
    )

    raw = readJsonFile(configPath)
    expect(raw.specifiedFiles).to.be.an('array').that.is.empty
  })

  it('requires --source-lang when source path is ambiguous in remove file', () => {
    const configPath = path.join(workspaceRoot, 'project.translation.json')
    writeJsonFile(configPath, {
      specifiedFiles: [
        {
          sourceFile: { path: 'docs/en.md', lang: 'en-us' },
          targetFiles: [{ path: 'docs/zh.md', lang: 'zh-cn' }],
        },
        {
          sourceFile: { path: 'docs/en.md', lang: 'fr-fr' },
          targetFiles: [{ path: 'docs/fr.md', lang: 'fr-fr' }],
        },
      ],
    })

    const ambiguousResult = runCli(
      ['config', 'remove', 'file', '--source', 'docs/en.md', '--workspace', workspaceRoot],
      workspaceRoot
    )
    expectSuccess(ambiguousResult)
    expect(ambiguousResult.stdout).to.contain('Multiple file mappings match this source path')

    let raw = readJsonFile(configPath)
    expect(raw.specifiedFiles).to.be.an('array').with.length(2)

    expectSuccess(
      runCli(
        [
          'config',
          'remove',
          'file',
          '--source',
          'docs/en.md',
          '--source-lang',
          'fr-fr',
          '--workspace',
          workspaceRoot,
        ],
        workspaceRoot
      )
    )

    raw = readJsonFile(configPath)
    expect(raw.specifiedFiles).to.be.an('array').with.length(1)
    expect(raw.specifiedFiles[0].sourceFile.lang).to.eq('en-us')
  })

  it('adds and removes folder mappings with lang filter', () => {
    const addZh = [
      'config',
      'add',
      'folder',
      '--source',
      'content',
      '--source-lang',
      'en-us',
      '--target',
      'i18n/zh-cn/content',
      '--target-lang',
      'zh-cn',
      '--workspace',
      workspaceRoot,
    ]
    const addJa = [
      'config',
      'add',
      'folder',
      '--source',
      'content',
      '--source-lang',
      'en-us',
      '--target',
      'i18n/ja-jp/content',
      '--target-lang',
      'ja-jp',
      '--workspace',
      workspaceRoot,
    ]

    expectSuccess(runCli(addZh, workspaceRoot))
    expectSuccess(runCli(addJa, workspaceRoot))
    expectSuccess(
      runCli(
        [
          'config',
          'remove',
          'folder',
          '--source',
          'content',
          '--target-lang',
          'ja-jp',
          '--workspace',
          workspaceRoot,
        ],
        workspaceRoot
      )
    )

    const raw = readJsonFile(path.join(workspaceRoot, 'project.translation.json'))
    expect(raw.specifiedFolders).to.be.an('array').with.length(1)
    expect(raw.specifiedFolders[0].targetFolders).to.deep.eq([
      { path: 'i18n/zh-cn/content', lang: 'zh-cn' },
    ])
  })

  it('validates a valid config with json output', () => {
    const configPath = path.join(workspaceRoot, 'project.translation.json')
    writeJsonFile(configPath, {
      currentVendor: 'deepseek',
      vendors: [{ name: 'deepseek', apiEndpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }],
    })

    const result = runCli(['config', 'validate', '--json', '--workspace', workspaceRoot], workspaceRoot)
    expectSuccess(result)

    expect(JSON.parse(result.stdout)).to.deep.eq({ valid: true })
  })

  it('returns non-zero for invalid config validation', () => {
    const configPath = path.join(workspaceRoot, 'project.translation.json')
    writeJsonFile(configPath, {})

    const result = runCli(['config', 'validate', '--workspace', workspaceRoot], workspaceRoot)
    expect(result.status).to.eq(1)
    expect(result.stdout).to.contain('Config is invalid')
  })

  it('exports config schema to default path', () => {
    expectSuccess(
      runCli(
        ['config', 'schema', '--workspace', workspaceRoot],
        workspaceRoot
      )
    )

    const schemaPath = path.join(workspaceRoot, 'project.translation.schema.json')
    expect(fs.existsSync(schemaPath)).to.eq(true)

    const schema = readJsonFile(schemaPath)
    expect(schema.type).to.eq('object')
    expect(schema.required).to.deep.eq(['currentVendor', 'vendors'])
  })

  it('returns schema errors in json output for invalid config', () => {
    const configPath = path.join(workspaceRoot, 'project.translation.json')
    writeJsonFile(configPath, {
      currentVendor: 'deepseek',
      vendors: [],
    })

    const result = runCli(['config', 'validate', '--json', '--workspace', workspaceRoot], workspaceRoot)
    expect(result.status).to.eq(1)

    const parsed = JSON.parse(result.stdout)
    expect(parsed.valid).to.eq(false)
    expect(parsed.errors).to.be.an('array').that.is.not.empty
  })

  it('exports canonical config to a custom path', () => {
    const configPath = path.join(workspaceRoot, 'project.translation.json')
    writeJsonFile(configPath, {
      currentVendor: 'deepseek',
      'projectTranslator.debug': true,
    })

    expectSuccess(
      runCli(
        ['config', 'export', '--out', 'exported.json', '--workspace', workspaceRoot],
        workspaceRoot
      )
    )

    const exportedPath = path.join(workspaceRoot, 'exported.json')
    expect(fs.existsSync(exportedPath)).to.eq(true)
    expect(readJsonFile(exportedPath)).to.deep.include({
      currentVendor: 'deepseek',
      debug: true,
    })
  })

  it('resolves relative --config path under workspace', () => {
    const relativeConfigPath = 'configs/custom.translation.json'
    expectSuccess(
      runCli(
        [
          'config',
          'set',
          'translationIntervalDays',
          '7',
          '--type',
          'number',
          '--config',
          relativeConfigPath,
          '--workspace',
          workspaceRoot,
        ],
        workspaceRoot
      )
    )

    const createdPath = path.join(workspaceRoot, relativeConfigPath)
    expect(fs.existsSync(createdPath)).to.eq(true)
    expect(readJsonFile(createdPath).translationIntervalDays).to.eq(7)
  })

  it('returns structured error for translate project with no tasks', () => {
    const configPath = path.join(workspaceRoot, 'project.translation.json')
    writeJsonFile(configPath, {
      currentVendor: 'deepseek',
      vendors: [{ name: 'deepseek', apiEndpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }],
      specifiedFiles: [],
      specifiedFolders: [],
    })

    const result = runCli(
      ['translate', 'project', '--json', '--workspace', workspaceRoot],
      workspaceRoot
    )

    expect(result.status).to.eq(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.cancelled).to.eq(false)
    expect(parsed.fatalError).to.contain('No translation tasks configured')
  })

  it('supports translate parent --config option before subcommand', () => {
    const customConfigPath = path.join(workspaceRoot, 'configs', 'translate.parent.json')
    writeJsonFile(customConfigPath, {
      currentVendor: 'deepseek',
      vendors: [{ name: 'deepseek', apiEndpoint: 'https://api.deepseek.com/v1', model: 'deepseek-chat' }],
      specifiedFiles: [],
      specifiedFolders: [],
    })

    const result = runCli(
      ['translate', '--config', 'configs/translate.parent.json', 'project', '--json', '--workspace', workspaceRoot],
      workspaceRoot
    )

    expect(result.status).to.eq(1)
    const parsed = JSON.parse(result.stdout)
    expect(parsed.cancelled).to.eq(false)
    expect(parsed.fatalError).to.contain('No translation tasks configured')
  })
})
