/**
 * 期数（会计期间）工具：期格式统一 `YYYY-MM`，字典序即时间序。
 * 支持可配置财年起始月 FISCAL_START_MONTH（1–12，默认 1）。
 * 全部为纯函数，便于单测；财年起始月可显式传入或回退到环境配置。
 */

/** 读取财年起始月（env FISCAL_START_MONTH，默认 1，非法回退 1） */
export function getFiscalStartMonth(): number {
  const raw = process.env.FISCAL_START_MONTH
  const n = raw ? Number(raw) : 1
  if (!Number.isInteger(n) || n < 1 || n > 12) return 1
  return n
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 解析 `YYYY-MM` → { year, month }（month 为 1–12） */
export function parsePeriod(period: string): { year: number; month: number } {
  const [y, m] = period.split('-')
  return { year: Number(y), month: Number(m) }
}

/** 组装 `YYYY-MM`（自动进位/借位规范月份） */
export function formatPeriod(year: number, month: number): string {
  const y = year + Math.floor((month - 1) / 12)
  const m = ((month - 1) % 12 + 12) % 12 + 1
  return `${y}-${pad2(m)}`
}

/** 期所属财年的起始年份（起始月为 S：month>=S 属当年财年，否则属上一年财年） */
export function fiscalYearStartYear(period: string, startMonth = getFiscalStartMonth()): number {
  const { year, month } = parsePeriod(period)
  return month >= startMonth ? year : year - 1
}

/** 期所属财年标签，如 `FY2026` */
export function fiscalYearLabel(period: string, startMonth = getFiscalStartMonth()): string {
  return `FY${fiscalYearStartYear(period, startMonth)}`
}

/** 期所属财年的起始期 `YYYY-MM`（如 S=4 → `2026-04`） */
export function fiscalYearStartPeriod(period: string, startMonth = getFiscalStartMonth()): string {
  return `${fiscalYearStartYear(period, startMonth)}-${pad2(startMonth)}`
}

/**
 * 期所属财年的年初快照月：财年起始月的前一月（= 上年期末余额时点）。
 * 静态快照为资产负债表日（月末）余额，故年初数取起始月前一月快照：
 * S=4 且期属 FY2026 → `2026-03`；S=1 → 上年 `12` 月（formatPeriod 自动进位）。
 */
export function fiscalYearOpeningSnapshotPeriod(period: string, startMonth = getFiscalStartMonth()): string {
  const { year, month } = parsePeriod(fiscalYearStartPeriod(period, startMonth))
  return formatPeriod(year, month - 1)
}

/** 期向前推 n 年（同月） */
export function periodMinusYears(period: string, n: number): string {
  const { year, month } = parsePeriod(period)
  return formatPeriod(year - n, month)
}

/** 闭区间 [start, end] 内的所有期（含端点，升序）；start>end 返回空 */
export function periodsInRange(start: string, end: string): string[] {
  if (start > end) return []
  const out: string[] = []
  const s = parsePeriod(start)
  const e = parsePeriod(end)
  let cur = s.year * 12 + (s.month - 1)
  const last = e.year * 12 + (e.month - 1)
  while (cur <= last) {
    out.push(`${Math.floor(cur / 12)}-${pad2((cur % 12) + 1)}`)
    cur++
  }
  return out
}

/** 日期所属财年标签（UTC 年月），用于导入时写入事实的 fiscalYear */
export function fyLabelOfDate(date: Date, startMonth = getFiscalStartMonth()): string {
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth() + 1
  return `FY${month >= startMonth ? year : year - 1}`
}

/**
 * 财年累计天数：财年起始月首日 → 指定期间月末日的天数（含两端，UTC 计算，自动处理闰年）。
 * 供公式伪操作数 {DAYS_YTD} 使用（周转天数类指标）。
 */
export function fiscalYtdDays(period: string, startMonth = getFiscalStartMonth()): number {
  const start = fiscalYearStartPeriod(period, startMonth)
  const s = parsePeriod(start)
  const e = parsePeriod(period)
  const startDate = Date.UTC(s.year, s.month - 1, 1)
  // 月末日：下月首日减一天
  const endDate = Date.UTC(e.year, e.month, 1) - 24 * 3600 * 1000
  return Math.round((endDate - startDate) / (24 * 3600 * 1000)) + 1
}
