/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client'
import { decorateTree, rawOperatingAnalysis, rawStaticAnalysis, rawCashflowAnalysis } from '../prisma/seed-data/subject-trees'

/**
 * 科目体系全面替代迁移脚本（2026-08 科目表重构）：
 * 旧体系 OP_/ST_（经营 5 层 / 静态 level0 平铺）→ 新体系 PL_/BS_/CF_（经营 4 层 + 静态 2 层 + 现金流独立类型）。
 *
 * 策略（与旧 migrate-subject-codes.ts 的"重命名"不同，本次为"整树替换"）：
 *  1. 旧科目整树停用（status=inactive，保留追溯）；新科目/指标/公式由 seed 幂等重建
 *  2. 旧 metric 停用（新 metric 由 seed 按新树定义创建）
 *  3. 历史事实数据按"名称路径"映射到新编码（含改名映射与多对一合并，聚合后再写回）
 *  4. 引用字段逐码替换：reclassification_log / subject_analysis / consolidation_adjustment / mapping_scheme
 *  5. 无法映射/语义变化的旧科目（总资产/总负债/权益净资产/自由现金流/旧现金流段）数据保留旧码（孤儿行，可追溯）
 *
 * 幂等：映射按名称确定性生成；已迁移科目 old==new（更新无害），可中断后续跑。
 * 迁移前建议 pg_dump 备份。用法：npx tsx scripts/migrate-subject-tree-2026-08.ts
 */

const prisma = new PrismaClient()

/** 名称变换映射：旧名 → 新名（费用段去「增值业务」前缀/改名、旧根段名称、静态/现金流改名） */
const NAME_REMAP: Record<string, string> = {
  // 旧根段 → 新根段（旧树比新树多一层）
  '回款': '壹品慧回款',
  '收入': '壹品慧收入',
  '成本': '壹品慧成本',
  '毛利': '壹品慧毛利',
  '费用': '壹品慧费用',
  // 费用叶子（去前缀/改名；车辆费用并入其他费用）
  '生产运营费': '生产运营类费用',
  '行政办公费': '行政办公类费用',
  '增值业务客服费用': '客服费用',
  '增值业务车辆费用': '其他费用',
  '增值业务地方税费': '地方税费',
  '增值业务劳动保护': '劳动保护',
  '增值业务信息服务类费用': '信息服务费',
  '增值业务中介服务费': '中介服务费',
  '增值业务商业保险': '商业保险',
  '增值业务其他费用': '其他费用',
  '增值业务技术服务费': '技术服务费',
  '增值业务安全监察专项费用': '安全监察专项费用',
  // 静态改名
  '累计未分配利润(万元)': '未分配利润',
  // 现金流净额改名
  '经营活动产生的现金流量净额': '经营活动产生的现金流量',
  '投资活动产生的现金流量净额': '投资活动产生的现金流量',
  '筹资活动产生的现金流量净额': '筹资活动产生的现金流量',
}

/** 不迁移（数据保留旧码，孤儿行可追溯）的旧科目名称 */
const DROP_NAMES = new Set([
  // 旧导入数据叶子 → 新体系为汇总父（语义变化）
  '总资产', '总负债', '权益净资产',
  // 旧现金流指标段（净额式口径与新 CF 明细式不同构，由导入重新提供）
  '自由现金流',
  '经营活动产生的现金流量净额', '经营活动产生的现金流入', '经营活动产生的现金流出',
  '投资活动产生的现金流量净额', '投资活动产生的现金流入', '投资活动产生的现金流出',
  '筹资活动产生的现金流量净额', '筹资活动产生的现金流入', '筹资活动产生的现金流出',
])

/** 应收子科目合并目标（多对一：旧子科目数据并入新叶子科目） */
const AR_CHILD_NAMES = new Set(['集团内客户（含城燃体系）', '集团外客户', '已收燃易信'])
const AR_TARGET_NAME = '应收账款'

interface OldSubjectRow {
  code: string
  name: string
  subjectType: string
}

/** 生成 旧码→新码 映射（名称路径 + 改名表 + 应收多对一合并） */
function buildCodeMap(oldSubjects: OldSubjectRow[], newNameToCode: Map<string, string>): { map: Map<string, string>; dropped: string[] } {
  const map = new Map<string, string>()
  const dropped: string[] = []
  const arTarget = newNameToCode.get(AR_TARGET_NAME)
  for (const s of oldSubjects) {
    if (DROP_NAMES.has(s.name)) {
      dropped.push(`${s.code} ${s.name}`)
      continue
    }
    if (AR_CHILD_NAMES.has(s.name)) {
      // 应收子科目多对一合并至新应收账款
      if (arTarget && s.code !== arTarget) map.set(s.code, arTarget)
      continue
    }
    const newName = NAME_REMAP[s.name] ?? s.name
    const newCode = newNameToCode.get(newName)
    if (!newCode) {
      dropped.push(`${s.code} ${s.name}（新体系无同名/映射科目）`)
      continue
    }
    if (s.code !== newCode) map.set(s.code, newCode)
  }
  return { map, dropped }
}

/** 递归遍历 JSON，字符串值命中旧码即替换（mapping_scheme.column_map 防御性处理） */
function rewriteJsonValue(v: unknown, map: Map<string, string>): unknown {
  if (typeof v === 'string') return map.get(v) ?? v
  if (Array.isArray(v)) return v.map((x) => rewriteJsonValue(x, map))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = rewriteJsonValue(val, map)
    return out
  }
  return v
}

/** 单批事实行迁移（多旧码→单新码聚合合并）：先删旧行，目标已有行累加 / 无则插入聚合行 */
async function migrateFactRows(
  tx: Prisma.TransactionClient,
  table: 'factOperating' | 'factStatic' | 'factBudget',
  srcCodes: string[],
  targetCode: string,
): Promise<number> {
  // factBudget 无 periodDimCode（key 用 fiscalYear|period）；operating/static 有 periodDimCode
  const isBudget = table === 'factBudget'

  // 1) 读旧行 + 目标行（防唯一约束冲突）
  let oldRows: { id: string; companyCode: string; batchId: string; value: number; period?: string; periodDimCode?: string; fiscalYear?: string | null; snapshotDate?: Date }[]
  let existing: Map<string, { companyCode: string; batchId: string; periodKey: string; periodDimCode: string; fiscalYear?: string | null; value: number }>
  const keyOf = (r: { companyCode: string; batchId: string; period?: string; periodDimCode?: string; fiscalYear?: string | null; snapshotDate?: Date }): string =>
    isBudget ? `${r.companyCode}|${r.fiscalYear ?? ''}|${r.period ?? ''}|${r.batchId}` : `${r.companyCode}|${(r as { snapshotDate?: Date }).snapshotDate ? ((r as { snapshotDate?: Date }).snapshotDate as Date).toISOString() : (r.period ?? '')}|${r.periodDimCode ?? ''}|${r.batchId}`

  if (table === 'factStatic') {
    oldRows = await tx.factStatic.findMany({
      where: { accountCode: { in: srcCodes } },
      select: { id: true, companyCode: true, batchId: true, snapshotDate: true, periodDimCode: true, fiscalYear: true, value: true },
    })
    const rows = await tx.factStatic.findMany({
      where: { accountCode: targetCode },
      select: { companyCode: true, batchId: true, snapshotDate: true, periodDimCode: true, fiscalYear: true, value: true },
    })
    existing = new Map(rows.map((r) => [keyOf(r), { companyCode: r.companyCode, batchId: r.batchId, periodKey: r.snapshotDate.toISOString(), periodDimCode: r.periodDimCode, fiscalYear: r.fiscalYear, value: Number(r.value) }]))
  } else if (isBudget) {
    oldRows = await tx.factBudget.findMany({
      where: { accountCode: { in: srcCodes } },
      select: { id: true, companyCode: true, batchId: true, fiscalYear: true, period: true, value: true },
    })
    const rows = await tx.factBudget.findMany({
      where: { accountCode: targetCode },
      select: { companyCode: true, batchId: true, fiscalYear: true, period: true, value: true },
    })
    existing = new Map(rows.map((r) => [keyOf(r), { companyCode: r.companyCode, batchId: r.batchId, periodKey: r.period, periodDimCode: '', fiscalYear: r.fiscalYear, value: Number(r.value) }]))
  } else {
    oldRows = await tx.factOperating.findMany({
      where: { accountCode: { in: srcCodes } },
      select: { id: true, companyCode: true, batchId: true, period: true, periodDimCode: true, fiscalYear: true, value: true },
    })
    const rows = await tx.factOperating.findMany({
      where: { accountCode: targetCode },
      select: { companyCode: true, batchId: true, period: true, periodDimCode: true, fiscalYear: true, value: true },
    })
    existing = new Map(rows.map((r) => [keyOf(r), { companyCode: r.companyCode, batchId: r.batchId, periodKey: r.period, periodDimCode: r.periodDimCode, fiscalYear: r.fiscalYear, value: Number(r.value) }]))
  }
  if (oldRows.length === 0) return 0

  // 2) 旧行按 key 聚合（多对一合并）
  const agg = new Map<string, { companyCode: string; batchId: string; periodKey: string; periodDimCode: string; fiscalYear?: string | null; value: number }>()
  for (const r of oldRows) {
    const periodKey = (r as { snapshotDate?: Date }).snapshotDate
      ? ((r as { snapshotDate?: Date }).snapshotDate as Date).toISOString()
      : (r.period as string)
    const key = keyOf(r)
    const rec = agg.get(key) ?? { companyCode: r.companyCode, batchId: r.batchId, periodKey, periodDimCode: r.periodDimCode ?? '', fiscalYear: r.fiscalYear ?? undefined, value: 0 }
    rec.value = Number((rec.value + Number(r.value)).toFixed(4))
    agg.set(key, rec)
  }

  // 3) 目标已有行累加聚合值，其余转为待插入行
  const toInsert: Record<string, unknown>[] = []
  for (const [key, rec] of agg) {
    const ex = existing.get(key)
    if (ex) {
      const newValue = Number((ex.value + rec.value).toFixed(4))
      if (table === 'factStatic') {
        await tx.factStatic.updateMany({
          where: { accountCode: targetCode, companyCode: rec.companyCode, batchId: rec.batchId, snapshotDate: new Date(rec.periodKey), periodDimCode: rec.periodDimCode },
          data: { value: newValue },
        })
      } else if (isBudget) {
        await tx.factBudget.updateMany({
          where: { accountCode: targetCode, companyCode: rec.companyCode, batchId: rec.batchId, fiscalYear: rec.fiscalYear ?? undefined, period: rec.periodKey },
          data: { value: newValue },
        })
      } else {
        await tx.factOperating.updateMany({
          where: { accountCode: targetCode, companyCode: rec.companyCode, batchId: rec.batchId, period: rec.periodKey, periodDimCode: rec.periodDimCode },
          data: { value: newValue },
        })
      }
    } else {
      if (table === 'factStatic') {
        toInsert.push({ companyCode: rec.companyCode, batchId: rec.batchId, snapshotDate: new Date(rec.periodKey), periodDimCode: rec.periodDimCode, fiscalYear: rec.fiscalYear ?? null, value: rec.value })
      } else if (isBudget) {
        toInsert.push({ companyCode: rec.companyCode, batchId: rec.batchId, fiscalYear: rec.fiscalYear ?? null, period: rec.periodKey, value: rec.value })
      } else {
        toInsert.push({ companyCode: rec.companyCode, batchId: rec.batchId, period: rec.periodKey, periodDimCode: rec.periodDimCode, fiscalYear: rec.fiscalYear ?? null, value: rec.value })
      }
    }
  }

  // 4) 删除旧行
  const del = table === 'factStatic'
    ? await tx.factStatic.deleteMany({ where: { accountCode: { in: srcCodes } } })
    : isBudget
      ? await tx.factBudget.deleteMany({ where: { accountCode: { in: srcCodes } } })
      : await tx.factOperating.deleteMany({ where: { accountCode: { in: srcCodes } } })

  // 5) 插入聚合行
  if (toInsert.length > 0) {
    if (isBudget) {
      await tx.factBudget.createMany({ data: toInsert.map((r) => ({ ...r, accountCode: targetCode })), skipDuplicates: true })
    } else if (table === 'factStatic') {
      await tx.factStatic.createMany({ data: toInsert.map((r) => ({ ...r, accountCode: targetCode })), skipDuplicates: true })
    } else {
      await tx.factOperating.createMany({ data: toInsert.map((r) => ({ ...r, accountCode: targetCode })), skipDuplicates: true })
    }
  }
  return del.count
}

async function main(): Promise<void> {
  // 0) 清理早期误生成的下划线式新编码（PL_/BS_/CF_ 前缀，正式编码无下划线 PL01/BS01/CF01）。
  // 注意：不能使用 prisma startsWith（PostgreSQL LIKE 中 _ 为单字符通配符，会误删 PL01 等正式编码），
  // 必须用正则 ^(PL|BS|CF)_ 字面匹配下划线前缀。
  const legacyUnderscore = await prisma.$executeRawUnsafe(`DELETE FROM "metric" WHERE code ~ '^(PL|BS|CF)_'`)
  const delSubject = await prisma.$executeRawUnsafe(`DELETE FROM "account_subject" WHERE code ~ '^(PL|BS|CF)_'`)
  if (delSubject > 0) console.log(`[migrate] 清理下划线式旧编码：科目 ${delSubject} 条 / 指标 ${legacyUnderscore} 条`)

  // 1) 新树编码表（名称 → 新码，三套体系）
  const newSubjects = [...decorateTree(rawOperatingAnalysis, 'PL'), ...decorateTree(rawStaticAnalysis, 'BS'), ...decorateTree(rawCashflowAnalysis, 'CF')]
  const newNameToCode = new Map(newSubjects.map((s) => [s.name, s.code]))
  console.log(`[migrate] 新体系科目 ${newSubjects.length} 条（经营/静态/现金流）`)

  // 2) 旧科目（operating/static，新旧前缀均覆盖，幂等可重跑）
  const oldSubjects = await prisma.accountSubject.findMany({
    where: { subjectType: { in: ['operating', 'static'] } },
    select: { code: true, name: true, subjectType: true },
  })
  const { map, dropped } = buildCodeMap(oldSubjects as OldSubjectRow[], newNameToCode)
  console.log(`[migrate] 旧科目 ${oldSubjects.length} 条，可映射 ${map.size} 条，不迁移 ${dropped.length} 条`)
  for (const d of dropped) console.warn(`[warn] 不迁移：${d}（数据保留旧码，可追溯）`)

  // 3) 停用旧科目与旧指标（前缀过滤保证幂等，不伤新树）
  const oldPrefix = { OR: [{ code: { startsWith: 'OP_' } }, { code: { startsWith: 'ST_' } }] }
  const inactiveSubjects = await prisma.accountSubject.updateMany({ where: { ...oldPrefix }, data: { status: 'inactive' } })
  const inactiveMetrics = await prisma.metric.updateMany({ where: { ...oldPrefix }, data: { status: 'inactive' } })
  console.log(`[migrate] 旧科目停用 ${inactiveSubjects.count} 条，旧指标停用 ${inactiveMetrics.count} 条`)

  // 4) 事实数据迁移（按新码分组聚合：同新码的多个旧码先合并再写回）
  const stats: Record<string, number> = {}
  const byTarget = new Map<string, string[]>()
  for (const [oldCode, newCode] of map) {
    const list = byTarget.get(newCode) ?? []
    list.push(oldCode)
    byTarget.set(newCode, list)
  }
  let groupIdx = 0
  const groups = [...byTarget.entries()]
  for (const [newCode, srcCodes] of groups) {
    groupIdx++
    await prisma.$transaction(async (tx) => {
      for (const table of ['factOperating', 'factStatic', 'factBudget'] as const) {
        const n = await migrateFactRows(tx, table, srcCodes, newCode)
        if (n > 0) stats[table] = (stats[table] ?? 0) + n
      }
      // 引用字段逐码替换（无唯一约束，直接 updateMany）
      for (const oldCode of srcCodes) {
        const r1 = await tx.reclassificationLog.updateMany({ where: { sourceSubject: oldCode }, data: { sourceSubject: newCode } })
        const r2 = await tx.reclassificationLog.updateMany({ where: { targetSubject: oldCode }, data: { targetSubject: newCode } })
        if (r1.count + r2.count > 0) stats.reclassification_log = (stats.reclassification_log ?? 0) + r1.count + r2.count
        const r3 = await tx.subjectAnalysis.updateMany({ where: { subjectCode: oldCode }, data: { subjectCode: newCode } })
        if (r3.count > 0) stats.subject_analysis = (stats.subject_analysis ?? 0) + r3.count
        const r4 = await tx.consolidationAdjustment.updateMany({ where: { accountCode: oldCode }, data: { accountCode: newCode } })
        if (r4.count > 0) stats.consolidation_adjustment = (stats.consolidation_adjustment ?? 0) + r4.count
      }
    })
    if (groupIdx % 10 === 0) console.log(`[migrate] 事实迁移 ${groupIdx}/${groups.length} 组完成`)
  }

  // 5) mapping_scheme.column_map JSON 值重写（防御性：旧 mapping 方案引用的科目码）
  const schemes = await prisma.mappingScheme.findMany({ select: { id: true, columnMap: true } })
  for (const sch of schemes) {
    const rewritten = rewriteJsonValue(sch.columnMap, map)
    await prisma.mappingScheme.update({ where: { id: sch.id }, data: { columnMap: rewritten as never } })
  }
  stats.mapping_scheme = schemes.length

  // 6) 旧运营费用映射停用（新映射由 seed 按新费用树创建；管理员对旧行的归并/墓碑不随新体系生效）
  const inactiveMappings = await prisma.expenseSubjectMapping.updateMany({
    where: { code: { startsWith: 'OP_' } },
    data: { status: 'inactive' },
  })
  stats.expense_mapping = inactiveMappings.count

  console.log('[migrate] 迁移完成：', JSON.stringify(stats, null, 2))
  console.log('[migrate] 新旧码对照抽查（前 8 条）：')
  for (const [oldCode, newCode] of [...map.entries()].slice(0, 8)) console.log(`  ${oldCode} → ${newCode}`)
  console.log('[migrate] 提示：随后运行 `npm run prisma:seed` 创建新体系科目/指标/公式/费用映射；如撤销请恢复迁移前备份。')
}

main()
  .catch((e) => {
    console.error('[migrate] 失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
