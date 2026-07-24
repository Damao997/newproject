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

/**
 * 从 company 表构建动态公司名映射（active，按 code 排序保证稳定）。
 * forward 同时登记「名称→别名」与「编码→别名」；reverse 仅登记「别名→名称」。
 */
export async function buildCompanyMap(): Promise<CompanyMap> {
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
  return { forward, reverse }
}

/** 将文本中的真实公司名/编码替换为别名（长键优先，避免子串误替换） */
export function applyCompanyMap(text: string, map: CompanyMap): string {
  if (!text) return text
  const keys = Array.from(map.forward.keys()).filter(Boolean).sort((a, b) => b.length - a.length)
  let out = text
  for (const key of keys) {
    const alias = map.forward.get(key) as string
    out = out.split(key).join(alias)
  }
  return out
}

/** 将输出中的公司别名还原为真实公司名 */
export function restoreCompanyMap(text: string, map: CompanyMap): string {
  if (!text) return text
  const aliases = Array.from(map.reverse.keys()).sort((a, b) => b.length - a.length)
  let out = text
  for (const alias of aliases) {
    const name = map.reverse.get(alias) as string
    out = out.split(alias).join(name)
  }
  return out
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
