import { prisma } from '../lib/prisma'

/**
 * 重分类回溯差额服务：只读地按重分类日志的行级快照在内存中逆向回放
 * （与 ReclassificationService.revertLog 同语义：更新行回写、新建行剔除、删除行重现），
 * 计算"重分类前 − 当前"的净差额叠加层（delta overlay），供聚合层在查询时反向补偿，
 * 实现"去除跨公司重分类影响"的模拟视图。全程不写库、不影响真实撤销。
 *
 * 口径约定：
 * - 仅逆向 type='company'（跨公司重分类）且未撤销（revertedAt 为空）、未失效（invalidatedAt 为空）的日志；
 * - 日志按 createdAt 倒序回放（最新的先回放），保证同一行被链式多次重分类时 beforeValue 链正确；
 * - 缺快照、涉及行已不存在或所属批次不再 active 的日志整条跳过并计入 skippedLogs
 *   （与 revertLog 的拒绝条件一致）；
 * - 因批次替换/归档/清除已被联动标记失效的日志显式排除并计入 invalidatedLogs（见
 *   ReclassificationService.markInvalidatedReclassifications）。
 */

type TemplateType = 'operating' | 'static' | 'budget'

/** 快照中的行级变更（结构见 ReclassificationService.RowSnapshot；created 兼容旧格式 string） */
interface RowSnapshot {
  updated: { id: string; data: Record<string, unknown>; row?: Record<string, unknown> }[]
  created: Array<string | { id: string; data: Record<string, unknown> }>
  deleted: Record<string, unknown>[]
}

/** created 元素归一化（兼容旧格式 string） */
const createdIdOf = (c: string | { id: string; data: Record<string, unknown> }): string => (typeof c === 'string' ? c : c.id)

/** 回放用的事实行内存镜像（三张表字段的并集，static 的 snapshotDate 归一为 YYYY-MM） */
interface VirtualRow {
  batchId: string
  companyCode: string
  accountCode: string
  value: number
  period?: string
  periodDimCode?: string
  fiscalYear?: string
  snapshotMonth?: string
}

export interface ReversalDelta {
  companyCode: string
  accountCode: string
  batchId: string
  /** operating/budget：期间 YYYY-MM */
  period?: string
  /** operating/static：期间维度编码 */
  periodDimCode?: string
  /** budget：财年标签 */
  fiscalYear?: string
  /** static：快照月份 YYYY-MM */
  snapshotMonth?: string
  /** 净差额（重分类前 − 当前），叠加到聚合结果即还原原始口径 */
  delta: number
}

export interface ReversalResult {
  deltas: ReversalDelta[]
  appliedLogs: number
  skippedLogs: number
  /** 因批次替换/归档/清除已失效而被显式排除的日志数 */
  invalidatedLogs: number
}

const num = (v: unknown): number => Number(String(v ?? 0))
const round2 = (v: number): number => Math.round(v * 100) / 100

function toMonth(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined
  const d = v instanceof Date ? v : new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/** 将事实表行/快照删除行归一为内存镜像 */
function toVirtualRow(templateType: TemplateType, r: Record<string, unknown>): VirtualRow {
  const base: VirtualRow = {
    batchId: String(r.batchId ?? ''),
    companyCode: String(r.companyCode ?? ''),
    accountCode: String(r.accountCode ?? ''),
    value: num(r.value),
  }
  if (templateType === 'operating') {
    base.period = String(r.period ?? '')
    base.periodDimCode = String(r.periodDimCode ?? '')
  } else if (templateType === 'static') {
    base.snapshotMonth = toMonth(r.snapshotDate)
    base.periodDimCode = String(r.periodDimCode ?? '')
  } else {
    base.fiscalYear = String(r.fiscalYear ?? '')
    base.period = String(r.period ?? '')
  }
  return base
}

/** 差额归并键：公司 + 科目 + 期间口径 + 批次 */
function keyOf(templateType: TemplateType, r: VirtualRow): string {
  if (templateType === 'operating') return `${r.companyCode}|${r.accountCode}|${r.period}|${r.periodDimCode}|${r.batchId}`
  if (templateType === 'static') return `${r.companyCode}|${r.accountCode}|${r.snapshotMonth}|${r.periodDimCode}|${r.batchId}`
  return `${r.companyCode}|${r.accountCode}|${r.fiscalYear}|${r.period}|${r.batchId}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function delegateOf(templateType: TemplateType): { findMany: (args: { where: Record<string, unknown> }) => Promise<any[]> } {
  if (templateType === 'operating') return prisma.factOperating
  if (templateType === 'static') return prisma.factStatic
  return prisma.factBudget
}

function extractSnapshot(detail: unknown): RowSnapshot | null {
  const snap = (detail as { snapshot?: RowSnapshot } | null)?.snapshot
  if (!snap || !Array.isArray(snap.updated) || !Array.isArray(snap.created) || !Array.isArray(snap.deleted)) return null
  return snap
}

export const ReclassifyReversalService = {
  /**
   * 构建指定模板类型的重分类回溯差额层。
   * 返回按 (公司, 科目, 期间, 维度, 批次) 归并、剔除零值后的净差额，以及实际回放/跳过的日志数。
   */
  async buildReversalDeltas(templateType: TemplateType): Promise<ReversalResult> {
    const [logs, invalidatedLogs] = await Promise.all([
      prisma.reclassificationLog.findMany({
        where: { type: 'company', templateType, revertedAt: null, invalidatedAt: null },
        orderBy: { createdAt: 'desc' },
        select: { id: true, detail: true },
      }),
      prisma.reclassificationLog.count({ where: { type: 'company', templateType, revertedAt: null, invalidatedAt: { not: null } } }),
    ])
    if (logs.length === 0) return { deltas: [], appliedLogs: 0, skippedLogs: 0, invalidatedLogs }

    let skippedLogs = 0
    const withSnap: { snap: RowSnapshot }[] = []
    const allIds = new Set<string>()
    for (const log of logs) {
      const snap = extractSnapshot(log.detail)
      if (!snap) {
        skippedLogs++
        continue
      }
      withSnap.push({ snap })
      for (const u of snap.updated) allIds.add(u.id)
      for (const c of snap.created) allIds.add(createdIdOf(c))
    }
    if (withSnap.length === 0) return { deltas: [], appliedLogs: 0, skippedLogs, invalidatedLogs }

    const delegate = delegateOf(templateType)
    const rows = allIds.size > 0 ? await delegate.findMany({ where: { id: { in: [...allIds] } } }) : []
    const currentById = new Map<string, VirtualRow>(rows.map((r) => [String(r.id), toVirtualRow(templateType, r)]))

    const activeBatches = new Set(
      (await prisma.importBatch.findMany({ where: { dataType: templateType, lifecycleStatus: 'active' }, select: { id: true } })).map((b) => b.id),
    )

    // 逐日志校验（与 revertLog 一致）：涉及行仍存在且所属批次仍 active，否则整条跳过
    const isReplayable = (snap: RowSnapshot): boolean => {
      const batchIds = new Set<string>()
      for (const u of snap.updated) {
        const row = currentById.get(u.id)
        if (!row) return false
        batchIds.add(row.batchId)
      }
      for (const c of snap.created) {
        const row = currentById.get(createdIdOf(c))
        if (!row) return false
        batchIds.add(row.batchId)
      }
      for (const d of snap.deleted) if (typeof d.batchId === 'string') batchIds.add(d.batchId)
      for (const b of batchIds) if (!activeBatches.has(b)) return false
      return true
    }
    const replayable = withSnap.filter(({ snap }) => {
      const ok = isReplayable(snap)
      if (!ok) skippedLogs++
      return ok
    })
    if (replayable.length === 0) return { deltas: [], appliedLogs: 0, skippedLogs, invalidatedLogs }

    // 仅统计可回放日志涉及的行（跳过日志的行不参与差额，保持现状口径）
    const involvedIds = new Set<string>()
    for (const { snap } of replayable) {
      for (const u of snap.updated) involvedIds.add(u.id)
      for (const c of snap.created) involvedIds.add(createdIdOf(c))
    }

    const deltaMap = new Map<string, { row: VirtualRow; delta: number }>()
    const addDelta = (row: VirtualRow, v: number): void => {
      const k = keyOf(templateType, row)
      const rec = deltaMap.get(k)
      if (rec) rec.delta += v
      else deltaMap.set(k, { row, delta: v })
    }

    // 1) 扣掉受影响行的现状贡献
    const virtual = new Map<string, VirtualRow>()
    for (const id of involvedIds) {
      const cur = currentById.get(id) as VirtualRow
      addDelta(cur, -cur.value)
      virtual.set(id, { ...cur })
    }

    // 2) 倒序回放：更新行回写快照字段、新建行剔除、删除行重现
    const restored: VirtualRow[] = []
    for (const { snap } of replayable) {
      for (const u of snap.updated) {
        const row = virtual.get(u.id)
        if (!row) continue
        for (const [field, val] of Object.entries(u.data)) {
          if (field === 'value') row.value = num(val)
          else if (field === 'companyCode') row.companyCode = String(val)
          else if (field === 'accountCode') row.accountCode = String(val)
          else if (field === 'period') row.period = String(val)
          else if (field === 'fiscalYear') row.fiscalYear = String(val)
          else if (field === 'periodDimCode') row.periodDimCode = String(val)
          else if (field === 'snapshotDate') row.snapshotMonth = toMonth(val)
        }
      }
      for (const c of snap.created) virtual.delete(createdIdOf(c))
      for (const d of snap.deleted) restored.push(toVirtualRow(templateType, d))
    }

    // 3) 加回原始状态贡献
    for (const row of virtual.values()) addDelta(row, row.value)
    for (const row of restored) addDelta(row, row.value)

    // 归并输出：剔除零值与非 active 批次（删除行重现可能落在已归档批次上）
    const deltas: ReversalDelta[] = []
    for (const { row, delta } of deltaMap.values()) {
      const v = round2(delta)
      if (v === 0 || !activeBatches.has(row.batchId)) continue
      deltas.push({
        companyCode: row.companyCode,
        accountCode: row.accountCode,
        batchId: row.batchId,
        period: row.period,
        periodDimCode: row.periodDimCode,
        fiscalYear: row.fiscalYear,
        snapshotMonth: row.snapshotMonth,
        delta: v,
      })
    }
    return { deltas, appliedLogs: replayable.length, skippedLogs, invalidatedLogs }
  },
}
