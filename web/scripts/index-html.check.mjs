import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureRootBaseHref, hasRootBaseHref } from './index-html.mjs'

test('无 base 时注入根路径 base', () => {
  const html = ensureRootBaseHref('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  assert.match(html, /<base href="\/">/)
  assert.equal(hasRootBaseHref(html), true)
})

test('已有 base 时替换为根路径，避免中台前缀污染内部构建', () => {
  const html = ensureRootBaseHref('<html><head><base href="/yipinhui-finance/"></head></html>')
  assert.equal((html.match(/<base\b/gi) || []).length, 1)
  assert.equal(hasRootBaseHref(html), true)
})

test('重复执行保持单一根路径 base', () => {
  const once = ensureRootBaseHref('<html><head></head></html>')
  const twice = ensureRootBaseHref(once)
  assert.equal((twice.match(/<base\b/gi) || []).length, 1)
  assert.equal(hasRootBaseHref(twice), true)
})

test('缺少 head 时拒绝构建产物', () => {
  assert.throws(() => ensureRootBaseHref('<html><body></body></html>'), /head/)
})
