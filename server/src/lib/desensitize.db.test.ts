import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { buildCompanyMap, applyCompanyMap, clearCompanyMapCache } from './desensitize'

/**
 * 公司简称映射（真实 DB，H9 回归）：
 * 简称纳入出站脱敏映射；与其他公司全名/编码/简称冲突时跳过登记（全名优先）。
 */

let dbReady = false
const codes = ['ENDSA1', 'ENDSA2', 'ENDSA3']

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    await basePrisma.company.createMany({
      data: [
        { code: 'ENDSA1', name: '脱敏全名甲', shortName: '脱敏甲简', entityType: 'single', status: 'active' },
        // 全名与甲的简称冲突：全名优先，甲的简称不登记
        { code: 'ENDSA2', name: '脱敏甲简', entityType: 'single', status: 'active' },
        { code: 'ENDSA3', name: '脱敏全名乙', shortName: '脱敏乙简', entityType: 'single', status: 'active' },
      ],
    })
    clearCompanyMapCache()
    dbReady = true
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.company.deleteMany({ where: { code: { in: codes } } }).catch(() => undefined)
  clearCompanyMapCache()
})

describe('buildCompanyMap 简称映射（真实 DB，H9 回归）', () => {
  it('无冲突简称入映射；与全名冲突时跳过（全名优先）', async () => {
    if (!dbReady) return
    const map = await buildCompanyMap()
    const aliasOfA = map.forward.get('脱敏全名甲')
    const aliasOfB = map.forward.get('脱敏甲简')
    const aliasOfC = map.forward.get('脱敏全名乙')
    expect(aliasOfA).toBeTruthy()
    expect(aliasOfB).toBeTruthy()
    expect(aliasOfC).toBeTruthy()
    // 无冲突简称 → 与全名同别名
    expect(map.forward.get('脱敏乙简')).toBe(aliasOfC)
    // 冲突简称 → 保持全名（乙公司）的映射，不指向甲
    expect(map.forward.get('脱敏甲简')).toBe(aliasOfB)
    expect(map.forward.get('脱敏甲简')).not.toBe(aliasOfA)
  })

  it('出站文本中的简称被替换为别名', async () => {
    if (!dbReady) return
    const map = await buildCompanyMap()
    const out = applyCompanyMap('脱敏乙简经营向好，脱敏全名乙份额提升', map)
    expect(out).not.toContain('脱敏乙简')
    expect(out).not.toContain('脱敏全名乙')
    expect(out).toContain(map.forward.get('脱敏全名乙')!)
  })
})
