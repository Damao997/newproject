import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseTransactionWorkbook, matchSummarySheet, extractSummarySheetsXml, type TransactionResolvers } from './transaction-import'

/**
 * 六大往来账龄汇总表解析器单测。
 * 用 aoa 构造与真实 ERP 报表同构的工作簿（Sheet 名前缀识别、双行表头、小计/页脚行）。
 */

function makeWorkbook(sheets: Array<{ name: string; aoa: unknown[][] }>): Buffer {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.aoa), s.name)
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

function resolvers(): TransactionResolvers {
  return {
    companyCodes: new Set(['EN330058', 'EN330059']),
    companyNameByCode: new Map([['EN330058', '测试公司'], ['EN330059', '内部公司甲']]),
    internalByName: new Map([['内部公司甲', 'EN330059'], ['测试公司', 'EN330058']]),
  }
}

// AR 类表头（含客户性质，账龄锚点列 16）
const AR_HEADER = ['序号', '公司编码', '公司名称', '客户编码', '客户名称', '客户性质', '会计科目编码', '会计科目说明', '子目编码', '子目说明', '自然年年初余额', '变化率', '财年年初余额', '变化率', '期末余额', '本月收款额', '期末余额账龄分析']
const AR_SUB = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '1个月', '2个月', '3个月', '4个月', '5个月', '6个月', '半年到1年', '1年到2年', '2年到3年', '3年以上', '合计']

/** AR 数据行：期末余额=closing，账龄 10 段 + 合计 */
function arRow(companyCode: string, cpCode: string, cpName: string, account: string, opening: number, closing: number, aging: number[], total?: number): unknown[] {
  return ['1', companyCode, '测试公司', cpCode, cpName, '个体', account, `${account}(应收账款-测试)`, '0', '', 0, '', opening, '0%', closing, 0, ...aging, total ?? aging.reduce((s, v) => s + v, 0)]
}

const AR_TITLE_ROWS: unknown[][] = [
  ['应收款账龄分析明细表'],
  ['公司:测试公司', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '截止日期:2026-04-30'],
]

// AP 类表头（供应商列名、无客户性质、自然年初余额、本月收付额，账龄锚点列 15）
const AP_HEADER = ['序号', '公司编码', '公司名称', '供应商', '供应商名称', '会计科目编码', '会计科目说明', '子目编码', '子目说明', '自然年初余额', '变化率', '财年年初余额', '变化率', '期末余额', '本月收付额', '期末余额账龄分析']
const AP_SUB = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '1个月', '2个月', '3个月', '4个月', '5个月', '6个月', '半年到1年', '1年到2年', '2年到3年', '3年以上', '合计']

describe('matchSummarySheet', () => {
  it('六大前缀映射正确', () => {
    expect(matchSummarySheet('AR-账龄汇总表')).toEqual({ transactionType: '应收账款', direction: 'AR' })
    expect(matchSummarySheet('AROT-账龄汇总表')).toEqual({ transactionType: '其他应收款', direction: 'AR' })
    expect(matchSummarySheet('PER_AR-账龄汇总表')).toEqual({ transactionType: '预收账款', direction: 'AR' })
    expect(matchSummarySheet('AP-账龄汇总表')).toEqual({ transactionType: '应付账款', direction: 'AP' })
    expect(matchSummarySheet('APOT-账龄汇总表')).toEqual({ transactionType: '其他应付款', direction: 'AP' })
    expect(matchSummarySheet('PER_AP-账龄汇总表')).toEqual({ transactionType: '预付账款', direction: 'AP' })
  })

  it('明细表与无关 Sheet 不匹配', () => {
    expect(matchSummarySheet('AR-账龄明细表')).toBeNull()
    expect(matchSummarySheet('报表参数')).toBeNull()
    expect(matchSummarySheet('XX-账龄汇总表')).toBeNull()
  })
})

describe('parseTransactionWorkbook', () => {
  it('AR 汇总表：字段映射、期间、账龄 10 段', () => {
    const buf = makeWorkbook([{
      name: 'AR-账龄汇总表',
      aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', 'C001', '客户甲', '112201', 80, 100, [60, 40, 0, 0, 0, 0, 0, 0, 0, 0])],
    }])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    expect(r.errors).toHaveLength(0)
    expect(r.records).toHaveLength(1)
    const rec = r.records[0]
    expect(rec.companyCode).toBe('EN330058')
    expect(rec.companyName).toBe('测试公司')
    expect(rec.transactionType).toBe('应收账款')
    expect(rec.direction).toBe('AR')
    expect(rec.cutoffDate).toBe('2026-04-30')
    expect(rec.period).toBe('2026-04')
    expect(rec.counterpartyCode).toBe('C001')
    expect(rec.accountCode).toBe('112201')
    expect(rec.openingBalance).toBe(80)
    expect(rec.closingBalance).toBe(100)
    expect(rec.aging1m).toBe(60)
    expect(rec.aging2m).toBe(40)
    expect(rec.agingTotal).toBe(100)
    expect(rec.debitAmount).toBe(0)
    expect(rec.isInternal).toBe(false)
    expect(rec.internalType).toBe('外部')
    expect(rec.sourceFile).toBe('test.xls')
    expect(r.summary.typeCounts['应收账款']).toBe(1)
  })

  it('AP 变体表头（供应商/本月收付额）与 APOT 类型识别，贷方性质符号归一', () => {
    const buf = makeWorkbook([{
      name: 'APOT-账龄汇总表',
      aoa: [
        [''],
        ['公司:测试公司', null, null, null, null, null, null, null, null, null, null, null, null, null, '截止日期:2026-05-31'],
        AP_HEADER,
        AP_SUB,
        ['1', '330058', '测试公司', 'S001', '供应商乙', '2241', '2241(其他应付款-测试)', '', '', -1.1, '0%', -1.1, '0%', -1.1, 0, 0, 0, 0, 0, 0, 0, 0, -1.1, 0, 0, -1.1],
      ],
    }])
    const r = parseTransactionWorkbook(buf, 'ap.xls', resolvers())
    expect(r.errors).toHaveLength(0)
    expect(r.records).toHaveLength(1)
    const rec = r.records[0]
    expect(rec.transactionType).toBe('其他应付款')
    expect(rec.direction).toBe('AP')
    expect(rec.counterpartyCode).toBe('S001')
    expect(rec.counterpartyName).toBe('供应商乙')
    expect(rec.period).toBe('2026-05')
    // 其他应付款为贷方性质：原始 -1.1 入库翻转为 +1.1
    expect(rec.closingBalance).toBe(1.1)
    expect(rec.aging1yTo2y).toBe(1.1)
    expect(rec.agingTotal).toBe(1.1)
    expect(rec.rawJson.rawClosingBalance).toBe(-1.1)
  })

  it('借方性质类型（应收/预付）不翻转符号；贷方性质反方向余额翻转后为负', () => {
    const buf = makeWorkbook([{
      name: 'PER_AR-账龄汇总表',
      aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB,
        // 预收账款（贷方性质）：原始 -200 → +200；原始 +30（反方向余额）→ -30
        arRow('330058', 'C001', '客户甲', '2203', -100, -200, [-200, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        arRow('330058', 'C002', '客户乙', '2203', 0, 30, [30, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ],
    }])
    const r = parseTransactionWorkbook(buf, 'per.xls', resolvers())
    expect(r.errors).toHaveLength(0)
    const [a, b] = r.records
    expect(a.transactionType).toBe('预收账款')
    expect(a.openingBalance).toBe(100)
    expect(a.closingBalance).toBe(200)
    expect(a.aging1m).toBe(200)
    expect(b.closingBalance).toBe(-30)
  })

  it('小计行与页脚行静默过滤，不计错误', () => {
    const buf = makeWorkbook([{
      name: 'AR-账龄汇总表',
      aoa: [
        ...AR_TITLE_ROWS, AR_HEADER, AR_SUB,
        arRow('330058', 'C001', '客户甲', '112201', 0, 50, [50, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        ['', '', '测试公司', '', '明细科目小计', '', '112201', '112201(应收账款-测试)', '', '', 0, '', 0, '', 50, 0, 50, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50],
        ['制单人:JINLJC', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '打印时间:2026-06-15'],
      ],
    }])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    expect(r.errors).toHaveLength(0)
    expect(r.records).toHaveLength(1)
    expect(r.dataRowCount).toBe(1)
  })

  it('公司编码未匹配记入错误并跳行', () => {
    const buf = makeWorkbook([{
      name: 'AR-账龄汇总表',
      aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('999999', 'C001', '客户甲', '112201', 0, 10, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
    }])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    expect(r.records).toHaveLength(0)
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toContain('公司编码未匹配')
  })

  it('账龄之和与期末余额不一致产生警告但仍入库', () => {
    const buf = makeWorkbook([{
      name: 'AR-账龄汇总表',
      aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', 'C001', '客户甲', '112201', 0, 100, [60, 0, 0, 0, 0, 0, 0, 0, 0, 0], 60)],
    }])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    expect(r.records).toHaveLength(1)
    expect(r.warnings).toHaveLength(1)
    expect(r.warnings[0].message).toContain('不一致')
  })

  it('文件内重复行按业务键求和合并', () => {
    const buf = makeWorkbook([{
      name: 'AR-账龄汇总表',
      aoa: [
        ...AR_TITLE_ROWS, AR_HEADER, AR_SUB,
        arRow('330058', 'C001', '客户甲', '112201', 10, 100, [100, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
        arRow('330058', 'C001', '客户甲', '112201', 5, 50, [50, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ],
    }])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    expect(r.records).toHaveLength(1)
    expect(r.summary.duplicateCount).toBe(1)
    expect(r.records[0].closingBalance).toBe(150)
    expect(r.records[0].openingBalance).toBe(15)
    expect(r.records[0].aging1m).toBe(150)
  })

  it('客商名称命中公司主数据标记为内部往来', () => {
    const buf = makeWorkbook([{
      name: 'AR-账龄汇总表',
      aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', '100018', '内部公司甲', '112201', 0, 30, [30, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
    }])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    expect(r.records[0].isInternal).toBe(true)
    expect(r.records[0].internalType).toBe('内部关联')
    expect(r.records[0].internalPeerCode).toBe('EN330059')
    expect(r.summary.internalCount).toBe(1)
  })

  it('一个文件多个汇总 Sheet 全部解析', () => {
    const buf = makeWorkbook([
      { name: '报表参数', aoa: [['报表名称：', '应收款账龄分析明细表']] },
      { name: 'AR-账龄汇总表', aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', 'C001', '客户甲', '112201', 0, 10, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0])] },
      { name: 'PER_AR-账龄汇总表', aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', 'C002', '客户乙', '2203', 0, 20, [20, 0, 0, 0, 0, 0, 0, 0, 0, 0])] },
    ])
    const r = parseTransactionWorkbook(buf, 'multi.xls', resolvers())
    expect(r.sheets).toHaveLength(2)
    expect(r.records).toHaveLength(2)
    expect(r.summary.typeCounts).toEqual({ 应收账款: 1, 预收账款: 1 })
  })

  it('无关 Sheet 穿插不影响匹配 Sheet 的解析顺序', () => {
    const buf = makeWorkbook([
      { name: 'PER_AR-账龄汇总表', aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', 'C002', '客户乙', '2203', 0, 20, [20, 0, 0, 0, 0, 0, 0, 0, 0, 0])] },
      { name: '报表参数', aoa: [['报表名称：', '应收款账龄分析明细表']] },
      { name: 'AR-账龄汇总表', aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', 'C001', '客户甲', '112201', 0, 10, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0])] },
    ])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    // 两阶段读取按 Sheet 名筛选：无关 Sheet 不产生记录，匹配 Sheet 保持工作簿原始顺序
    expect(r.sheets.map((s) => s.sheetName)).toEqual(['PER_AR-账龄汇总表', 'AR-账龄汇总表'])
    expect(r.records).toHaveLength(2)
    expect(r.errors).toHaveLength(0)
  })

  it('无汇总表 Sheet 报错', () => {
    const buf = makeWorkbook([{ name: 'Sheet1', aoa: [['a', 'b']] }])
    const r = parseTransactionWorkbook(buf, 'bad.xls', resolvers())
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toContain('未找到账龄汇总表')
  })

  it('缺少截止日期时整 Sheet 跳过并报错', () => {
    const buf = makeWorkbook([{
      name: 'AR-账龄汇总表',
      aoa: [['应收款账龄分析明细表'], AR_HEADER, AR_SUB, arRow('330058', 'C001', '客户甲', '112201', 0, 10, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0])],
    }])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    expect(r.records).toHaveLength(0)
    expect(r.errors.some((e) => e.message.includes('截止日期'))).toBe(true)
  })

  it('空明细 Sheet 仍申报覆盖范围：标题公司 + 截止日期 + recordCount=0', () => {
    const buf = makeWorkbook([{
      name: 'PER_AR-账龄汇总表',
      // 仅标题/表头，无任何数据行（该期确无预收往来款）
      aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB],
    }])
    const r = parseTransactionWorkbook(buf, 'empty.xls', resolvers())
    expect(r.errors).toHaveLength(0)
    expect(r.records).toHaveLength(0)
    expect(r.sheets).toHaveLength(1)
    expect(r.sheets[0].recordCount).toBe(0)
    expect(r.sheets[0].cutoffDate).toBe('2026-04-30')
    expect(r.sheets[0].declaredCompanyCode).toBe('EN330058')
  })

  it('标题公司无法解析时回退首条记录公司', () => {
    const buf = makeWorkbook([{
      name: 'AR-账龄汇总表',
      aoa: [
        ['应收款账龄分析明细表'],
        ['公司:未知公司名', null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, '截止日期:2026-04-30'],
        AR_HEADER, AR_SUB,
        arRow('330058', 'C001', '客户甲', '112201', 0, 10, [10, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
      ],
    }])
    const r = parseTransactionWorkbook(buf, 'test.xls', resolvers())
    expect(r.sheets[0].declaredCompanyCode).toBe('EN330058')
  })
})

// ===== SpreadsheetML XML 单文件（ERP 伪 .xls 实测格式） =====

/** 单元格转 SpreadsheetML XML：空值输出自闭合 Cell，其余按 String 类型 */
function xmlCell(v: unknown): string {
  if (v === null || v === undefined || v === '') return '<Cell/>'
  return `<Cell><Data ss:Type="String">${String(v)}</Data></Cell>`
}

function xmlRow(aoa: unknown[]): string {
  return `<Row>${aoa.map(xmlCell).join('')}</Row>`
}

/** 构造与真实 ERP 导出同构的 SpreadsheetML XML 单文件（共享 Styles 头 + 多 Worksheet 段，含 ss:Protected 属性） */
function makeXmlWorkbook(sheets: Array<{ name: string; aoa: unknown[][] }>): string {
  const body = sheets
    .map((s) => `<Worksheet ss:Name="${s.name}" ss:Protected="0"><Table>${s.aoa.map(xmlRow).join('')}</Table></Worksheet>`)
    .join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<?mso-application progid="Excel.Sheet"?>\n' +
    '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">\n' +
    '<Styles><Style ss:ID="ptime"/></Styles>\n' +
    `${body}\n` +
    '</Workbook>'
  )
}

describe('SpreadsheetML XML 单文件（ERP 伪 .xls）', () => {
  const AR_SHEET = { name: 'AR-账龄汇总表', aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', 'C001', '客户甲', '112201', 0, 100, [60, 40, 0, 0, 0, 0, 0, 0, 0, 0])] }
  const PER_SHEET = { name: 'PER_AR-账龄汇总表', aoa: [...AR_TITLE_ROWS, AR_HEADER, AR_SUB, arRow('330058', 'C002', '客户乙', '2203', 0, 20, [20, 0, 0, 0, 0, 0, 0, 0, 0, 0])] }
  const IRRELEVANT = { name: '报表参数', aoa: [['报表名称：', '应收款账龄分析明细表']] }

  it('extractSummarySheetsXml 仅保留目标段且保留共享头', () => {
    // 非目标段分别位于首个段（隐藏表）与末尾（报表参数），均须被丢弃
    const xml = makeXmlWorkbook([{ name: '隐藏表', aoa: [['x']] }, AR_SHEET, PER_SHEET, IRRELEVANT])
    const slim = extractSummarySheetsXml(xml)
    expect(slim).not.toBeNull()
    expect(slim).toContain('<Styles><Style ss:ID="ptime"/></Styles>')
    expect(slim).toContain('AR-账龄汇总表')
    expect(slim).toContain('PER_AR-账龄汇总表')
    expect(slim).not.toContain('报表参数')
    expect(slim).not.toContain('隐藏表')
  })

  it('无目标 Worksheet 返回 null', () => {
    expect(extractSummarySheetsXml(makeXmlWorkbook([IRRELEVANT, { name: 'Sheet1', aoa: [['a']] }]))).toBeNull()
  })

  it('XML 单文件解析：无关 Sheet 不产生记录，目标 Sheet 顺序保持', () => {
    const xml = makeXmlWorkbook([PER_SHEET, IRRELEVANT, AR_SHEET])
    const r = parseTransactionWorkbook(Buffer.from(xml, 'utf8'), 'CUX_AR_样例.xls', resolvers())
    expect(r.errors).toHaveLength(0)
    expect(r.sheets.map((s) => s.sheetName)).toEqual(['PER_AR-账龄汇总表', 'AR-账龄汇总表'])
    expect(r.records).toHaveLength(2)
    expect(r.summary.typeCounts).toEqual({ 预收账款: 1, 应收账款: 1 })
  })

  it('XML 单文件无匹配 Worksheet 报「未找到账龄汇总表」', () => {
    const xml = makeXmlWorkbook([{ name: 'Sheet1', aoa: [['a', 'b']] }, IRRELEVANT])
    const r = parseTransactionWorkbook(Buffer.from(xml, 'utf8'), 'bad.xls', resolvers())
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0].message).toContain('未找到账龄汇总表')
  })

  it('XML 单文件 Worksheet 段未闭合（损坏文件）报错', () => {
    const broken = '<?xml version="1.0"?><Workbook><Worksheet ss:Name="AR-账龄汇总表"><Table><Row><Cell/></Row>'
    const r = parseTransactionWorkbook(Buffer.from(broken, 'utf8'), 'broken.xls', resolvers())
    expect(r.errors.length).toBeGreaterThan(0)
  })
})
