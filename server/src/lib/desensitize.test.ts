import { describe, it, expect } from 'vitest'
import { applyCompanyMap, restoreCompanyMap, type CompanyMap } from './desensitize'

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

describe('desensitize 数值数据不脱敏', () => {
  it('金额、百分比、趋势方向等数值原样透传', () => {
    const map = fakeMap()
    const text = '浙江壹品慧杭州分公司收入 1,234.5 万元，同比 +12.3%，环比 -0.5%，趋势上升'
    const out = applyCompanyMap(text, map)
    // 公司名被脱敏
    expect(out).not.toContain('浙江壹品慧杭州分公司')
    // 数值数据保持原始状态
    expect(out).toContain('1,234.5 万元')
    expect(out).toContain('+12.3%')
    expect(out).toContain('-0.5%')
    expect(out).toContain('趋势上升')
    expect(out).not.toContain('小额')
    expect(out).not.toContain('百万级')
    expect(out).not.toContain('未知量级')
  })
})

describe('desensitize 边界与安全用例', () => {
  it('空文本原样返回', () => {
    const map = fakeMap()
    expect(applyCompanyMap('', map)).toBe('')
    expect(restoreCompanyMap('', map)).toBe('')
  })

  it('映射含空串 key 时不误替换且不死循环', () => {
    const forward = new Map<string, string>()
    const reverse = new Map<string, string>()
    forward.set('', '公司X') // 退化的空 key，应被忽略
    forward.set('杭州公司', '公司A')
    reverse.set('公司A', '杭州公司')
    const map: CompanyMap = { forward, reverse }
    expect(applyCompanyMap('宁波公司增长', map)).toBe('宁波公司增长')
    expect(applyCompanyMap('杭州公司增长', map)).toBe('公司A增长')
  })

  it('脱敏后不残留任何真实名称或编码（泄露断言）', () => {
    const map = fakeMap()
    const text = '浙江壹品慧杭州分公司(CO330059)与浙江壹品慧宁波分公司(CO330060)对比'
    const out = applyCompanyMap(text, map)
    for (const key of map.forward.keys()) {
      expect(out).not.toContain(key)
    }
  })

  it('别名跨 26 溢出（公司AA）不被公司A提前截断且往返稳定', () => {
    const forward = new Map<string, string>()
    const reverse = new Map<string, string>()
    forward.set('阿尔法实业', '公司A')
    forward.set('双A集团', '公司AA')
    reverse.set('公司A', '阿尔法实业')
    reverse.set('公司AA', '双A集团')
    const map: CompanyMap = { forward, reverse }
    const original = '双A集团与阿尔法实业并列'
    const desensitized = applyCompanyMap(original, map)
    expect(desensitized).toContain('公司AA')
    expect(restoreCompanyMap(desensitized, map)).toBe(original)
  })

  it('还原时真实公司名含别名子串不应被二次替换（顺序依赖污染）', () => {
    // reverse 插入顺序：先登记「公司B」（其真实名内含「公司A」子串），再登记「公司A」
    const forward = new Map<string, string>()
    const reverse = new Map<string, string>()
    reverse.set('公司B', '乙公司A事业部') // 真实名内含 “公司A”
    reverse.set('公司A', '甲企业')
    const map: CompanyMap = { forward, reverse }
    const restored = restoreCompanyMap('公司B业绩领先', map)
    // 单趟替换后，已还原文本不应再被「公司A→甲企业」二次替换
    expect(restored).toBe('乙公司A事业部业绩领先')
    expect(restored).not.toContain('甲企业')
  })
})
