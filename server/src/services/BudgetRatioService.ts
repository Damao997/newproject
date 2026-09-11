import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { getFiscalStartMonth, periodsInRange } from '../lib/period'

/**
 * 预算月度占比配置服务：按财年维护 12 个月预算占比（财年 4月起顺序），
 * 看板月度预算按占比拆分（未配置财年回退默认占比）；提供年度预算总额读取与月度金额拆分。
 */

interface AuditCtx { userId: string; traceId?: string }

/** 默认月度占比（%）：4月3%、5月8%、6月11%、7月4%、8月7%、9月12%、10月7%、11月10%、12月13%、1月5%、2月8%、3月12% */
export const DEFAULT_RATIOS = [3, 8, 11, 4, 7, 12, 7, 10, 13, 5, 8, 12] as const

const FY_RE = /^FY\d{4}$/

const round2 = (n: number): number => Number(n.toFixed(2))

/**
 * 年度预算按月度占比拆分（纯函数）：
 * 仅当占比为完整 12 项且期间序列为完整 12 个月时按占比拆分（末月余差吸收四舍五入误差，保证 Σ=年度总额）；
 * 占比缺失/期间不足 12 个月时回退年度/12 均摊；年度总额为 0 返回全 null（无预算不伪造）。
 */
export function splitMonthlyBudget(annualTotal: number, ratios: number[] | null, months: string[]): (number | null)[] {
  if (!annualTotal) return months.map(() => null)
  const useRatios = Array.isArray(ratios) && ratios.length === 12 && months.length === 12
  if (!useRatios) return months.map(() => round2(annualTotal / 12))
  const out: number[] = []
  for (let i = 0; i < 12; i++) {
    if (i === 11) {
      // 末月余差：总额 - 前 11 个月之和，保证 Σ=总额（吸收逐月四舍五入误差）
      out.push(round2(annualTotal - out.reduce((s, v) => s + v, 0)))
    } else {
      out.push(round2((annualTotal * ratios[i]) / 100))
    }
  }
  return out
}

/** 月度占比校验（纯函数）：返回错误消息，合法返回 null；总和容差 ±0.01（放大 100 倍取整比较避免浮点尾差） */
export function validateBudgetRatios(ratios: unknown): string | null {
  if (!Array.isArray(ratios) || ratios.length !== 12) return '月度占比必须为 12 项（财年 4月至次年3月）'
  for (const r of ratios) {
    if (typeof r !== 'number' || !Number.isFinite(r) || r < 0 || r > 100) return '各月占比必须为 0-100 的数值'
  }
  const sum = ratios.reduce((s, r) => s + r, 0)
  if (Math.abs(Math.round(sum * 100) - 10000) > 1) return `月度占比之和必须为 100%（当前 ${Math.round(sum * 100) / 100}%）`
  return null
}

/** 财年标签 → 财年 12 个月的期序列（YYYY-MM，升序，按财年起始月） */
export function fiscalYearMonths(fiscalYear: string): string[] {
  const year = Number(fiscalYear.replace(/^FY/, ''))
  const start = getFiscalStartMonth()
  // 结束月 = 起始月前一个月（start=1 时跨到上年 12 月）
  const endMonth = start === 1 ? 12 : start - 1
  const endYear = start === 1 ? year : year + 1
  return periodsInRange(`${year}-${String(start).padStart(2, '0')}`, `${endYear}-${String(endMonth).padStart(2, '0')}`)
}

/** 生效预算批次内该财年的年度预算总额（全部公司全部科目合计，管理员全局视角） */
async function annualBudgetTotalOf(fiscalYear: string): Promise<number> {
  const batches = await prisma.importBatch.findMany({ where: { dataType: 'budget', lifecycleStatus: 'active' }, select: { id: true } })
  if (batches.length === 0) return 0
  const agg = await prisma.factBudget.aggregate({
    where: { batchId: { in: batches.map((b) => b.id) }, fiscalYear },
    _sum: { value: true },
  })
  return round2(Number(agg._sum.value ?? 0))
}

export const BudgetRatioService = {
  /**
   * 财年月度占比配置 + 年度预算总额 + 月度拆分金额：
   * 未配置占比的财年返回默认预设（4月3%…3月12%）；annualTotal 来自该财年生效预算批次。
   */
  async get(fiscalYear: string): Promise<{ fiscalYear: string; ratios: number[]; annualTotal: number; monthlyAmounts: (number | null)[] }> {
    const fy = String(fiscalYear ?? '').trim()
    if (!FY_RE.test(fy)) throw errors.badRequest('财年格式非法（如 FY2026）')
    const row = await prisma.budgetRatioConfig.findUnique({ where: { fiscalYear: fy } })
    const ratios = row ? (row.ratios as unknown as number[]) : [...DEFAULT_RATIOS]
    const annualTotal = await annualBudgetTotalOf(fy)
    const monthlyAmounts = splitMonthlyBudget(annualTotal, ratios, fiscalYearMonths(fy))
    return { fiscalYear: fy, ratios, annualTotal, monthlyAmounts }
  },

  /** 保存财年月度占比（upsert）；校验 12 项、每项 0-100、总和=100（±0.01） */
  async update(fiscalYear: string, ratios: unknown, ctx: AuditCtx): Promise<{ fiscalYear: string; ratios: number[] }> {
    const fy = String(fiscalYear ?? '').trim()
    if (!FY_RE.test(fy)) throw errors.badRequest('财年格式非法（如 FY2026）')
    const message = validateBudgetRatios(ratios)
    if (message) throw errors.badRequest(message)
    const values = ratios as number[]
    await prisma.budgetRatioConfig.upsert({
      where: { fiscalYear: fy },
      create: { fiscalYear: fy, ratios: values },
      update: { ratios: values },
    })
    await recordAudit({ userId: ctx.userId, module: 'data', action: 'update', targetId: fy, detail: { entity: 'budget_ratio_config' } }, ctx.traceId)
    return { fiscalYear: fy, ratios: values }
  },

  /** 财年已配置占比（无记录返回 null，供看板月度预算拆分回退 /12 均摊） */
  async budgetRatiosOf(fiscalYear: string): Promise<number[] | null> {
    const row = await prisma.budgetRatioConfig.findUnique({ where: { fiscalYear } })
    return row ? (row.ratios as unknown as number[]) : null
  },
}
