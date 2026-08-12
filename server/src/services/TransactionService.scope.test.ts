import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { scopeStore } from '../middleware/scope-context'
import { TransactionService } from './TransactionService'
import type { DataScope } from '../middleware/scope'

/**
 * 往来分析数据范围隔离（真实 DB，无 DB 时整组跳过）。
 *
 * 回归目标：改造前 TransactionService 全部读方法直接采信查询串 companyCode，
 * 未传即返回全部公司数据 —— finance_manager/department_manager（scopeValue=''）可越权查看全部往来。
 * 现由 scopeContext 扩展在请求上下文内自动注入 companyCode 过滤。
 */

const CO_IN = 'EN999801'
const CO_OUT = 'EN999802'
const TYPE = '应收账款'
const PERIOD = '2099-05'
const CP = '__TEST_SCOPE_CP__'
const ACC = '__TEST_SCOPE_1122__'

let dbReady = false
const createdIds: string[] = []

/** 仅授权 CO_IN 的受限范围 */
const restricted: DataScope = { type: 'companies', companyCodes: [CO_IN], summaryCodes: [] }

function inScope<T>(scope: DataScope, fn: () => Promise<T>): Promise<T> {
  return scopeStore.run(scope, fn)
}

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    for (const companyCode of [CO_IN, CO_OUT]) {
      const row = await basePrisma.transactionDetail.create({
        data: {
          companyCode,
          transactionType: TYPE,
          direction: 'AR',
          counterpartyCode: CP,
          accountCode: ACC,
          closingBalance: 1000,
          isInternal: false,
          isEliminated: false,
          period: PERIOD,
        },
      })
      createdIds.push(row.id)
    }
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.transactionDetail
    .deleteMany({ where: { id: { in: createdIds } } })
    .catch(() => undefined)
})

describe('往来分析数据范围隔离（真实 DB）', () => {
  it('未传公司筛选时，受限范围只统计授权公司（核心越权回归）', async () => {
    if (!dbReady) return
    const rows = await inScope(restricted, () => TransactionService.getOverview({ period: PERIOD }))
    const item = rows.find((r) => r.transactionType === TYPE)
    expect(item).toBeDefined()
    // 两家公司各 1 条 1000；受限范围应只见 1 条
    expect(item?.recordCount).toBe(1)
    expect(item?.totalClosingBalance).toBe(1000)
  })

  it('全量范围可见两家公司（对照组，确认夹具有效）', async () => {
    if (!dbReady) return
    const rows = await inScope({ type: 'all' }, () => TransactionService.getOverview({ period: PERIOD }))
    const item = rows.find((r) => r.transactionType === TYPE)
    expect(item?.recordCount).toBe(2)
  })

  it('账龄分析：受限范围不含范围外公司', async () => {
    if (!dbReady) return
    const rows = (await inScope(restricted, () =>
      TransactionService.getAgingAnalysis({ transactionType: TYPE, period: PERIOD, groupBy: 'type' }),
    )) as Array<{ companyCode?: string }>
    expect(rows.every((r) => r.companyCode !== CO_OUT)).toBe(true)
  })

  it('往来对象列表与内部往来汇总同样受范围约束', async () => {
    if (!dbReady) return
    const cps = await inScope(restricted, () => TransactionService.listCounterparties([CO_OUT]))
    expect(cps).toHaveLength(0)
  })

  it('none 范围 → 空结果（默认拒绝，不回退全量）', async () => {
    if (!dbReady) return
    const rows = await inScope({ type: 'none' }, () => TransactionService.getOverview({ period: PERIOD }))
    expect(rows.find((r) => r.transactionType === TYPE)).toBeUndefined()
  })
})
