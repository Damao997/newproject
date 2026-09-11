import { describe, it, expect } from 'vitest'
import { pickMemberRootValue } from '../use-summary-member-values'
import type { OperatingRow } from '@/hooks/api-queries'

/**
 * pickMemberRootValue：看板 KPI 悬浮明细的成员树节点定位。
 * 口径须与后端 DashboardService.findInCategory 一致——先按 category 定位 level0 根，
 * rootName 提供时根名 includes 优先、未命中再子树 DFS。
 * 回归背景：净利润不是 level0 段名（是「经营成果」下的一级子科目「壹品慧净利润」），
 * 旧实现按 level0 根名精确匹配导致全员落空，浮层显示「成员公司暂无数据 + N 家加载失败」。
 */

/** 最小经营树行工厂（仅需 code/name/category/数值/children 字段） */
function row(partial: Partial<OperatingRow> & Pick<OperatingRow, 'code' | 'name' | 'category'>): OperatingRow {
  return {
    level: 0, dataType: 'data', valueType: 'amount', isLeaf: false,
    budget: 0, actual: 0, samePeriod: 0, ytd: 0, samePeriodYtd: 0, yoy: 0, achievement: 0, ytdYoy: 0,
    ...partial,
  }
}

/** 与 seed 科目树同构的精简经营树（经营成果段：净利润为一级子科目） */
const tree: OperatingRow[] = [
  row({ code: 'PL02', name: '壹品慧收入', category: '壹品慧收入', isLeaf: true, actual: 100, ytd: 1000 }),
  row({ code: 'PL04', name: '壹品慧毛利', category: '壹品慧毛利', isLeaf: true, actual: 40, ytd: 400 }),
  row({
    code: 'PL06', name: '经营成果', category: '经营成果', actual: 31, ytd: 310,
    children: [
      row({ code: 'PL0601', name: '壹品慧税前利润', category: '经营成果', level: 1, isLeaf: true, actual: 36, ytd: 360 }),
      row({ code: 'PL0602', name: '所得税费用', category: '经营成果', level: 1, isLeaf: true, actual: 5, ytd: 50 }),
      row({ code: 'PL0603', name: '壹品慧净利润', category: '经营成果', level: 1, isLeaf: true, actual: 31, ytd: 310 }),
    ],
  }),
  row({
    code: 'PL08', name: '经营指标', category: '经营指标', ytd: 77,
    children: [row({ code: 'PL0801', name: '劳效比', category: '经营指标', level: 1, isLeaf: true, ytd: 88 })],
  }),
]

describe('pickMemberRootValue（成员根节点定位，对齐后端 findInCategory）', () => {
  it('净利润：经营成果子树内名称关键字 DFS 命中「壹品慧净利润」（回归：旧实现 level0 精确匹配落空）', () => {
    const v = pickMemberRootValue(tree, 'operating', '经营成果', '净利润')
    expect(v?.actual).toBe(31)
    expect(v?.ytd).toBe(310)
  })

  it('仅按类目定位：命中 level0 根（毛利/收入卡场景）', () => {
    expect(pickMemberRootValue(tree, 'operating', '壹品慧毛利')?.actual).toBe(40)
    expect(pickMemberRootValue(tree, 'operating', '壹品慧收入')?.actual).toBe(100)
  })

  it('根名自身命中关键字时优先取根（不深入子树）', () => {
    const v = pickMemberRootValue(tree, 'operating', '经营指标', '指标')
    expect(v?.ytd).toBe(77)
  })

  it('类目不存在或名称无命中返回 undefined', () => {
    expect(pickMemberRootValue(tree, 'operating', '不存在类目')).toBeUndefined()
    expect(pickMemberRootValue(tree, 'operating', '经营成果', '营业外')).toBeUndefined()
  })
})
