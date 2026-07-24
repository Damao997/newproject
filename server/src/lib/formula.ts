import { AppError } from './errors'

/**
 * 公式引擎（见 数据模型规范 §8.3）：
 * - 仅白名单字符：数字 . + - * / ( ) 空格；禁止 eval。
 * - 操作数引用格式：{metric_code}，先替换为数值再解析。
 * - 依赖 DAG 拓扑排序 + 环检测（环报错 METRIC_CIRCULAR_REF）。
 */

const SAFE_EXPR = /^[0-9+\-*/().\s]+$/

/** 将 {CODE} 替换为对应数值；缺失操作数视为 0 */
export function substituteOperands(formula: string, values: Record<string, number>): string {
  return formula.replace(/\{([A-Za-z0-9_\u4e00-\u9fa5]+)\}/g, (_m, code: string) => {
    const v = values[code]
    return Number.isFinite(v) ? String(v) : '0'
  })
}

/**
 * 递归下降解析并求值四则表达式（含括号）。禁止 eval。
 * 语法：expr = term (('+'|'-') term)* ; term = factor (('*'|'/') factor)* ; factor = number | '(' expr ')'
 */
export function evaluateExpression(expr: string): number {
  if (!SAFE_EXPR.test(expr)) {
    throw new AppError(400, 400, '公式包含非法字符')
  }
  let pos = 0
  const s = expr

  const skipWs = (): void => {
    while (pos < s.length && s[pos] === ' ') pos++
  }

  const parseExpr = (): number => {
    let value = parseTerm()
    skipWs()
    while (pos < s.length && (s[pos] === '+' || s[pos] === '-')) {
      const op = s[pos++]
      const rhs = parseTerm()
      value = op === '+' ? value + rhs : value - rhs
      skipWs()
    }
    return value
  }

  const parseTerm = (): number => {
    let value = parseFactor()
    skipWs()
    while (pos < s.length && (s[pos] === '*' || s[pos] === '/')) {
      const op = s[pos++]
      const rhs = parseFactor()
      if (op === '/') {
        value = rhs === 0 ? 0 : value / rhs
      } else {
        value = value * rhs
      }
      skipWs()
    }
    return value
  }

  const parseFactor = (): number => {
    skipWs()
    if (pos >= s.length) throw new AppError(400, 400, '公式格式错误')
    if (s[pos] === '(') {
      pos++
      const value = parseExpr()
      skipWs()
      if (s[pos] !== ')') throw new AppError(400, 400, '公式括号不匹配')
      pos++
      return value
    }
    // 一元负号
    if (s[pos] === '-') {
      pos++
      return -parseFactor()
    }
    if (s[pos] === '+') {
      pos++
      return parseFactor()
    }
    const start = pos
    while (pos < s.length && /[0-9.]/.test(s[pos])) pos++
    if (pos === start) throw new AppError(400, 400, '公式格式错误')
    const num = Number(s.slice(start, pos))
    if (!Number.isFinite(num)) throw new AppError(400, 400, '公式数值非法')
    return num
  }

  const result = parseExpr()
  skipWs()
  if (pos !== s.length) throw new AppError(400, 400, '公式格式错误')
  return result
}

/** 替换操作数并求值 */
export function evaluateFormula(formula: string, values: Record<string, number>): number {
  return evaluateExpression(substituteOperands(formula, values))
}

/**
 * 依赖 DAG 拓扑排序（Kahn 算法）+ 环检测。
 * nodes: 指标编码与其直接依赖编码列表。返回可计算顺序（被依赖者在前）。
 * 环存在时抛 METRIC_CIRCULAR_REF。
 */
export function topoSortMetrics(nodes: { code: string; dependsOn: string[] }[]): string[] {
  const depMap = new Map<string, string[]>()
  const indegree = new Map<string, number>()
  for (const n of nodes) {
    depMap.set(n.code, n.dependsOn)
    if (!indegree.has(n.code)) indegree.set(n.code, 0)
  }
  // 仅统计集合内部的依赖边
  const known = new Set(nodes.map((n) => n.code))
  for (const n of nodes) {
    for (const dep of n.dependsOn) {
      if (known.has(dep)) {
        indegree.set(n.code, (indegree.get(n.code) ?? 0) + 1)
      }
    }
  }

  const queue: string[] = []
  for (const [code, deg] of indegree) {
    if (deg === 0) queue.push(code)
  }

  const order: string[] = []
  while (queue.length > 0) {
    const code = queue.shift() as string
    order.push(code)
    // 找到依赖 code 的节点，其入度 -1
    for (const n of nodes) {
      if (depMap.get(n.code)?.includes(code) && known.has(code)) {
        const deg = (indegree.get(n.code) ?? 0) - 1
        indegree.set(n.code, deg)
        if (deg === 0) queue.push(n.code)
      }
    }
  }

  if (order.length !== nodes.length) {
    throw new AppError(30000, 409, 'METRIC_CIRCULAR_REF: 指标依赖存在环')
  }
  return order
}
