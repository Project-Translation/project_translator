#!/usr/bin/env node
// 本地与CI复用的 Open VSX 发布脚本
// 读取 Token: OVSX_PAT / OPEN_VSX_TOKEN / OPENVSX_PAT / OPENVSX_TOKEN
// 用法：node scripts/ovsx-publish.mjs [path/to/file.vsix]

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

function getToken() {
  return (
    process.env.OVSX_PAT ||
    process.env.OPEN_VSX_TOKEN ||
    process.env.OPENVSX_PAT ||
    process.env.OPENVSX_TOKEN ||
    ''
  )
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

const token = getToken()
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

console.log(`🔎 使用 VSIX: ${vsix}`)
const bin = resolveOvsxBin()
const args = ['publish', vsix, '-p', token, '--skip-duplicate']
const result = spawnSync(bin, args, { stdio: 'inherit' })
process.exit(result.status ?? 1)

