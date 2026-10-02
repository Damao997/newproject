import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isChunkLoadError, installChunkReloadGuard } from '@/lib/chunk-reload'

/**
 * 构建产物失效恢复测试（2026-10-02 生产事故）：
 * 部署后旧页面动态 import 失效 chunk 会报这些文案，需要被识别并触发整页刷新。
 */

describe('isChunkLoadError', () => {
  it('识别动态导入失败（Vite 产物失效）', () => {
    expect(
      isChunkLoadError(new Error('Failed to fetch dynamically imported module: http://192.168.1.201:8080/assets/a.js')),
    ).toBe(true)
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError('error loading dynamically imported module')).toBe(true)
  })

  it('普通渲染错误不视为产物失效', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined (reading x)'))).toBe(false)
    expect(isChunkLoadError(undefined)).toBe(false)
    expect(isChunkLoadError('')).toBe(false)
  })
})

describe('installChunkReloadGuard', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('产物加载失败时整页刷新一次，时间窗内重复失败不再刷新', () => {
    const reload = vi.fn()
    // jsdom 的 Location 实例不允许重定义 reload，改为整体替换 window.location
    // （实现只使用 location.reload()，替换为最小桩对象即可）
    const original = window.location
    Object.defineProperty(window, 'location', { configurable: true, writable: true, value: { reload } })

    try {
      installChunkReloadGuard()
      window.dispatchEvent(new Event('vite:preloadError'))
      expect(reload).toHaveBeenCalledTimes(1)

      window.dispatchEvent(new Event('vite:preloadError'))
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: original })
    }
  })
})