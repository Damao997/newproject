import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assetPath, getApiBaseUrl, getBasePath, withBasePath } from '../portal-path'

describe('portal-path', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    vi.stubEnv('VITE_API_BASE_URL', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('根路径部署保持原路径', () => {
    expect(getBasePath()).toBe('')
    expect(getApiBaseUrl()).toBe('/api/v1')
    expect(withBasePath('/dashboard')).toBe('/dashboard')
    expect(assetPath('/logo.png')).toBe('/logo.png')
  })

  it('中台部署从 meta 读取前缀并应用到 API、跳转和资源', () => {
    const meta = document.createElement('meta')
    meta.name = 'app-base-path'
    meta.content = '/yipinhui-finance/'
    document.head.appendChild(meta)

    expect(getBasePath()).toBe('/yipinhui-finance')
    expect(getApiBaseUrl()).toBe('/yipinhui-finance/api/v1')
    expect(withBasePath('/login?expired=1')).toBe('/yipinhui-finance/login?expired=1')
    expect(assetPath('logo.png')).toBe('/yipinhui-finance/logo.png')
  })

  it('构建期显式 API 地址优先于中台前缀', () => {
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.example.test/v1/')
    expect(getApiBaseUrl()).toBe('https://api.example.test/v1')
  })
})
