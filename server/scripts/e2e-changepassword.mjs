/* eslint-disable no-console */
/**
 * E2E：改密静默续期验证（真实 HTTP）
 * 1. 登录 → 改密（返回新令牌对）→ 用新 access token 访问 profile（无需重新登录）
 * 2. 改回原密码 → 恢复现场
 * 仅当种子密码仍有效时执行；否则跳过（密码已被人工修改）。
 */
const BASE = 'http://localhost:3001/api/v1'
const USERNAME = 'finance.manager'
const PASSWORD = 'Finance2026@'
const TEMP_PASSWORD = 'Temp2026@'

async function req(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json()
  return { status: res.status, json }
}

let failures = 0
function check(name, cond, detail = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`)
  if (!cond) failures += 1
}

async function main() {
  const login = await req('POST', '/auth/login', { username: USERNAME, password: PASSWORD })
  if (login.status !== 200) {
    console.log('SKIP  种子密码已失效（账号曾被人工改密），跳过改密 E2E')
    process.exit(0)
  }
  const { accessToken, refreshToken } = login.json.data

  // 改密 → 应返回新令牌对（静默续期契约）
  const chg = await req('PUT', '/auth/password', { oldPassword: PASSWORD, newPassword: TEMP_PASSWORD }, accessToken)
  check('改密成功并返回新令牌对', chg.status === 200 && chg.json.code === 0 && !!chg.json.data?.accessToken && !!chg.json.data?.refreshToken, `status=${chg.status}`)
  const newAccess = chg.json.data?.accessToken
  const newRefresh = chg.json.data?.refreshToken

  // 用新 access token 访问业务接口（无需重新登录）
  const profile = await req('GET', '/auth/profile', null, newAccess)
  check('新令牌可直接访问接口（无需重新登录）', profile.status === 200 && profile.json.data?.username === USERNAME, `status=${profile.status}`)

  // 旧 refresh token 已轮转失效、新 refresh token 可刷新
  const oldRefresh = await req('POST', '/auth/refresh', { refreshToken })
  check('旧 refresh token 已失效', oldRefresh.status === 401, `status=${oldRefresh.status}`)
  const newRefreshRes = await req('POST', '/auth/refresh', { refreshToken: newRefresh })
  check('新 refresh token 可轮转', newRefreshRes.status === 200, `status=${newRefreshRes.status}`)

  // 恢复现场：改回原密码（用轮转后的最新 access token）
  const latestAccess = newRefreshRes.json.data.accessToken
  const restore = await req('PUT', '/auth/password', { oldPassword: TEMP_PASSWORD, newPassword: PASSWORD }, latestAccess)
  check('改回原密码完成', restore.status === 200 && restore.json.code === 0, `status=${restore.status}`)
  const finalProfile = await req('GET', '/auth/profile', null, restore.json.data.accessToken)
  check('恢复后新令牌仍可用', finalProfile.status === 200, `status=${finalProfile.status}`)

  // 清理：登出
  const out = await req('POST', '/auth/logout', null, restore.json.data.accessToken)
  check('清理登出完成', out.status === 200, `status=${out.status}`)

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('E2E_ERROR:', e.message)
  process.exit(1)
})
