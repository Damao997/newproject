import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  compareVersions,
  fetchReleaseNotes,
  getCurrentVersion,
  getLastReadVersion,
  getLastSeenUpdateVersion,
  markUpdateSeen,
  markVersionRead,
} from '@/lib/app-version'

/**
 * app-version 边界测试。
 *
 * 重点覆盖版本号数字比较（v2026.08.10 > v2026.08.2，字符串比较会错）、
 * meta 标签读取与 localStorage 读写、release-notes.json 拉取失败降级。
 */

describe('compareVersions 版本号比较', () => {
  it('同月序号按数字比较（v2026.08.10 > v2026.08.2）', () => {
    expect(compareVersions('v2026.08.10', 'v2026.08.2')).toBeGreaterThan(0)
    expect(compareVersions('v2026.08.2', 'v2026.08.10')).toBeLessThan(0)
  })

  it('年份/月份递增时版本递增', () => {
    expect(compareVersions('v2026.08.1', 'v2026.08.2')).toBeLessThan(0)
    expect(compareVersions('v2026.07.9', 'v2026.08.1')).toBeLessThan(0)
    expect(compareVersions('v2025.12.1', 'v2026.01.1')).toBeLessThan(0)
  })

  it('相等版本返回 0', () => {
    expect(compareVersions('v2026.08.2', 'v2026.08.2')).toBe(0)
  })

  it('dev 与无法解析的版本视为最低', () => {
    expect(compareVersions('dev', 'v2026.08.1')).toBeLessThan(0)
    expect(compareVersions('v2026.08.1', 'dev')).toBeGreaterThan(0)
    expect(compareVersions('unknown', 'v2026.08.1')).toBeLessThan(0)
    expect(compareVersions('unknown', 'dev')).toBe(0)
  })
})

describe('getCurrentVersion 读取部署版本', () => {
  afterEach(() => {
    document.querySelector('meta[name="app-version"]')?.remove()
  })

  it('读取 meta 标签中的部署版本', () => {
    const meta = document.createElement('meta')
    meta.name = 'app-version'
    meta.content = 'v2026.08.2'
    document.head.appendChild(meta)
    expect(getCurrentVersion()).toBe('v2026.08.2')
  })

  it('无 meta 标签（开发环境）返回 dev', () => {
    expect(getCurrentVersion()).toBe('dev')
  })
})

describe('已读/已见版本 localStorage', () => {
  afterEach(() => {
    localStorage.clear()
  })

  it('默认未记录任何版本', () => {
    expect(getLastReadVersion()).toBeNull()
    expect(getLastSeenUpdateVersion()).toBeNull()
  })

  it('markVersionRead 写入后读取一致', () => {
    markVersionRead('v2026.08.2')
    expect(getLastReadVersion()).toBe('v2026.08.2')
  })

  it('markUpdateSeen 写入后读取一致', () => {
    markUpdateSeen('v2026.08.2')
    expect(getLastSeenUpdateVersion()).toBe('v2026.08.2')
  })
})

describe('fetchReleaseNotes 拉取发布说明', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('成功时返回发布列表', async () => {
    const data = {
      releases: [
        {
          version: 'v2026.08.1',
          publishedAt: '2026-08-07',
          title: '首版发布',
          notes: [{ type: 'feature', text: '核心模块上线' }],
        },
      ],
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => data }))
    await expect(fetchReleaseNotes()).resolves.toEqual(data)
  })

  it('HTTP 非 200 时降级为空列表', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    await expect(fetchReleaseNotes()).resolves.toEqual({ releases: [] })
  })

  it('网络异常时降级为空列表', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))
    await expect(fetchReleaseNotes()).resolves.toEqual({ releases: [] })
  })

  it('返回结构异常时降级为空列表', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ foo: 1 }) }))
    await expect(fetchReleaseNotes()).resolves.toEqual({ releases: [] })
  })
})
