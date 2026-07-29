import { prisma } from './prisma'

/**
 * 脱敏服务（见 AI模块规范 §二、§三）。数据出内网前必须脱敏：
 * - 公司名称/编码 → 动态代号（公司A/B/C…），每次请求从 company 表重建；
 * - 绝对金额 → 区间标签（分档）；百分比/趋势方向不脱敏。
 * polish 管道用公司映射脱敏输入，并在输出侧反向还原；analyze 管道仅注入脱敏后事实。
 */

export interface CompanyMap {
  /** 真实名称/编码 → 别名（公司A…） */
  forward: Map<string, string>
  /** 别名 → 真实名称（用于 polish 输出还原） */
  reverse: Map<string, string>
}

function aliasOf(index: number): string {
  // 0→A, 25→Z, 26→AA…
  let n = index
  let s = ''
  do {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return `公司${s}`
}

// 公司映射短缓存：company 表低频变更，高频 AI 调用下避免每次全量扫表
let companyMapCache: { at: number; map: CompanyMap } | null = null
const COMPANY_MAP_TTL_MS = 60_000

/** 公司表变更后（或测试中）手动失效映射缓存 */
export function clearCompanyMapCache(): void {
  companyMapCache = null
}

/**
 * 从 company 表构建动态公司名映射（active，按 code 排序保证稳定；60s 内存缓存）。
 * forward 同时登记「名称→别名」与「编码→别名」；reverse 仅登记「别名→名称」。
 */
export async function buildCompanyMap(): Promise<CompanyMap> {
  if (companyMapCache && Date.now() - companyMapCache.at < COMPANY_MAP_TTL_MS) {
    return companyMapCache.map
  }
  const companies = await prisma.company.findMany({
    where: { status: 'active' },
    select: { code: true, name: true },
    orderBy: { code: 'asc' },
  })
  const forward = new Map<string, string>()
  const reverse = new Map<string, string>()
  companies.forEach((c, i) => {
    const alias = aliasOf(i)
    forward.set(c.name, alias)
    forward.set(c.code, alias)
    reverse.set(alias, c.name)
  })
  companyMapCache = { at: Date.now(), map: { forward, reverse } }
  return companyMapCache.map
}

/** 转义正则元字符，避免公司名/编码中的特殊字符被当作正则语法解析 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 单趟替换：按 key 长度降序构建 alternation 正则，一次扫描完成全部替换。
 * 相较多趟 split/join：已替换区域不会被后续扫描，从而消除“还原/脱敏后文本含另一 key 子串”导致的二次替换污染。
 * 正则 alternation 按列举顺序匹配，长 key 在前保证同一位置“长键优先”。
 */
function replaceOnce(text: string, mapping: Map<string, string>): string {
  if (!text) return text
  const keys = Array.from(mapping.keys()).filter(Boolean).sort((a, b) => b.length - a.length)
  if (keys.length === 0) return text
  const re = new RegExp(keys.map(escapeRegExp).join('|'), 'g')
  return text.replace(re, (m) => mapping.get(m) as string)
}

/** 将文本中的真实公司名/编码替换为别名（长键优先，避免子串误替换） */
export function applyCompanyMap(text: string, map: CompanyMap): string {
  return replaceOnce(text, map.forward)
}

/** 将输出中的公司别名还原为真实公司名 */
export function restoreCompanyMap(text: string, map: CompanyMap): string {
  return replaceOnce(text, map.reverse)
}

/** 金额分档区间（单位：元），闭下开上；见 AI模块规范 §2.2 */
const AMOUNT_INTERVALS: { min: number; max: number; label: string }[] = [
  { min: -Infinity, max: 100_000, label: '小额' },
  { min: 100_000, max: 1_000_000, label: '十万级' },
  { min: 1_000_000, max: 5_000_000, label: '百万级' },
  { min: 5_000_000, max: 10_000_000, label: '五百万级' },
  { min: 10_000_000, max: 50_000_000, label: '千万级' },
  { min: 50_000_000, max: 100_000_000, label: '五千万级' },
  { min: 100_000_000, max: 500_000_000, label: '亿级' },
  { min: 500_000_000, max: 1_000_000_000, label: '五亿级' },
  { min: 1_000_000_000, max: Infinity, label: '十亿级以上' },
]

/**
 * 将绝对金额映射为区间标签。入参单位为万元（平台统一口径），内部换算为元后分档。
 */
export function desensitizeAmountWan(valueWan: number): string {
  const yuan = Math.abs(valueWan) * 10_000
  for (const interval of AMOUNT_INTERVALS) {
    if (yuan >= interval.min && yuan < interval.max) return interval.label
  }
  return '未知量级'
}
