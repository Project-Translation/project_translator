#!/usr/bin/env node
// 本地与CI复用的 Open VSX 发布脚本
// 读取 Token: OVSX_PAT / OPEN_VSX_TOKEN / OPENVSX_PAT / OPENVSX_TOKEN
// 用法：node scripts/ovsx-publish.mjs [path/to/file.vsix]

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

function getTokenWithSource() {
  const entries = [
    ['OVSX_PAT', process.env.OVSX_PAT],
    ['OPEN_VSX_TOKEN', process.env.OPEN_VSX_TOKEN],
    ['OPENVSX_PAT', process.env.OPENVSX_PAT],
    ['OPENVSX_TOKEN', process.env.OPENVSX_TOKEN],
  ]

  for (const [name, value] of entries) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return { token: value.trim(), source: name }
    }
  }

  return { token: '', source: '' }
}

function findLatestVsix(cwd) {
  const files = readdirSync(cwd).filter(f => f.endsWith('.vsix'))
  if (files.length === 0) return null
  files.sort((a, b) => statSync(join(cwd, b)).mtimeMs - statSync(join(cwd, a)).mtimeMs)
  return files[0]
}

function resolveOvsxBin() {
  const localBin = resolve('node_modules', '.bin', process.platform === 'win32' ? 'ovsx.cmd' : 'ovsx')
  if (existsSync(localBin)) return localBin
  return 'ovsx' // fallback to PATH
}

function readNamespaceFromPackageJson(cwd) {
  try {
    const raw = readFileSync(resolve(cwd, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw)
    if (typeof pkg?.publisher === 'string' && pkg.publisher.trim().length > 0) {
      return pkg.publisher.trim()
    }
  } catch {
    // ignore
  }
  return null
}

function runOvsx(bin, args) {
  const result = spawnSync(bin, args, { stdio: 'inherit' })
  return result.status ?? 1
}

const { token, source: tokenSource } = getTokenWithSource()
if (!token) {
  console.error('❌ 未提供 Open VSX Token（支持 OVSX_PAT / OPEN_VSX_TOKEN / OPENVSX_PAT / OPENVSX_TOKEN）')
  process.exit(1)
}

const cwd = process.cwd()
const vsixArg = process.argv[2]
const vsix = vsixArg || findLatestVsix(cwd)
if (!vsix) {
  console.error('❌ 未找到 .vsix 文件，请先执行打包（npm run package 或任务“package vsix”）')
  process.exit(1)
}

const namespace = process.env.OVSX_NAMESPACE || readNamespaceFromPackageJson(cwd)

if (tokenSource) {
  console.log(`🔐 使用 Token 来源环境变量: ${tokenSource}`)
}
if (namespace) {
  console.log(`🔎 校验 PAT 是否可发布到 namespace: ${namespace}`)
  const verifyStatus = runOvsx(resolveOvsxBin(), ['-p', token, 'verify-pat', namespace])
  if (verifyStatus !== 0) {
    console.error('❌ PAT 校验失败：通常表示 Token 对应的 Open VSX 账号未签署 Publisher Agreement，或无权限发布到该 namespace。')
    console.error('   建议：用能发布 techfetch-dev 的账号重新生成 PAT，然后更新 OVSX_PAT（或设置 OVSX_NAMESPACE 进行覆盖）。')
    process.exit(verifyStatus)
  }
}

console.log(`🔎 使用 VSIX: ${vsix}`)
const bin = resolveOvsxBin()
const publishStatus = runOvsx(bin, ['-p', token, 'publish', vsix, '--skip-duplicate'])
process.exit(publishStatus)
