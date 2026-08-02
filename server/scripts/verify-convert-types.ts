import { basePrisma } from '../src/lib/prisma'

/**
 * 验证指标类型转换规则（HTTP 全流程，需本地服务运行在 3001 端口）：
 * 1) data → calc（带公式）→ calc → data（清空公式）→ data → display（只读终点）
 * 2) display 转出（→ data / → calc）必须被拒绝
 * 3) 测试科目与指标验证后物理清理，不留残留
 *
 * 用法：npx tsx scripts/verify-convert-types.ts
 */
const BASE = 'http://localhost:3001/api/v1'
const CODE = 'OP_TST_VERIFY'
// 公式操作数：取真实存在的叶子科目（编码体系为级联数字编码，如 OP_010101）
const OPERAND_CODE = 'OP_010101'

async function main(): Promise<void> {
  // 幂等清理：上次中断可能残留测试科目/指标
  await basePrisma.metric.deleteMany({ where: { code: CODE } }).catch(() => undefined)
  await basePrisma.accountSubject.deleteMany({ where: { code: CODE } }).catch(() => undefined)
  // 登录（superadmin，拥有 data:metric:convert）
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'superadmin', password: 'Yipinhui@2026' }),
  })
  const login = (await loginRes.json()) as { data?: { accessToken?: string } }
  const token = login.data?.accessToken
  if (!token) throw new Error('登录失败')
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const api = async (path: string, method: string, body?: unknown) => {
    const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const json = (await res.json()) as { code: number; data: unknown; message?: string }
    return { status: res.status, ...json }
  }

  const fail = (msg: string): never => {
    console.error(`[verify] 失败：${msg}`)
    process.exit(1)
  }
  const assert = (cond: boolean, msg: string): void => {
    if (!cond) fail(msg)
    console.log(`  ✓ ${msg}`)
  }

  // 1) 创建临时科目 + data 类指标
  let r = await api('/data/subjects', 'POST', { code: CODE, name: '类型转换验证科目', type: 'operating', category: '测试', isLeaf: true, valueType: 'amount', level: 0 })
  assert(r.code === 0, `创建测试科目（status=${r.status}）`)
  r = await api('/data/metrics', 'POST', { code: CODE, name: '类型转换验证科目', category: '测试', dataType: 'data' })
  assert(r.code === 0, '创建 data 类指标')
  const metricId = (r.data as { id: string }).id
  const metricOf = async () => {
    const q = await api('/data/metrics?pageSize=1000', 'GET')
    return (q.data as { items: Array<{ id: string; code: string; dataType: string; formula: string | null }> }).items.find((m) => m.code === CODE)
  }

  // 2) data → calc（带公式）
  r = await api(`/data/metrics/${metricId}/convert`, 'POST', { dataType: 'calc', formula: `{${OPERAND_CODE}}` })
  assert(r.code === 0, 'data → calc（带公式）成功')
  let m = await metricOf()
  assert(m?.dataType === 'calc' && m?.formula === `{${OPERAND_CODE}}`, `dataType=calc、formula='{${OPERAND_CODE}}'（实际 formula=${m?.formula}）`)

  // 3) calc → data（清空公式）
  r = await api(`/data/metrics/${metricId}/convert`, 'POST', { dataType: 'data' })
  assert(r.code === 0, 'calc → data（清空公式）成功')
  m = await metricOf()
  assert(m?.dataType === 'data' && m?.formula === null, 'dataType=data、formula 已清空')

  // 4) data → display（只读终点）
  r = await api(`/data/metrics/${metricId}/convert`, 'POST', { dataType: 'display' })
  assert(r.code === 0, 'data → display 成功')
  m = await metricOf()
  assert(m?.dataType === 'display', 'dataType=display')

  // 5) display 转出必须被拒绝（只读展示用途）
  r = await api(`/data/metrics/${metricId}/convert`, 'POST', { dataType: 'data' })
  assert(r.status === 400, `display → data 被拒绝（status=${r.status}）`)
  r = await api(`/data/metrics/${metricId}/convert`, 'POST', { dataType: 'calc', formula: `{${OPERAND_CODE}}` })
  assert(r.status === 400, `display → calc 被拒绝（status=${r.status}）`)

  // 6) 清理：停用 → 物理清除指标（含历史）→ 物理删除测试科目
  await api(`/data/metrics/${metricId}`, 'DELETE')
  await api(`/data/metrics/${metricId}/purge`, 'DELETE')
  await basePrisma.accountSubject.delete({ where: { code: CODE } })
  await basePrisma.$disconnect()
  console.log('[verify] 通过：类型转换规则全部符合预期，测试数据已清理')
}

main().catch((err) => {
  console.error('[verify] 异常：', err)
  process.exit(1)
})
