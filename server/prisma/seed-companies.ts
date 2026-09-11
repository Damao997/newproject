import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import path from 'node:path'

/**
 * 公司主数据 + 汇总映射种子。
 * 数据源：docs/data-templates/samples/分析主体及汇总映射.xlsx
 * 编码约定（CLAUDE.md）：单体 EN+6位、汇总 ET+4位。
 * - Sheet「单体主体」→ 10 单体（EN+公司编码，全称）
 * - Sheet「汇总主体」→ 9 汇总（ET+4位顺序码）
 * - Sheet「分析主体及汇总映射」→ company_aggregation_map（单体→汇总多对多，逗号分隔）
 * 幂等：按 code upsert；映射全量同步（清理旧映射后重建）。
 */

const MAPPING_FILE = path.resolve(__dirname, '../../docs/data-templates/samples/分析主体及汇总映射.xlsx')

function readSheet(file: string, index: number): unknown[][] {
  const wb = XLSX.readFile(file)
  const name = wb.SheetNames[index]
  if (!name) return []
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' }) as unknown[][]
}

const cell = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim())

export async function seedCompaniesAndMapping(prisma: PrismaClient): Promise<void> {
  // ---- 单体主体（Sheet 索引 0）----
  const singleRows = readSheet(MAPPING_FILE, 0).slice(1) // 去表头
  const singleNameToCode = new Map<string, string>()
  const validCodes = new Set<string>()
  let singleCount = 0
  let orderNo = 1
  for (const row of singleRows) {
    const rawCode = cell(row[0])
    const name = cell(row[1])
    if (!rawCode || !name) continue
    // 兼容两种源格式：已带 EN 前缀则原样使用，否则数字码补 EN+6 位（避免 ENEN 双前缀）
    const code = /^EN/i.test(rawCode) ? rawCode.toUpperCase() : 'EN' + rawCode.padStart(6, '0')
    singleNameToCode.set(name, code)
    validCodes.add(code)
    await prisma.company.upsert({
      where: { code },
      update: { name, entityType: 'single', orderNo },
      create: { code, name, entityType: 'single', orderNo },
    })
    singleCount++
    orderNo++
  }
  console.log(`[seed] 单体公司 ${singleCount} 条 完成`)

  // ---- 汇总主体（Sheet 索引 1）----
  const summaryRows = readSheet(MAPPING_FILE, 1).slice(1)
  const summaryNameToCode = new Map<string, string>()
  let summaryCount = 0
  let seq = 0
  let sumOrder = 101
  for (const row of summaryRows) {
    const name = cell(row[1])
    if (!name) continue
    seq++
    const code = 'ET' + String(seq).padStart(4, '0')
    summaryNameToCode.set(name, code)
    validCodes.add(code)
    await prisma.company.upsert({
      where: { code },
      update: { name, entityType: 'summary', orderNo: sumOrder },
      create: { code, name, entityType: 'summary', orderNo: sumOrder },
    })
    summaryCount++
    sumOrder++
  }
  console.log(`[seed] 汇总主体 ${summaryCount} 条 完成`)

  // ---- 清理旧占位/无效编码公司（CO/SUM 旧前缀、ENEN 双前缀等，非本次有效编码）----
  const oldCompanies = await prisma.company.findMany({ select: { code: true } })
  const obsolete = oldCompanies
    .map((c) => c.code)
    .filter((code) => (code.startsWith('CO') || code.startsWith('SUM') || code.startsWith('ENEN')) && !validCodes.has(code))
  if (obsolete.length > 0) {
    await prisma.company.deleteMany({ where: { code: { in: obsolete } } })
    console.log(`[seed] 清理旧占位公司 ${obsolete.length} 条`)
  }

  // ---- 分析主体及汇总映射（Sheet 索引 3）→ company_aggregation_map ----
  const mapRows = readSheet(MAPPING_FILE, 3).slice(1)
  // 全量同步：先清空再重建
  await prisma.companyAggregationMap.deleteMany({})
  let mapCount = 0
  for (const row of mapRows) {
    const singleName = cell(row[0])
    const summaryField = cell(row[1])
    const singleCode = singleNameToCode.get(singleName)
    if (!singleCode) continue
    if (!summaryField || summaryField.includes('不进行汇总')) continue
    const summaryNames = summaryField.split(/[,，]/).map((s) => s.trim()).filter(Boolean)
    for (const sn of summaryNames) {
      const summaryCode = summaryNameToCode.get(sn)
      if (!summaryCode) continue
      await prisma.companyAggregationMap.create({
        data: { summaryCompanyCode: summaryCode, singleCompanyCode: singleCode, isInternalElimination: false },
      })
      mapCount++
    }
  }
  console.log(`[seed] 汇总映射 ${mapCount} 条 完成`)
}
