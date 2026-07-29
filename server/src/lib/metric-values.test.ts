import { describe, it, expect } from 'vitest'
import { seeded, generateOperatingLeaf, generateStaticLeaf, calcYoy, calcAchievement, OPERATING_DIMS, STATIC_DIMS } from './metric-values'

describe('确定性值生成器', () => {
  it('seeded 对相同输入恒定、不同输入不同', () => {
    const a = seeded('OP_010', 'CO330059', '2025-06', 'actual')
    const b = seeded('OP_010', 'CO330059', '2025-06', 'actual')
    const c = seeded('OP_010', 'CO330060', '2025-06', 'actual')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(1)
  })

  it('generateOperatingLeaf 返回 5 个期间维度且确定', () => {
    const v1 = generateOperatingLeaf('OP_010', 'CO330059', '2025-06')
    const v2 = generateOperatingLeaf('OP_010', 'CO330059', '2025-06')
    expect(Object.keys(v1).sort()).toEqual(Object.values(OPERATING_DIMS).sort())
    expect(v1).toEqual(v2)
    expect(v1[OPERATING_DIMS.ACTUAL_MONTH]).toBeGreaterThan(0)
  })

  it('generateStaticLeaf 返回 4 个期间维度', () => {
    const v = generateStaticLeaf('ST_001', 'CO330059', '2025-06-30')
    expect(Object.keys(v).sort()).toEqual(Object.values(STATIC_DIMS).sort())
  })

  it('calcYoy / calcAchievement 计算与除零保护', () => {
    expect(calcYoy(120, 100)).toBe(20)
    expect(calcYoy(120, 0)).toBe(0)
    // 达成率 = 本年累计 / 全年预算：累计 600 / 全年 1200 = 50%
    expect(calcAchievement(600, 1200)).toBe(50)
    expect(calcAchievement(90, 100)).toBe(90)
    expect(calcAchievement(90, 0)).toBe(0)
  })
})
