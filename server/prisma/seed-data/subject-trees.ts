/**
 * 科目层级种子数据（转录自前端 mock，保证编码/层级/类别与前端 decorateTree 一致）。
 * 前序遍历赋码：OP_001.. / ST_001..；level=深度；category=level0 根名。
 */

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

/** 前序遍历装饰：赋 code/level/category/parentCode/isLeaf/direction/orderNo */
export function decorateTree(raw: RawSubjectNode[], prefix: 'OP' | 'ST'): DecoratedSubject[] {
  const subjectType = prefix === 'OP' ? 'operating' : 'static'
  const out: DecoratedSubject[] = []
  let seq = 0
  let order = 0
  const nextCode = () => `${prefix}_${String(++seq).padStart(3, '0')}`

  const walk = (nodes: RawSubjectNode[], level: number, parentCode: string | null, category: string): void => {
    for (const n of nodes) {
      const code = nextCode()
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
