import { describe, expect, it } from 'vitest'
import { safeReturnPath } from '../safe-return-path'

describe('登录回跳路径校验（returnTo）', () => {
  it('接受站内相对路径（含查询与锚点）', () => {
    expect(safeReturnPath('/reports/preview-report/edit')).toBe('/reports/preview-report/edit')
    expect(safeReturnPath('/dashboard?period=2026-09#kpi')).toBe('/dashboard?period=2026-09#kpi')
    expect(safeReturnPath('/')).toBe('/')
  })

  it('拒绝非字符串、空值与超长值', () => {
    expect(safeReturnPath(undefined)).toBeNull()
    expect(safeReturnPath(null)).toBeNull()
    expect(safeReturnPath(42)).toBeNull()
    expect(safeReturnPath('')).toBeNull()
    expect(safeReturnPath('/' + 'a'.repeat(2048))).toBeNull()
  })

  it('拒绝协议与主机形式（开放重定向）', () => {
    expect(safeReturnPath('https://evil.example/login')).toBeNull()
    expect(safeReturnPath('//evil.example/path')).toBeNull()
    expect(safeReturnPath('/\\evil.example/path')).toBeNull()
    expect(safeReturnPath('/path\\with\\backslash')).toBeNull()
  })

  it('拒绝控制字符与伪协议路径', () => {
    expect(safeReturnPath('/path\nSet-Cookie: x')).toBeNull()
    expect(safeReturnPath('/path\t')).toBeNull()
    expect(safeReturnPath('/javascript:alert(1)')).toBeNull()
  })

  it('登录页自身交由调用方排除（helper 不越权判断页面语义）', () => {
    expect(safeReturnPath('/login')).toBe('/login')
    expect(safeReturnPath('/login?expired=1')).toBe('/login?expired=1')
  })
})
