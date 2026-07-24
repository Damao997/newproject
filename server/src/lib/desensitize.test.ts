import { describe, it, expect } from 'vitest'
import { applyCompanyMap, restoreCompanyMap, desensitizeAmountWan, type CompanyMap } from './desensitize'

/** 手工构造公司映射，避免依赖 DB */
function fakeMap(): CompanyMap {
  const forward = new Map<string, string>()
  const reverse = new Map<string, string>()
  forward.set('浙江壹品慧杭州分公司', '公司A')
  forward.set('CO330059', '公司A')
  forward.set('浙江壹品慧宁波分公司', '公司B')
  forward.set('CO330060', '公司B')
  reverse.set('公司A', '浙江壹品慧杭州分公司')
  reverse.set('公司B', '浙江壹品慧宁波分公司')
  return { forward, reverse }
}

describe('desensitize 公司名映射', () => {
  it('applyCompanyMap 将真实名称/编码替换为别名', () => {
    const map = fakeMap()
    const out = applyCompanyMap('浙江壹品慧杭州分公司(CO330059)收入增长', map)
    expect(out).not.toContain('浙江壹品慧杭州分公司')
    expect(out).not.toContain('CO330059')
    expect(out).toContain('公司A')
  })

  it('restoreCompanyMap 将别名还原为真实名称', () => {
    const map = fakeMap()
    const restored = restoreCompanyMap('公司A与公司B均实现增长', map)
    expect(restored).toContain('浙江壹品慧杭州分公司')
    expect(restored).toContain('浙江壹品慧宁波分公司')
    expect(restored).not.toContain('公司A')
  })

  it('往返映射稳定', () => {
    const map = fakeMap()
    const original = '浙江壹品慧杭州分公司同比上升'
    expect(restoreCompanyMap(applyCompanyMap(original, map), map)).toBe(original)
  })
})

describe('desensitizeAmountWan 金额分档（入参万元）', () => {
  it('按区间映射为标签', () => {
    expect(desensitizeAmountWan(5)).toBe('小额') // 5万=5万元<10万
    expect(desensitizeAmountWan(50)).toBe('十万级') // 50万=50万元
    expect(desensitizeAmountWan(300)).toBe('百万级') // 300万=3,000,000元 ∈[1e6,5e6)
    expect(desensitizeAmountWan(700)).toBe('五百万级') // 700万=7,000,000元 ∈[5e6,1e7)
    expect(desensitizeAmountWan(20000)).toBe('亿级') // 20000万=2亿
  })

  it('负数取绝对值', () => {
    expect(desensitizeAmountWan(-50)).toBe('十万级')
  })
})
