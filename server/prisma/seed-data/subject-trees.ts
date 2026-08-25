/**
 * 科目层级种子数据（依据《科目表重构.xlsx》三张 Sheet：经营指标表 / 资产负债表 / 现金流量表）。
 * 级联赋码：PL01 / PL0101 / PL010101...（每级 2 位，子码=父码+序号）；level=深度；category=level0 根名。
 * 三套体系：PL_（经营 operating）/ BS_（静态 static）/ CF_（现金流 cashflow）。
 */

/**
 * level0 科目段位表（名称 → 2 位段位）。
 * 经营科目 01-08；静态科目 01-04（总资产/总负债/权益净资产/静态指标）；现金流 01-04（经营/投资/筹资活动/自由现金流）。
 * 新增 level0 大类必须在此登记段位，decorateTree 对未登记名称抛错。
 */
export const SUBJECT_SEGMENT_MAP: Record<string, string> = {
  // 经营科目（PL_）
  '壹品慧回款': '01',
  '壹品慧收入': '02',
  '壹品慧成本': '03',
  '壹品慧毛利': '04',
  '壹品慧费用': '05',
  '经营成果': '06',
  '壹品慧毛利率': '07',
  '经营指标': '08',
  // 静态科目（BS_）
  '总资产': '01',
  '总负债': '02',
  '权益净资产': '03',
  '静态指标': '04',
  // 现金流科目（CF_）
  '经营活动产生的现金流量': '01',
  '投资活动产生的现金流量': '02',
  '筹资活动产生的现金流量': '03',
  '自由现金流': '04',
}

/** level0 编码：前缀 + 段位表登记段位（未登记抛错，强制维护）；无下划线（PL01/BS01/CF01 风格） */
export function rootSubjectCodeOf(prefix: string, name: string): string {
  const segment = SUBJECT_SEGMENT_MAP[name]
  if (!segment) throw new Error(`科目未登记 level0 段位：${name}（请向 SUBJECT_SEGMENT_MAP 补充）`)
  return `${prefix}${segment}`
}

/** 段位表名称 → 所属前缀（三套体系段位独立编号，需据此校验段位归属） */
export const SUBJECT_PREFIX_MAP: Record<string, 'PL' | 'BS' | 'CF'> = {
  // 经营（PL_）
  '壹品慧回款': 'PL', '壹品慧收入': 'PL', '壹品慧成本': 'PL', '壹品慧毛利': 'PL',
  '壹品慧费用': 'PL', '经营成果': 'PL', '壹品慧毛利率': 'PL', '经营指标': 'PL',
  // 静态（BS_）
  '总资产': 'BS', '总负债': 'BS', '权益净资产': 'BS', '静态指标': 'BS',
  // 现金流（CF_）
  '经营活动产生的现金流量': 'CF', '投资活动产生的现金流量': 'CF', '筹资活动产生的现金流量': 'CF',
  '自由现金流': 'CF',
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
  subjectType: 'operating' | 'static' | 'cashflow'
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

/** 经营指标表（PL01~PL08）：回款/收入/成本/毛利/费用（含 PL0502 财务费用）/经营成果/毛利率/经营指标 */
export const rawOperatingAnalysis: RawSubjectNode[] = [
  c('壹品慧回款', [d('增值业务回款'), d('直饮水业务回款')]),
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
  // 毛利叶子统一为计算类：同名收入 - 同名成本 镜像配对（seedCalcMetricFormulas 自动写公式），不直接导入
  c('壹品慧毛利', [
    c('增值业务毛利', [
      c('厨房产品销售毛利（不含净水及服务）', [
        c('燃气具-灶具毛利'), c('燃气具-热水器毛利'), c('燃气具-烟机毛利'), c('燃气具-消毒柜毛利'),
        c('燃气具-壁挂炉毛利'), c('燃气具-其他厨房用品毛利'), c('燃气具售后/安装/维保服务毛利'),
      ]),
      c('安防产品销售与服务毛利', [c('波纹管毛利'), c('报警器毛利'), c('安防产品服务毛利')]),
      c('优选产品毛利'), c('家用电器毛利（含净水）'), c('宜居产品毛利'), c('宣传推广毛利'),
      c('维修改造业务毛利'), c('新产品及其它毛利'),
    ]),
    c('安检业务毛利'),
    c('直饮水业务毛利', [c('直饮水安装毛利'), c('直饮水售水毛利')]),
    c('其他业务毛利'),
  ]),
  c('壹品慧费用', [
    c('运营费用', [
      c('付现运营费用', [
        d('人力成本'), d('生产运营类费用'), d('行政办公类费用'), d('差旅费'), d('招待费'),
        d('会议费'), d('市场费用'), d('客服费用'), d('地方税费'), d('劳动保护'),
        d('商业保险'), d('信息服务费'), d('中介服务费'), d('技术服务费'), d('安全监察专项费用'),
        d('核算共享中心服务费'), d('仓储及配送费用'), d('其他费用'), d('研发费用'),
      ]),
      c('非付现运营费用', [d('折旧摊销')]),
    ]),
    d('财务费用'),
  ]),
  p('经营成果', [d('壹品慧税前利润'), d('所得税费用'), d('壹品慧净利润')]),
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
  p('经营指标', [c('劳效比'), c('费效比'), c('壹品慧费用率'), c('壹品慧净利润率'), d('直饮水接驳户数（户）')]),
]

/** 资产负债表（BS01~BS04）：总资产/总负债/权益净资产/静态指标（比率类保留） */
export const rawStaticAnalysis: RawSubjectNode[] = [
  c('总资产', [
    d('银行存款'),
    d('应收账款'),
    c('存货', [
      d('壁挂炉'), d('燃气灶'), d('热水器'), d('消毒柜'), d('烟机'), d('波纹管'), d('报警器'),
      d('净水器'), d('充值宝'), d('高频产品'), d('橱柜'), d('发出商品'), d('其他'),
    ]),
    d('固定资产净值'),
    d('在建工程'),
  ]),
  c('总负债', [d('预收账款'), d('应付账款'), d('应付股利')]),
  c('权益净资产', [d('未分配利润'), d('内部往来')]),
  p('静态指标', [
    c('总资产报酬率（ROA,%）'), c('资产负债率(%)'), c('净资产回报率（ROE,%）'),
    c('存货周转天数'), c('应收账款周转天数'),
  ]),
]

/** 现金流量表（CF01~CF03）：经营/投资/筹资活动（流入/流出明细；净额=流入-流出由公式计算） */
export const rawCashflowAnalysis: RawSubjectNode[] = [
  c('经营活动产生的现金流量', [
    c('经营活动产生的现金流入', [
      d('销售商品、提供劳务收到的现金'), d('收到的税费返还'), d('收到的其它与经营活动有关的现金'),
    ]),
    c('经营活动产生的现金流出', [
      d('购买商品、接受劳务支付的现金'), d('支付给职工以及为职工支付的现金'),
      d('支付的各项税费'), d('支付的其它与经营活动有关的现金'),
    ]),
  ]),
  c('投资活动产生的现金流量', [
    c('投资活动产生的现金流入', [
      d('收回投资所收到的现金'), d('取得投资收益所收到的现金'),
      d('处置固定资产、无形资产和其它长期资产所收回的现金净额'),
      d('处置子公司及其它营业单位收到的现金净额'), d('收到的其它与投资活动有关的现金'),
    ]),
    c('投资活动产生的现金流出', [
      d('购建固定资产、无形资产和其它长期资产所支付的现金'), d('投资支付的现金'),
      d('取得子公司及其它营业单位支付的现金净额'), d('支付其它与投资活动有关的现金'),
    ]),
  ]),
  c('筹资活动产生的现金流量', [
    c('筹资活动产生的现金流入', [
      d('吸收投资收到的现金'), d('取得借款收到的现金'), d('收到的其它与筹资活动有关的现金'),
    ]),
    c('筹资活动产生的现金流出', [
      d('偿还债务支付的现金'), d('分配股利、利润或偿付利息支付的现金'), d('支付的其它与筹资活动有关的现金'),
    ]),
  ]),
  // 自由现金流 = 经营活动产生的现金流量 - 投资活动产生的现金流出（公式由 seedCalcMetricFormulas 写入）
  c('自由现金流'),
]

// 借贷方向推断（按 level0 根名即 category）：成本/费用为借方，其余经营科目为贷方
const OP_DEBIT_CATEGORIES = new Set(['壹品慧成本', '壹品慧费用'])
// 静态科目：负债/权益类为贷方，资产类为借方
const STATIC_CREDIT_CATEGORIES = new Set(['总负债', '权益净资产'])

// 值类型显式覆盖：名称规则无法准确判定的科目（劳效比/费效比为效率比率，按比率展示）
const VALUE_TYPE_OVERRIDES = new Map<string, 'amount' | 'quantity' | 'ratio'>([
  ['劳效比', 'ratio'],
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
 * 编码规则：level0 用 SUBJECT_SEGMENT_MAP 段位（如 PL02 / BS01 / CF01），子级 = 父码 + 2 位序号（如 PL0201）。 */
export function decorateTree(raw: RawSubjectNode[], prefix: 'PL' | 'BS' | 'CF'): DecoratedSubject[] {
  const subjectType = prefix === 'PL' ? 'operating' : prefix === 'BS' ? 'static' : 'cashflow'
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
      } else if (subjectType === 'static') {
        direction = STATIC_CREDIT_CATEGORIES.has(rootCategory) ? 'credit' : 'debit'
      } else {
        // 现金流：流入贷方、流出借方，按名称段（流入/流出）细分由导入方向控制，此处默认贷方
        direction = 'credit'
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
