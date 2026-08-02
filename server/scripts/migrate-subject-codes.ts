/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client'
import { rootSubjectCodeOf, childSubjectCodeOf } from '../prisma/seed-data/subject-trees'

/**
 * 科目编码体系迁移脚本：OP_001~OP_152 / ST_001~ST_034 → 级联数字编码（OP_02 / OP_0201 / OP_020101...）。
 *
 * 规则（与 prisma/seed-data/subject-trees.ts 的 decorateTree 一致）：
 * - level0：前缀 + SUBJECT_SEGMENT_MAP 登记段位（经营 01-08；静态 资产 10-15 / 负债 20-24 / 权益 30-31 / 比率 40-44）
 * - 子级：父码 + 2 位序号（每父级从 1 递增）
 *
 * 迁移范围（分批小事务，每批 15 码）：
 *   account_subject(code/parent_code)、metric(code/formula/depends_on/source_account_codes)、
 *   metric_definition_history(formula)、fact_operating/fact_static/fact_budget(account_code)、
 *   reclassification_log(source_subject/target_subject)、mapping_scheme(column_map 值命中即替换)。
 *
 * 幂等：映射按科目名称/结构确定性生成，已迁移科目 old==new（更新无害），可中断后续跑。
 * 无法映射的科目（用户自建 level0、未在 SUBJECT_SEGMENT_MAP 登记段位）整棵子树跳过并警告。
 * 迁移前建议备份 .pgdata 或 pg_dump。
 * 用法：npx tsx scripts/migrate-subject-codes.ts
 */

const prisma = new PrismaClient()

/** 公式字符串中 {旧码} / {旧码@维度} 替换为 {新码} / {新码@维度}；伪操作数（DAYS_YTD）不受影响 */
function rewriteFormula(formula: string, map: Map<string, string>): string {
  return formula.replace(/\{([^}@]+)(@[^}]+)?\}/g, (whole, code: string, dim?: string) => {
    const next = map.get(code.trim())
    if (!next) return whole
    return dim ? `{${next}${dim}}` : `{${next}}`
  })
}

/** 编码数组元素逐项替换（未命中保持原值） */
function rewriteCodes(list: string[] | null | undefined, map: Map<string, string>): string[] | null {
  if (!list) return null
  return list.map((c) => map.get(c) ?? c)
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

interface SubjectRow {
  code: string
  name: string
  subjectType: string
  level: number
  parentCode: string | null
  orderNo: number
}

/** 按 subjectType 分组建树（orderNo 升序），前序遍历生成级联新码；无法映射的根（自建未登记科目）跳过整棵子树 */
function buildCodeMap(subjects: SubjectRow[]): { map: Map<string, string>; skippedRoots: string[]; migrated: number } {
  const map = new Map<string, string>()
  const skippedRoots: string[] = []
  let migrated = 0

  for (const type of ['operating', 'static'] as const) {
    const typeSubjects = subjects.filter((s) => s.subjectType === type).sort((a, b) => a.orderNo - b.orderNo)
    const typeCodes = new Set(typeSubjects.map((s) => s.code))
    const byParent = new Map<string | null, SubjectRow[]>()
    for (const s of typeSubjects) {
      const list = byParent.get(s.parentCode) ?? []
      list.push(s)
      byParent.set(s.parentCode, list)
    }
    // 根 = 无父码或父码不在本类型科目中（后者为孤立节点，level>0 时无法映射）
    const roots = typeSubjects.filter((s) => !s.parentCode || !typeCodes.has(s.parentCode))

    const prefix = type === 'operating' ? 'OP' : 'ST'
    const walk = (nodes: SubjectRow[], parentNewCode: string | null, level: number): void => {
      let seq = 0
      for (const n of nodes) {
        let newCode: string
        if (level === 0) {
          try {
            newCode = rootSubjectCodeOf(prefix, n.name)
          } catch {
            skippedRoots.push(n.name)
            continue // 根无法登记段位（用户自建 level0），整棵子树保持旧码
          }
        } else if (parentNewCode) {
          newCode = childSubjectCodeOf(parentNewCode, ++seq)
        } else {
          skippedRoots.push(n.name)
          continue // 孤立子级（父科目不存在），无法确定性编码
        }
        map.set(n.code, newCode)
        migrated++
        const children = byParent.get(n.code) ?? []
        if (children.length > 0) walk(children, newCode, level + 1)
      }
    }
    walk(roots, null, 0)
  }
  return { map, skippedRoots, migrated }
}

/** 全量新旧码映射（公式/JSON 替换用，需跨批可见） */
let globalMap: Map<string, string> | null = null
function mapAll(): Map<string, string> {
  if (!globalMap) throw new Error('mapAll 未初始化')
  return globalMap
}

async function main(): Promise<void> {
  // 1) 读取全量科目，生成 旧码→新码 映射（幂等：已迁移科目 old==new，更新无害）
  const subjects = (await prisma.accountSubject.findMany({
    select: { code: true, name: true, subjectType: true, level: true, parentCode: true, orderNo: true },
    orderBy: { orderNo: 'asc' },
  })) as SubjectRow[]
  const { map, skippedRoots, migrated } = buildCodeMap(subjects)
  console.log(`[migrate] 科目共 ${subjects.length} 条，可映射 ${migrated} 条，跳过（未登记段位）${skippedRoots.length} 个根`)
  for (const r of skippedRoots) console.warn(`[warn] 跳过 level0 科目（未在 SUBJECT_SEGMENT_MAP 登记）：${r}`)
  if (migrated === 0) {
    console.log('[migrate] 无可映射科目，退出。')
    return
  }
  globalMap = map

  // 2) 冲突校验：新码不得与现有编码重叠（old==new 的已迁移科目除外），否则违反唯一约束
  const oldSet = new Set(subjects.map((s) => s.code))
  const newSet = new Set(map.values())
  const conflicts = [...newSet].filter((c) => oldSet.has(c) && map.get(c) !== c)
  if (conflicts.length > 0) {
    console.error(`[migrate] 新编码与现有科目编码冲突（前 10）：${conflicts.slice(0, 10).join(', ')}，中止迁移。`)
    process.exitCode = 1
    return
  }

  // 3) 分批迁移（每批 15 个编码一个小事务，控制单次查询量与失败回滚范围；批间短暂释放连接）
  const entries = [...map.entries()]
  const stats: Record<string, number> = {}
  for (let i = 0; i < entries.length; i += 15) {
    const batch = new Map(entries.slice(i, i + 15))
    const s = await migrateBatch(batch)
    for (const [k, v] of Object.entries(s)) stats[k] = (stats[k] ?? 0) + v
    console.log(`[migrate] 批次 ${Math.min(i + 15, entries.length)}/${entries.length} 完成`)
    if (i + 15 < entries.length) await new Promise((r) => setTimeout(r, 300))
  }

  console.log('[migrate] 迁移完成：', JSON.stringify(stats, null, 2))
  console.log('[migrate] 新旧码对照抽查：')
  for (const [oldCode, newCode] of entries.slice(0, 6)) console.log(`  ${oldCode} → ${newCode}`)
  console.log('[migrate] 提示：迁移后需重新运行 `npm run prisma:seed` 以幂等同步 seed 数据；如后续撤销，请恢复迁移前备份。')
}

/** 单批迁移（小事务）：metric → metric_definition_history → fact_* → reclassification_log → mapping_scheme → account_subject */
async function migrateBatch(batch: Map<string, string>): Promise<Record<string, number>> {
  const s: Record<string, number> = {}
  await prisma.$transaction(async (tx) => {
    // 3.1 metric：code + formula + dependsOn + sourceAccountCodes
    const metrics = await tx.metric.findMany({ where: { code: { in: [...batch.keys()] } }, select: { code: true, formula: true, dependsOn: true, sourceAccountCodes: true } })
    for (const m of metrics) {
      const newCode = batch.get(m.code) as string
      if (newCode === m.code) continue
      await tx.metric.updateMany({
        where: { code: m.code },
        data: {
          code: newCode,
          formula: m.formula ? rewriteFormula(m.formula, mapAll()) : m.formula,
          dependsOn: rewriteCodes(m.dependsOn as string[] | null, mapAll()) as never,
          sourceAccountCodes: rewriteCodes(m.sourceAccountCodes as string[] | null, mapAll()) as never,
        },
      })
      s.metric = (s.metric ?? 0) + 1
    }

    // 3.2 metric_definition_history：formula 字符串替换（读全量，仅替换非空 formula）
    const histories = await tx.metricDefinitionHistory.findMany({ select: { id: true, formula: true } })
    for (const h of histories) {
      if (!h.formula) continue
      await tx.metricDefinitionHistory.update({ where: { id: h.id }, data: { formula: rewriteFormula(h.formula, mapAll()) } })
    }
    s.metric_definition_history = histories.filter((h) => h.formula).length

    // 3.3 三张事实表：account_code 逐码替换
    for (const table of ['factOperating', 'factStatic', 'factBudget'] as const) {
      let n = 0
      for (const [oldCode, newCode] of batch) {
        const r = await tx[table].updateMany({ where: { accountCode: oldCode }, data: { accountCode: newCode } })
        n += r.count
      }
      s[table] = (s[table] ?? 0) + n
    }

    // 3.4 reclassification_log：source_subject / target_subject
    let n = 0
    for (const [oldCode, newCode] of batch) {
      const r1 = await tx.reclassificationLog.updateMany({ where: { sourceSubject: oldCode }, data: { sourceSubject: newCode } })
      const r2 = await tx.reclassificationLog.updateMany({ where: { targetSubject: oldCode }, data: { targetSubject: newCode } })
      n += r1.count + r2.count
    }
    s.reclassification_log = (s.reclassification_log ?? 0) + n

    // 3.5 mapping_scheme：column_map JSON 值命中替换（防御性）
    const schemes = await tx.mappingScheme.findMany({ select: { id: true, columnMap: true } })
    for (const sch of schemes) {
      const rewritten = rewriteJsonValue(sch.columnMap, mapAll())
      await tx.mappingScheme.update({ where: { id: sch.id }, data: { columnMap: rewritten as never } })
    }
    s.mapping_scheme = schemes.length

    // 3.6 account_subject：先 parent_code（旧→新），后 code
    let p = 0
    for (const [oldCode, newCode] of batch) {
      const r = await tx.accountSubject.updateMany({ where: { parentCode: oldCode }, data: { parentCode: newCode } })
      p += r.count
    }
    s.account_subject_parent = (s.account_subject_parent ?? 0) + p
    let c = 0
    for (const [oldCode, newCode] of batch) {
      const r = await tx.accountSubject.updateMany({ where: { code: oldCode }, data: { code: newCode } })
      c += r.count
    }
    s.account_subject_code = (s.account_subject_code ?? 0) + c
  })
  return s
}

main()
  .catch((e) => {
    console.error('[migrate] 失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
