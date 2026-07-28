/* eslint-disable no-console */
// 权限管理优化改动 API 冒烟：登录 admin/superadmin，验证权限收紧、审计筛选、数据范围校验
const BASE = 'http://localhost:3001/api/v1'

async function login(username: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const body = (await res.json()) as { code: number; data: { accessToken: string; user: { permissions: string[]; dataScope: string } } }
  if (body.code !== 0) throw new Error(`登录失败 ${username}: ${JSON.stringify(body)}`)
  return body.data
}

async function get(token: string, path: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } })
  return { status: res.status, body: (await res.json()) as { code: number; data?: unknown; message?: string } }
}

async function main() {
  const pwd = 'Yipinhui@2026'
  const admin = await login('admin', pwd)
  const superadmin = await login('superadmin', pwd)

  console.log('[1] admin 不含 admin:permissions:update →', !admin.user.permissions.includes('admin:permissions:update') ? 'PASS' : 'FAIL')
  console.log('[2] superadmin 含 admin:permissions:update →', superadmin.user.permissions.includes('admin:permissions:update') ? 'PASS' : 'FAIL')

  // admin 调用权限更新接口应 403（需先取角色 id）
  const roles = await get(superadmin.accessToken, '/admin/roles')
  const viewerRole = (roles.body.data as { id: string; code: string; permissions: unknown[] }[]).find((r) => r.code === 'viewer')!
  const superRole = (roles.body.data as { id: string; code: string }[]).find((r) => r.code === 'superadmin')!

  const putPerm = async (token: string, roleId: string, permissions: unknown[]) => {
    const res = await fetch(`${BASE}/admin/roles/${roleId}/permissions`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ permissions }),
    })
    return res.status
  }
  const viewerPerms = (viewerRole.permissions as { resource: string; action: string }[]).map((p) => ({ resource: p.resource, action: p.action }))
  console.log('[3] admin 改权限 → 403：', (await putPerm(admin.accessToken, viewerRole.id, viewerPerms)) === 403 ? 'PASS' : 'FAIL')
  console.log('[4] superadmin 改预置角色(viewer)权限（原集回写）→ 200：', (await putPerm(superadmin.accessToken, viewerRole.id, viewerPerms)) === 200 ? 'PASS' : 'FAIL')
  console.log('[5] superadmin 改 superadmin 角色权限 → 403：', (await putPerm(superadmin.accessToken, superRole.id, [])) === 403 ? 'PASS' : 'FAIL')

  // 审计筛选
  const audit = await get(superadmin.accessToken, '/admin/audit-logs?page=1&pageSize=5&role=admin&module=admin&startDate=2026-01-01&endDate=2026-12-31')
  console.log('[6] 审计筛选（role+module+时间）→', audit.status === 200 && audit.body.code === 0 ? 'PASS' : `FAIL ${JSON.stringify(audit.body)}`)

  // 用户多选数据范围：无效编码 400
  const badUser = await fetch(`${BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${superadmin.accessToken}` },
    body: JSON.stringify({ username: `smoke.${Date.now().toString(36)}`, password: 'Test@123456', role: 'viewer', dataScopeCodes: ['NOT_EXIST'] }),
  })
  console.log('[7] 创建用户携带无效数据范围编码 → 400：', badUser.status === 400 ? 'PASS' : `FAIL ${badUser.status}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
