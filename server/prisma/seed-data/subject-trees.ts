/**
 * 科目层级种子数据（转录自前端 mock，保证编码/层级/类别与前端 decorateTree 一致）。
 * 级联赋码：OP_02 / OP_0201 / OP_020101...（每级 2 位，子码=父码+序号）；level=深度；category=level0 根名。
 */

/**
 * level0 科目段位表（名称 → 2 位段位，会计大类分段）。
 * 经营科目 01-08；静态科目按 资产 10-19 / 负债 20-29 / 权益 30-39 / 比率 40-49。
 * 新增 level0 大类必须在此登记段位，decorateTree 对未登记名称抛错。
 */
export const SUBJECT_SEGMENT_MAP: Record<string, string> = {
  // 经营科目
  '回款': '01',
  '收入': '02',
  '成本': '03',
  '毛利': '04',
  '费用': '05',
  '经营指标': '06',
  '财务指标': '07',
  '现金流指标': '08',
  // 静态科目（资产）
  '总资产': '10',
  '银行存款': '11',
  '应收账款': '12',
  '存货': '13',
  '固定资产净值': '14',
  '在建工程': '15',
  // 静态科目（负债）
  '总负债': '20',
  '预收账款': '21',
  '应付账款': '22',
  '内部往来': '23',
  '应付股利': '24',
  // 静态科目（权益）
  '权益净资产': '30',
  '累计未分配利润(万元)': '31',
  // 静态科目（比率）
  '总资产报酬率（ROA,%）': '40',
  '资产负债率(%)': '41',
  '净资产回报率（ROE,%）': '42',
  '存货周转天数': '43',
  '应收账款周转天数': '44',
}

/** level0 编码：前缀 + 段位表登记段位（未登记抛错，强制维护） */
export function rootSubjectCodeOf(prefix: 'OP' | 'ST', name: string): string {
  const segment = SUBJECT_SEGMENT_MAP[name]
  if (!segment) throw new Error(`科目未登记 level0 段位：${name}（请向 SUBJECT_SEGMENT_MAP 补充）`)
  return `${prefix}_${segment}`
}

/** 子级编码：父码数字段 + 2 位序号 */
export function childSubjectCodeOf(parentCode: string, seq: number): string {
  return `${parentCode}${String(seq).padStart(2, '0')}`
}

export interface RawSubjectNode {
  name: string
  dataType: 'data' | 'calc' | 'display'
  children?: RawSubjectNode[]
}

export interface DecoratedSubject {
  code: string
  name: string
  subjectType: 'operating' | 'static'
  level: number
  parentCode: string | null
  category: string
  direction: 'debit' | 'credit'
  valueType: 'amount' | 'quantity' | 'ratio'
  isLeaf: boolean
  dataType: 'data' | 'calc' | 'display'
  orderNo: number
}

const d = (name: string, children?: RawSubjectNode[]): RawSubjectNode => ({ name, dataType: 'data', children })
const c = (name: string, children?: RawSubjectNode[]): RawSubjectNode => ({ name, dataType: 'calc', children })
const p = (name: string, children?: RawSubjectNode[]): RawSubjectNode => ({ name, dataType: 'display', children })

export const rawOperatingAnalysis: RawSubjectNode[] = [
  c('回款', [c('壹品慧回款', [d('增值业务回款'), d('直饮水业务回款')])]),
  c('收入', [
    c('壹品慧收入', [
      c('增值业务收入', [
        c('厨房产品销售收入（不含净水及服务）', [
          d('燃气具-灶具收入'), d('燃气具-热水器收入'), d('燃气具-烟机收入'), d('燃气具-消毒柜收入'),
          d('燃气具-壁挂炉收入'), d('燃气具-其他厨房用品收入'), d('燃气具售后/安装/维保服务收入'),
        ]),
        c('安防产品销售与服务收入', [d('波纹管收入'), d('报警器收入'), d('安防产品服务收入')]),
        d('优选产品收入'), d('家用电器收入（含净水）'), d('宜居产品收入'), d('宣传推广收入'),
        d('维修改造业务收入'), d('新产品及其它收入'),
      ]),
      d('安检业务收入'),
      c('直饮水业务收入', [d('直饮水安装收入'), d('直饮水售水收入')]),
      d('其他业务收入'),
    ]),
  ]),
  c('成本', [
    c('壹品慧成本', [
      c('增值业务成本', [
        c('厨房产品销售成本（不含净水及服务）', [
          d('燃气具-灶具成本'), d('燃气具-热水器成本'), d('燃气具-烟机成本'), d('燃气具-消毒柜成本'),
          d('燃气具-壁挂炉成本'), d('燃气具-其他厨房用品成本'), d('燃气具售后/安装/维保服务成本'),
        ]),
        c('安防产品销售与服务成本', [d('波纹管成本'), d('报警器成本'), d('安防产品服务成本')]),
        d('优选产品成本'), d('家用电器成本（含净水）'), d('宜居产品成本'), d('宣传推广成本'),
        d('维修改造业务成本'), d('新产品及其它成本'),
      ]),
      d('安检业务成本'),
      c('直饮水业务成本', [d('直饮水安装成本'), d('直饮水售水成本')]),
      d('其他业务成本'),
    ]),
  ]),
  c('毛利', [
    c('壹品慧毛利', [
      c('增值业务毛利', [
        c('厨房产品销售毛利（不含净水及服务）', [
          c('燃气具-灶具毛利'), c('燃气具-热水器毛利'), c('燃气具-烟机毛利'), c('燃气具-消毒柜毛利'),
          c('燃气具-壁挂炉毛利'), c('燃气具-其他厨房用品毛利'), c('燃气具售后/安装/维保服务毛利'),
        ]),
        c('安防产品销售与服务毛利', [c('波纹管毛利'), c('报警器毛利'), c('安防产品服务毛利')]),
        d('优选产品毛利'), d('家用电器毛利（含净水）'), d('宜居产品毛利'), d('宣传推广毛利'),
        d('维修改造业务毛利'), d('新产品及其它毛利'),
      ]),
      c('安检业务毛利'),
      c('直饮水业务毛利', [d('直饮水安装毛利'), d('直饮水售水毛利')]),
      d('其他业务毛利'),
    ]),
  ]),
  c('费用', [
    c('壹品慧费用', [
      c('运营费用', [
        c('付现运营费用', [
          d('人力成本'), d('生产运营费'), d('行政办公费'), d('市场费用'), d('差旅费'), d('招待费'),
          d('会议费'), d('增值业务客服费用'), d('增值业务车辆费用'), d('增值业务地方税费'),
          d('增值业务劳动保护'), d('增值业务信息服务类费用'), d('增值业务中介服务费'),
          d('增值业务商业保险'), d('增值业务其他费用'), d('增值业务技术服务费'), d('增值业务安全监察专项费用'),
        ]),
        c('非付现运营费用', [d('折旧摊销')]),
      ]),
      d('财务费用'),
    ]),
  ]),
  p('经营指标', [d('壹品慧税前利润'), d('所得税费用'), d('壹品慧净利润'), d('直饮水接驳户数（户）')]),
  p('财务指标', [
    c('壹品慧毛利率', [
      c('增值业务毛利率', [
        c('厨房产品销售毛利率（不含净水及服务）', [
          c('燃气具-灶具毛利率'), c('燃气具-热水器毛利率'), c('燃气具-烟机毛利率'), c('燃气具-消毒柜毛利率'),
          c('燃气具-壁挂炉毛利率'), c('燃气具-其他厨房用品毛利率'), c('燃气具售后/安装/维保服务毛利率'),
        ]),
        c('安防产品销售与服务毛利率', [c('波纹管毛利率'), c('报警器毛利率'), c('安防产品服务毛利率')]),
        c('优选产品毛利率'), c('家用电器毛利率（含净水）'), c('宜居产品毛利率'), c('宣传推广毛利率'),
        c('维修改造业务毛利率'), c('新产品及其它毛利率'),
      ]),
      c('安检业务毛利率'),
      c('直饮水业务毛利率', [c('直饮水安装毛利率'), c('直饮水售水毛利率')]),
      c('其他业务毛利率'),
    ]),
    c('劳效比'), c('费效比'), c('壹品慧费用率'), c('壹品慧净利润率'),
  ]),
  p('现金流指标', [
    c('自由现金流'),
    c('经营活动产生的现金流量净额', [d('经营活动产生的现金流入'), d('经营活动产生的现金流出')]),
    c('投资活动产生的现金流量净额', [d('投资活动产生的现金流入'), d('投资活动产生的现金流出')]),
    c('筹资活动产生的现金流量净额', [d('筹资活动产生的现金流入'), d('筹资活动产生的现金流出')]),
  ]),
]

export const rawStaticAnalysis: RawSubjectNode[] = [
  d('总资产'),
  d('银行存款'),
  c('应收账款', [d('集团内客户（含城燃体系）'), d('集团外客户'), d('已收燃易信')]),
  c('存货', [
    d('壁挂炉'), d('燃气灶'), d('热水器'), d('消毒柜'), d('烟机'), d('波纹管'), d('报警器'),
    d('净水器'), d('充值宝'), d('高频产品'), d('橱柜'), d('发出商品'), d('其他'),
  ]),
  d('固定资产净值'), d('在建工程'), d('总负债'), d('预收账款'), d('应付账款'), d('内部往来'),
  d('应付股利'), d('权益净资产'), d('累计未分配利润(万元)'),
  c('总资产报酬率（ROA,%）'), c('资产负债率(%)'), c('净资产回报率（ROE,%）'),
  c('存货周转天数'), c('应收账款周转天数'),
]

// 借贷方向推断：成本/费用 为借方，其余经营科目为贷方
const OP_DEBIT_CATEGORIES = new Set(['成本', '费用'])
// 静态科目：负债/权益类为贷方，资产类为借方
const STATIC_CREDIT_NAMES = new Set(['总负债', '预收账款', '应付账款', '内部往来', '应付股利', '权益净资产', '累计未分配利润(万元)'])

// 值类型显式覆盖：名称规则无法准确判定的科目（劳效比为倍数，按纯数字展示）
const VALUE_TYPE_OVERRIDES = new Map<string, 'amount' | 'quantity' | 'ratio'>([
  ['劳效比', 'quantity'],
  ['费效比', 'ratio'],
])

/** 按科目名称推断值类型：含“率/占比”为比率；含“户数/天数/（户）”为数量；其余为金额 */
export function inferValueType(name: string): 'amount' | 'quantity' | 'ratio' {
  const override = VALUE_TYPE_OVERRIDES.get(name)
  if (override) return override
  if (/率|占比/.test(name)) return 'ratio'
  if (/户数|天数|（户）|\(户\)|人数/.test(name)) return 'quantity'
  return 'amount'
}

/** 前序遍历装饰：赋 code/level/category/parentCode/isLeaf/direction/orderNo。
 * 编码规则：level0 用 SUBJECT_SEGMENT_MAP 段位（如 OP_02），子级 = 父码 + 2 位序号（如 OP_0201）。 */
export function decorateTree(raw: RawSubjectNode[], prefix: 'OP' | 'ST'): DecoratedSubject[] {
  const subjectType = prefix === 'OP' ? 'operating' : 'static'
  const out: DecoratedSubject[] = []
  let order = 0

  const walk = (nodes: RawSubjectNode[], level: number, parentCode: string | null, category: string): void => {
    // 本级序号：同一父节点下从 1 递增（level0 用段位表，不使用序号）
    let seq = 0
    for (const n of nodes) {
      const code = level === 0 ? rootSubjectCodeOf(prefix, n.name) : childSubjectCodeOf(parentCode as string, ++seq)
      const rootCategory = level === 0 ? n.name : category
      const isLeaf = !n.children || n.children.length === 0
      let direction: 'debit' | 'credit'
      if (subjectType === 'operating') {
        direction = OP_DEBIT_CATEGORIES.has(rootCategory) ? 'debit' : 'credit'
      } else {
        direction = STATIC_CREDIT_NAMES.has(rootCategory) ? 'credit' : 'debit'
      }
      out.push({
        code,
        name: n.name,
        subjectType,
        level,
        parentCode,
        category: rootCategory,
        direction,
        valueType: inferValueType(n.name),
        isLeaf,
        dataType: n.dataType,
        orderNo: ++order,
      })
      if (n.children && n.children.length > 0) {
        walk(n.children, level + 1, code, rootCategory)
      }
    }
  }

  walk(raw, 0, null, '')
  return out
}
