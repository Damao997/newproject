import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { resolveCompanyCodes } from './AggregationService'

/**
 * 汇总主体「全有或全无」授权（真实 DB，无 DB 时整组跳过）。
 *
 * 回归目标：改造前 resolveCompanyCodes 对汇总主体做静默交集，
 * 只授权部分成员的用户会看到「部分成员之和」却被呈现为汇总总额（口径失真）。
 * 现改为成员未被完整授权即抛 403；且返回值不含汇总主体自身编码（防事实表重复计算）。
 */

let dbReady = false
const suffix = Date.now().toString(36)
const EN_A = `ENAGA${suffix}`.slice(0, 20)
const EN_B = `ENAGB${suffix}`.slice(0, 20)
const ET = `ETAGG${suffix}`.slice(0, 20)

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    await basePrisma.company.createMany({
      data: [
        { code: EN_A, name: `单体A_${suffix}`, entityType: 'single', status: 'active' },
        { code: EN_B, name: `单体B_${suffix}`, entityType: 'single', status: 'active' },
        { code: ET, name: `汇总_${suffix}`, entityType: 'summary', status: 'active' },
      ],
    })
    await basePrisma.companyAggregationMap.createMany({
      data: [
        { summaryCompanyCode: ET, singleCompanyCode: EN_A },
        { summaryCompanyCode: ET, singleCompanyCode: EN_B },
      ],
    })
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.companyAggregationMap
    .deleteMany({ where: { summaryCompanyCode: ET } })
    .catch(() => undefined)
  await basePrisma.company.deleteMany({ where: { code: { in: [EN_A, EN_B, ET] } } }).catch(() => undefined)
})

describe('汇总主体「全有或全无」授权（真实 DB）', () => {
  it('成员被完整授权 → 可访问汇总主体，展开为成员单体', async () => {
    if (!dbReady) return
    const codes = await resolveCompanyCodes(
      { companyCode: null, scopeValue: '', dataScopeCodes: [EN_A, EN_B] },
      ET,
    )
    expect([...codes].sort()).toEqual([EN_A, EN_B].sort())
    // 汇总主体自身编码不得进入事实表过滤集合（否则与成员值重复计算）
    expect(codes).not.toContain(ET)
  })

  it('仅授权部分成员 → 403，不再静默返回部分口径', async () => {
    if (!dbReady) return
    await expect(
      resolveCompanyCodes({ companyCode: null, scopeValue: '', dataScopeCodes: [EN_A] }, ET),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('直接分配汇总主体 → 可访问，且范围展开为成员', async () => {
    if (!dbReady) return
    const codes = await resolveCompanyCodes({ companyCode: null, scopeValue: '', dataScopeCodes: [ET] }, ET)
    expect([...codes].sort()).toEqual([EN_A, EN_B].sort())
  })

  it('scope=all → 汇总主体直接展开，无需额外授权', async () => {
    if (!dbReady) return
    const codes = await resolveCompanyCodes({ companyCode: null, scopeValue: '*' }, ET)
    expect([...codes].sort()).toEqual([EN_A, EN_B].sort())
  })

  it('请求范围外单体 → 403（默认拒绝，替代原静默空结果）', async () => {
    if (!dbReady) return
    await expect(
      resolveCompanyCodes({ companyCode: null, scopeValue: '', dataScopeCodes: [EN_A] }, EN_B),
    ).rejects.toMatchObject({ httpStatus: 403 })
  })

  it('不存在的公司编码 → 404', async () => {
    if (!dbReady) return
    await expect(
      resolveCompanyCodes({ companyCode: null, scopeValue: '*' }, '__NO_SUCH_COMPANY__'),
    ).rejects.toMatchObject({ httpStatus: 404 })
  })

  it('未指定请求公司 → 返回范围内全部单体（不含汇总编码）', async () => {
    if (!dbReady) return
    const codes = await resolveCompanyCodes({ companyCode: null, scopeValue: '', dataScopeCodes: [ET] })
    expect([...codes].sort()).toEqual([EN_A, EN_B].sort())
  })
})
