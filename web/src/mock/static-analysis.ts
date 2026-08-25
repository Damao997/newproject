import type { RawSubjectNode } from '@/lib/subject-tree'

/**
 * 静态分析科目层级（全量）——转录自《科目表重构.xlsx》「资产负债表」Sheet。
 *
 * 仅保留结构与数据类型；编码/层级/类别由 lib/subject-tree.ts 的 decorateTree 生成（BS_ 前缀）。
 * dataType：数据类=data、计算类=calc、展示类=display。
 */

// 紧凑构造器：d=数据类, c=计算类, p=展示类
const d = (name: string, children?: RawSubjectNode[]): RawSubjectNode => ({ name, dataType: 'data', children })
const c = (name: string, children?: RawSubjectNode[]): RawSubjectNode => ({ name, dataType: 'calc', children })
const p = (name: string, children?: RawSubjectNode[]): RawSubjectNode => ({ name, dataType: 'display', children })

export const rawStaticAnalysis: RawSubjectNode[] = [
  // 总资产（BS01）
  c('总资产', [
    d('银行存款'),
    d('应收账款'),
    c('存货', [
      d('壁挂炉'),
      d('燃气灶'),
      d('热水器'),
      d('消毒柜'),
      d('烟机'),
      d('波纹管'),
      d('报警器'),
      d('净水器'),
      d('充值宝'),
      d('高频产品'),
      d('橱柜'),
      d('发出商品'),
      d('其他'),
    ]),
    d('固定资产净值'),
    d('在建工程'),
  ]),

  // 总负债（BS02）
  c('总负债', [
    d('预收账款'),
    d('应付账款'),
    d('应付股利'),
  ]),

  // 权益净资产（BS03）
  c('权益净资产', [
    d('未分配利润'),
    d('内部往来'),
  ]),

  // 静态指标（BS04，比率/周转天数保留）
  p('静态指标', [
    c('总资产报酬率（ROA,%）'),
    c('资产负债率(%)'),
    c('净资产回报率（ROE,%）'),
    c('存货周转天数'),
    c('应收账款周转天数'),
  ]),
]
