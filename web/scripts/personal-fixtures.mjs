// 个人设置模拟写入仅在内存中保存，业务数据请求仍由原模拟接口处理。
import { user } from './redesign-fixtures.mjs'
export const fixturePreferences = { theme: 'light', showShortName: false, sidebarCollapsed: false, homePath: 'auto', favoriteCompanies: [], companyStartup: 'remember', defaultCompanies: [], periodStartup: 'remember', indicatorDensity: 'default' }
export function createPersonalFixtures(initial = {}) {
  let profile = { ...user, email: 'preview@example.test', phone: '', department: '经营分析组（模拟）', jobTitle: '数据分析', avatarVersion: null, updatedAt: '2026-10-03T00:00:00Z' }
  let preferences = { ...fixturePreferences, ...(initial.theme ? { theme: initial.theme } : {}) }
  let revision = initial.revision ?? 0
  const ok = data => ({ code: 0, data: structuredClone(data), message: '模拟设置已保存', traceId: 'personal-preview' })
  return (url, method = 'GET', body = {}) => {
    const path = new URL(url, 'http://127.0.0.1').pathname
    if (path.endsWith('/auth/profile')) {
      if (method === 'PATCH') profile = { ...profile, ...body, updatedAt: new Date().toISOString() }
      return ok(profile)
    }
    if (path.endsWith('/auth/preferences')) {
      if (method === 'PATCH') {
        if (body.revision !== revision) return { code: 409, data: null, message: '设置已在其他设备更新，请重新载入或确认重新提交', traceId: 'personal-preview' }
        preferences = { ...preferences, ...body.changes }; revision++
      }
      return ok({ preferences, revision })
    }
    if (path.endsWith('/auth/avatar')) {
      if (method === 'POST' || method === 'DELETE') {
        profile.avatarVersion = method === 'POST' ? 'preview-avatar-' + Date.now() : null
        return ok(profile)
      }
      if (!profile.avatarVersion) return { code: 404, data: null, message: '尚未设置头像', traceId: 'personal-preview' }
      return { binary: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1cAAAAASUVORK5CYII=', 'base64'), contentType: 'image/png' }
    }
    return null
  }
}
