/**
 * 生产手动数据变更核对脚本（只读，绝不写库）。
 *
 * 用途：发版后核对手动修改的科目/公司/汇总映射是否保持原样
 * （见 docs/plans/部署运维规范.md 附录 H「发版前检查清单」）。
 *
 * 用法：
 *   npx tsx scripts/verify-prod-manual-data.ts --ledger <台账JSON路径> [--db <DATABASE_URL>]
 * 默认连接串取环境变量 DATABASE_URL；--db 可显式指定（如 MIGRATE_DATABASE_URL 同款只读连接）。
 *
 * 台账格式（JSON）：
 *   {
 *     "subjects": [
 *       { "code": "OP0201", "name": "主营业务收入", "subjectType": "operating" }
 *     ],
 *     "companies": [
 *       { "code": "EN330059", "name": "浙江壹品慧杭州分公司", "entityType": "single" }
 *     ],
 *     "aggregationMaps": [
 *       { "singleCompanyCode": "EN330059", "summaryCompanyCode": "ET0001" }
 *     ]
 *   }
 * 比对规则：code 为唯一键必填；name / subjectType / entityType 仅当台账中给出时才比对。
 * 退出码：0 = 全部一致；1 = 存在差异或参数/台账非法。
 */
import { PrismaClient } from '@prisma/client'
import fs from 'node:fs'

interface SubjectExpectation { code: string; name?: string; subjectType?: string }
interface CompanyExpectation { code: string; name?: string; entityType?: string }
interface AggregationExpectation { singleCompanyCode: string; summaryCompanyCode: string }
interface LedgerFile {
  subjects?: SubjectExpectation[]
  companies?: CompanyExpectation[]
  aggregationMaps?: AggregationExpectation[]
}

interface Diff { kind: string; key: string; field: string; expected: unknown; actual: unknown }

const prisma = new PrismaClient()

function parseArgs(argv: string[]): { ledgerPath: string; dbUrl?: string } {
  let ledgerPath = ''
  let dbUrl: string | undefined
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--ledger') { ledgerPath = argv[i + 1] ?? ''; i++ }
    else if (argv[i] === '--db') { dbUrl = argv[i + 1]; i++ }
    else throw new Error(`未知参数：${argv[i]}（支持 --ledger <路径> [--db <连接串>]）`)
  }
  if (!ledgerPath) throw new Error('缺少 --ledger <台账JSON路径> 参数')
  return { ledgerPath, dbUrl }
}

async function main(): Promise<void> {
  const { ledgerPath, dbUrl } = parseArgs(process.argv.slice(2))
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf-8')) as LedgerFile
  if (!ledger.subjects?.length && !ledger.companies?.length && !ledger.aggregationMaps?.length) {
    throw new Error('台账为空：subjects / companies / aggregationMaps 至少一项非空')
  }
  if (dbUrl) process.env.DATABASE_URL = dbUrl

  const diffs: Diff[] = []
  let checked = 0

  // 1) 科目：code 存在性 + 台账中给出的 name/subjectType
  if (ledger.subjects?.length) {
    const rows = await prisma.accountSubject.findMany({
      where: { code: { in: ledger.subjects.map((s) => s.code) } },
      select: { code: true, name: true, subjectType: true },
    })
    const byCode = new Map(rows.map((r) => [r.code, r]))
    for (const s of ledger.subjects) {
      checked++
      const row = byCode.get(s.code)
      if (!row) { diffs.push({ kind: '科目', key: s.code, field: '(整行)', expected: '存在', actual: '不存在' }); continue }
      if (s.name !== undefined && row.name !== s.name) diffs.push({ kind: '科目', key: s.code, field: 'name', expected: s.name, actual: row.name })
      if (s.subjectType !== undefined && row.subjectType !== s.subjectType) diffs.push({ kind: '科目', key: s.code, field: 'subjectType', expected: s.subjectType, actual: row.subjectType })
    }
  }

  // 2) 公司：code 存在性 + 台账中给出的 name/entityType
  if (ledger.companies?.length) {
    const rows = await prisma.company.findMany({
      where: { code: { in: ledger.companies.map((c) => c.code) } },
      select: { code: true, name: true, entityType: true },
    })
    const byCode = new Map(rows.map((r) => [r.code, r]))
    for (const c of ledger.companies) {
      checked++
      const row = byCode.get(c.code)
      if (!row) { diffs.push({ kind: '公司', key: c.code, field: '(整行)', expected: '存在', actual: '不存在' }); continue }
      if (c.name !== undefined && row.name !== c.name) diffs.push({ kind: '公司', key: c.code, field: 'name', expected: c.name, actual: row.name })
      if (c.entityType !== undefined && row.entityType !== c.entityType) diffs.push({ kind: '公司', key: c.code, field: 'entityType', expected: c.entityType, actual: row.entityType })
    }
  }

  // 3) 汇总映射：单对关系存在性
  if (ledger.aggregationMaps?.length) {
    const rows = await prisma.companyAggregationMap.findMany({
      select: { singleCompanyCode: true, summaryCompanyCode: true },
    })
    const existing = new Set(rows.map((r) => `${r.singleCompanyCode}|${r.summaryCompanyCode}`))
    for (const m of ledger.aggregationMaps) {
      checked++
      const key = `${m.singleCompanyCode}|${m.summaryCompanyCode}`
      if (!existing.has(key)) diffs.push({ kind: '汇总映射', key, field: '(整行)', expected: '存在', actual: '不存在' })
    }
  }

  // 输出：逐项差异 + 汇总；只读，不写入任何数据
  console.log(`==> 生产手动数据核对（台账：${ledgerPath}，共 ${checked} 项）`)
  for (const d of diffs) {
    console.log(`  [DIFF] ${d.kind} ${d.key}：${d.field} 期望=${JSON.stringify(d.expected)} 实际=${JSON.stringify(d.actual)}`)
  }
  if (diffs.length === 0) {
    console.log(`核对通过：全部 ${checked} 项与生产库一致`)
  } else {
    console.log(`核对未通过：${diffs.length} 项差异（脚本为只读，未写入任何数据）`)
    process.exitCode = 1
  }
}

main()
  .catch((e) => {
    console.error('核对失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
