import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  TOKEN_HEADER,
  createToken,
  loadOrCreateToken,
  isAllowedHost,
  tokenMatches,
  auditLine,
} from './panel-guard.mjs'

test('TOKEN_HEADER 使用 x-ops-token', () => {
  assert.equal(TOKEN_HEADER, 'x-ops-token')
})

test('createToken 生成 64 位十六进制且互不相同', () => {
  const a = createToken()
  const b = createToken()
  assert.match(a, /^[0-9a-f]{64}$/)
  assert.notEqual(a, b)
})

test('loadOrCreateToken 首次生成并在二次调用时复用', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-guard-'))
  const file = path.join(dir, '.panel-token')
  const first = loadOrCreateToken(file)
  assert.match(first, /^[0-9a-f]{64}$/)
  assert.equal(loadOrCreateToken(file), first)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadOrCreateToken 忽略空白并重建空文件', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-guard-'))
  const file = path.join(dir, '.panel-token')
  fs.writeFileSync(file, '   \n')
  assert.match(loadOrCreateToken(file), /^[0-9a-f]{64}$/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('isAllowedHost 仅放行回环主机名与面板端口', () => {
  assert.equal(isAllowedHost('127.0.0.1:3900', 3900), true)
  assert.equal(isAllowedHost('localhost:3900', 3900), true)
  assert.equal(isAllowedHost('LOCALHOST:3900', 3900), true)
  assert.equal(isAllowedHost('[::1]:3900', 3900), true)
  assert.equal(isAllowedHost('127.0.0.1:3901', 3900), false)
  assert.equal(isAllowedHost('evil.example.com:3900', 3900), false)
  assert.equal(isAllowedHost('127.0.0.1:3900.evil.com', 3900), false)
  assert.equal(isAllowedHost('', 3900), false)
  assert.equal(isAllowedHost(undefined, 3900), false)
})

test('tokenMatches 仅接受等值且等长的令牌', () => {
  const t = createToken()
  assert.equal(tokenMatches(t, t), true)
  assert.equal(tokenMatches('a'.repeat(64), t), false)
  assert.equal(tokenMatches('deadbeef', t), false)
  assert.equal(tokenMatches(t, t.slice(0, -1)), false)
  assert.equal(tokenMatches('', t), false)
  assert.equal(tokenMatches(t, ''), false)
  assert.equal(tokenMatches(undefined, t), false)
})

test('auditLine 输出单行 JSON 且含时间戳', () => {
  const line = auditLine({ action: 'POST /api/frp/restart', result: '200' })
  assert.equal(line.endsWith('\n'), true)
  const parsed = JSON.parse(line)
  assert.equal(parsed.action, 'POST /api/frp/restart')
  assert.equal(parsed.result, '200')
  assert.ok(!Number.isNaN(Date.parse(parsed.time)))
})
