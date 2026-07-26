import { prisma } from '../lib/prisma'
import { errors, AppError } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { substituteOperands, evaluateExpression, topoSortMetrics } from '../lib/formula'

/**
 * 公式规则服务：按「业务名 → 公式模板」规则为 calc 指标批量生成公式。
 * 规则匹配确定、可审计、无需 LLM；写入前做编码存在性校验 + DAG 环检测。
 */

export interface FormulaGenResult {
  code: string
  name: string
  formula: string | null
  dependsOn: string[]
  explanation: string
  valid: boolean
  warnings: string[]
  ruleName: string | null
}

interface RuleRow {
  id: string
  name: string
  formulaTemplate: string
  refCodes: unknown
  description: string | null
}

function refCodesOf(rule: RuleRow): string[] {
  return Array.isArray(rule.refCodes) ? (rule.refCodes as string[]) : []
}

/** 从公式模板提取 {CODE} 操作数 */
export function extractCodes(formula: string): string[] {
  const codes: string[] = []
  const re = /\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(formula)) !== null) codes.push(m[1].trim())
  return Array.from(new Set(codes))
}

/** 校验公式：操作数须存在 + 语法合法 + 无环。返回 warnings（空=valid） */
export function validateFormula(formula: string, knownCodes: Set<string>, selfCode: string): string[] {
  const warnings: string[] = []
  const codes = extractCodes(formula)
  for (const c of codes) {
    if (!knownCodes.has(c)) warnings.push(`引用了不存在的科目编码：${c}`)
  }
  try {
    evaluateExpression(substituteOperands(formula, {}))
  } catch {
    warnings.push('公式语法不合法（仅支持四则运算与括号）')
  }
  try {
    topoSortMetrics([{ code: selfCode, dependsOn: codes }])
  } catch {
    warnings.push('公式依赖存在环')
  }
  return warnings
}

/** 规则匹配：指标名包含规则名（取最长匹配，更精确优先） */
export function matchRule(metricName: string, rules: RuleRow[]): RuleRow | null {
  let best: RuleRow | null = null
  for (const rule of rules) {
    if (rule.name && metricName.includes(rule.name)) {
      if (!best || rule.name.length > best.name.length) best = rule
    }
  }
  return best
}

export interface FormulaChangeValidation {
  dependsOn: string[]
  warnings: string[]
}

/**
 * 公式变更统一校验（全图）：
 * ① 操作数存在性（account_subject）② 语法合法 ③ 全量指标依赖图环检测（含多节点间接环）。
 * 返回重算后的 dependsOn 与 warnings（空=valid）。
 */
export async function validateFormulaChange(code: string, formula: string): Promise<FormulaChangeValidation> {
  const dependsOn = extractCodes(formula)
  const warnings: string[] = []

  const [subjects, allMetrics] = await Promise.all([
    prisma.accountSubject.findMany({ select: { code: true } }),
    prisma.metric.findMany({ where: { status: 'active' }, select: { code: true, dependsOn: true } }),
  ])
  const knownCodes = new Set([...subjects.map((s) => s.code), ...allMetrics.map((m) => m.code)])
  for (const c of dependsOn) {
    if (!knownCodes.has(c)) warnings.push(`引用了不存在的科目编码：${c}`)
  }
  try {
    evaluateExpression(substituteOperands(formula, {}))
  } catch {
    warnings.push('公式语法不合法（仅支持四则运算与括号）')
  }
  // 全图环检测：以新依赖替换当前指标后做拓扑排序
  const nodes = allMetrics
    .filter((m) => m.code !== code)
    .map((m) => ({ code: m.code, dependsOn: Array.isArray(m.dependsOn) ? (m.dependsOn as string[]) : [] }))
  nodes.push({ code, dependsOn })
  try {
    topoSortMetrics(nodes)
  } catch (e) {
    warnings.push(e instanceof AppError ? e.message : '公式依赖存在环')
  }
  return { dependsOn, warnings }
}

export const FormulaRuleService = {
  async listRules() {
    const rows = await prisma.formulaRule.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } })
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      formulaTemplate: r.formulaTemplate,
      refCodes: refCodesOf(r),
      description: r.description,
      enabled: r.enabled,
    }))
  },

  /** 为单个指标按规则生成公式（不落库） */
  generateForMetric(metric: { code: string; name: string }, rules: RuleRow[], knownCodes: Set<string>): FormulaGenResult {
    const rule = matchRule(metric.name, rules)
    if (!rule) {
      return { code: metric.code, name: metric.name, formula: null, dependsOn: [], explanation: '未匹配到规则', valid: false, warnings: ['未匹配到公式规则'], ruleName: null }
    }
    const formula = rule.formulaTemplate
    const dependsOn = extractCodes(formula)
    const warnings = validateFormula(formula, knownCodes, metric.code)
    return {
      code: metric.code,
      name: metric.name,
      formula,
      dependsOn,
      explanation: rule.description ?? `按规则「${rule.name}」生成`,
      valid: warnings.length === 0,
      warnings,
      ruleName: rule.name,
    }
  },

  /** 批量为某类 calc 指标生成公式（预览，不落库） */
  async batchGenerate(params: { subjectType?: string }): Promise<FormulaGenResult[]> {
    const prefix = params.subjectType === 'static' ? 'ST_' : 'OP_'
    const [metrics, rules, subjects] = await Promise.all([
      prisma.metric.findMany({ where: { dataType: 'calc', status: 'active' }, select: { code: true, name: true } }),
      prisma.formulaRule.findMany({ where: { enabled: true } }),
      // 校验范围含全部科目编码（公式可跨经营/静态引用）
      prisma.accountSubject.findMany({ select: { code: true } }),
    ])
    // 公式可引用科目编码或其他指标编码
    const allMetricCodes = await prisma.metric.findMany({ where: { status: 'active' }, select: { code: true } })
    const knownCodes = new Set([...subjects.map((s) => s.code), ...allMetricCodes.map((m) => m.code)])
    return metrics
      .filter((m) => m.code.startsWith(prefix))
      .map((m) => this.generateForMetric(m, rules, knownCodes))
  },

  /** 批量应用（事务 + 逐项审计，失败整体回滚） */
  async batchApply(items: { code: string; formula: string; dependsOn: string[] }[], userId: string, traceId?: string): Promise<{ applied: number; results: { code: string; ok: boolean; message?: string }[] }> {
    const results: { code: string; ok: boolean; message?: string }[] = []
    const applied = await prisma.$transaction(async (tx) => {
      let count = 0
      for (const item of items) {
        const metric = await tx.metric.findUnique({ where: { code: item.code } })
        if (!metric) {
          results.push({ code: item.code, ok: false, message: '指标不存在' })
          continue
        }
        const before = metric.formula
        await tx.metric.update({
          where: { code: item.code },
          data: {
            formula: item.formula,
            dependsOn: item.dependsOn as never,
            isDerived: true,
            version: { increment: 1 },
          },
        })
        // 版本历史快照
        await tx.metricDefinitionHistory.create({
          data: { metricId: metric.id, version: metric.version + 1, formula: item.formula, description: '批量规则生成', changedBy: userId },
        })
        await recordAudit({ userId, module: 'data', action: 'metric_change', targetId: item.code, detail: { action: 'batch_update', before, after: item.formula } }, traceId)
        results.push({ code: item.code, ok: true })
        count++
      }
      return count
    })
    await recordAudit({ userId, module: 'ai', action: 'formula_gen_batch', detail: { applied } }, traceId)
    return { applied, results }
  },

  // ===== 公式规则库管理 =====
  async createRule(input: { name: string; formulaTemplate: string; refCodes?: string[]; description?: string }, ctx: { userId: string; traceId?: string }) {
    // 模板语法预校验
    try {
      evaluateExpression(substituteOperands(input.formulaTemplate, {}))
    } catch {
      throw errors.badRequest('公式模板语法不合法（仅支持四则运算、括号与 {编码} 引用）')
    }
    const exists = await prisma.formulaRule.findUnique({ where: { name: input.name } })
    if (exists) throw errors.conflict('规则名称已存在')
    const created = await prisma.formulaRule.create({
      data: { name: input.name, formulaTemplate: input.formulaTemplate, refCodes: (input.refCodes ?? extractCodes(input.formulaTemplate)) as never, description: input.description ?? null },
    })
    await recordAudit({ userId: ctx.userId, module: 'ai', action: 'rule_change', targetId: created.id, detail: { action: 'create', name: input.name } }, ctx.traceId)
    return created
  },

  async updateRule(id: string, input: { name?: string; formulaTemplate?: string; refCodes?: string[]; description?: string }, ctx: { userId: string; traceId?: string }) {
    const found = await prisma.formulaRule.findUnique({ where: { id } })
    if (!found) throw errors.notFound('规则不存在')
    if (input.formulaTemplate) {
      try {
        evaluateExpression(substituteOperands(input.formulaTemplate, {}))
      } catch {
        throw errors.badRequest('公式模板语法不合法（仅支持四则运算、括号与 {编码} 引用）')
      }
    }
    const updated = await prisma.formulaRule.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        formulaTemplate: input.formulaTemplate ?? undefined,
        refCodes: input.refCodes === undefined ? (input.formulaTemplate ? (extractCodes(input.formulaTemplate) as never) : undefined) : (input.refCodes as never),
        description: input.description ?? undefined,
      },
    })
    await recordAudit({ userId: ctx.userId, module: 'ai', action: 'rule_change', targetId: id, detail: { action: 'update' } }, ctx.traceId)
    return updated
  },

  async deleteRule(id: string, ctx: { userId: string; traceId?: string }) {
    const found = await prisma.formulaRule.findUnique({ where: { id } })
    if (!found) throw errors.notFound('规则不存在')
    await prisma.formulaRule.delete({ where: { id } })
    await recordAudit({ userId: ctx.userId, module: 'ai', action: 'rule_change', targetId: id, detail: { action: 'delete', name: found.name } }, ctx.traceId)
  },

  async toggleRule(id: string, enabled: boolean, ctx: { userId: string; traceId?: string }) {
    const found = await prisma.formulaRule.findUnique({ where: { id } })
    if (!found) throw errors.notFound('规则不存在')
    const updated = await prisma.formulaRule.update({ where: { id }, data: { enabled } })
    await recordAudit({ userId: ctx.userId, module: 'ai', action: 'rule_change', targetId: id, detail: { action: 'toggle', enabled } }, ctx.traceId)
    return updated
  },
}
