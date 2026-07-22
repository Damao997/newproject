import type { RawSubjectNode } from '@/lib/subject-tree'

/**
 * 静态指标科目层级（全量）——转录自《分析主体及汇总映射.xlsx》
 * 「静态指标科目层级」与「静态指标科目类型」两张表。
 *
 * 仅 level0-level1 两层；数据类型仅 数据类(data) / 计算类(calc)，无展示类。
 * 编码/层级/类别由 lib/subject-tree.ts 的 decorateTree(raw, 'ST') 生成。
 */

// 紧凑构造器：d=数据类, c=计算类
const d = (name: string, children?: RawSubjectNode[]): RawSubjectNode => ({ name, dataType: 'data', children })
const c = (name: string, children?: RawSubjectNode[]): RawSubjectNode => ({ name, dataType: 'calc', children })

export const rawStaticAnalysis: RawSubjectNode[] = [
  d('总资产'),
  d('银行存款'),
  c('应收账款', [
    d('集团内客户（含城燃体系）'),
    d('集团外客户'),
    d('已收燃易信'),
  ]),
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
  d('总负债'),
  d('预收账款'),
  d('应付账款'),
  d('内部往来'),
  d('应付股利'),
  d('权益净资产'),
  d('累计未分配利润(万元)'),
  c('总资产报酬率（ROA,%）'),
  c('资产负债率(%)'),
  c('净资产回报率（ROE,%）'),
  c('存货周转天数'),
  c('应收账款周转天数'),
]
