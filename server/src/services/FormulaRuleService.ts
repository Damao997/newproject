import { prisma } from '../lib/prisma'
import { AppError } from '../lib/errors'
import { substituteOperands, evaluateExpression, topoSortMetrics, OPERAND_RE } from '../lib/formula'
import { OPERATING_DIMS, STATIC_DIMS } from '../lib/metric-values'

/**
 * 公式校验服务：公式变更的统一校验（操作数存在性 + 语法 + 全图 DAG 环检测 + 期间维度后缀白名单）。
 * 供 DataService（指标公式增改/回滚）、AIProxyService（AI 公式生成结果校验）复用。
 */

/** 伪操作数（非科目编码，由求值上下文注入）：DAYS_YTD=财年累计天数 */
export const PSEUDO_OPERANDS = new Set(['DAYS_YTD'])

/** 合法期间维度后缀白名单（经营 5 维 + 静态 4 维） */
export const DIM_SUFFIXES = new Set<string>([...Object.values(OPERATING_DIMS), ...Object.values(STATIC_DIMS)])

/** 从公式提取操作数引用（含维度后缀，不去重），供后缀合法性校验 */
export function extractOperandRefs(formula: string): { code: string; dim?: string }[] {
  const refs: { code: string; dim?: string }[] = []
  const re = new RegExp(OPERAND_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(formula)) !== null) refs.push({ code: m[1].trim(), dim: m[2] })
  return refs
}

/** 从公式模板提取 {CODE} 操作数（剥离 @维度后缀、排除伪操作数，去重） */
export function extractCodes(formula: string): string[] {
  const codes = extractOperandRefs(formula)
    .map((r) => r.code)
    .filter((c) => !PSEUDO_OPERANDS.has(c))
  return Array.from(new Set(codes))
}

/** 校验维度后缀合法性，返回 warnings（空=合法） */
export function validateDimSuffixes(formula: string): string[] {
  const warnings: string[] = []
  for (const r of extractOperandRefs(formula)) {
    if (r.dim && !DIM_SUFFIXES.has(r.dim)) warnings.push(`无效的期间维度码：${r.dim}`)
    if (r.dim && PSEUDO_OPERANDS.has(r.code)) warnings.push(`伪操作数 ${r.code} 不支持维度后缀`)
  }
  return warnings
}

/** 校验公式：操作数须存在 + 语法合法 + 无环 + 维度后缀合法。返回 warnings（空=valid） */
export function validateFormula(formula: string, knownCodes: Set<string>, selfCode: string): string[] {
  const warnings: string[] = [...validateDimSuffixes(formula)]
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

export interface FormulaChangeValidation {
  dependsOn: string[]
  warnings: string[]
}

/**
 * 公式变更统一校验（全图）：
 * ① 操作数存在性（account_subject）② 语法合法 ③ 全量指标依赖图环检测（含多节点间接环）④ 维度后缀白名单。
 * 返回重算后的 dependsOn 与 warnings（空=valid）。
 */
export async function validateFormulaChange(code: string, formula: string): Promise<FormulaChangeValidation> {
  const dependsOn = extractCodes(formula)
  const warnings: string[] = [...validateDimSuffixes(formula)]

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
