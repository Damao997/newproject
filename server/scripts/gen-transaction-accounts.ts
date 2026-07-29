/* eslint-disable no-console */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import * as XLSX from 'xlsx'

/**
 * 从集团 ERP 科目表（CG_COA_ACCOUNT 段值信息 xlsx）生成往来会计科目主数据种子。
 *
 * 用法：npx tsx scripts/gen-transaction-accounts.ts [xlsx路径]
 * 默认路径为桌面上的《浙江壹品慧科技杭州分公司科目表段值信息.xlsx》。
 * 输出：prisma/seed-data/transaction-accounts.ts（纯文本，便于 review 与版本管理）。
 *
 * 仅提取六大往来相关科目（按 12 位编码前缀映射），其余会计科目（现金/费用/权益等）不纳入。
 */

/** 编码前缀 → [往来类型, 方向, 科目说明应有前缀] */
const PREFIX_MAP: Record<string, [string, string, string]> = {
  '1122': ['应收账款', 'AR', '应收账款'],
  '1123': ['预付账款', 'AR', '预付账款'],
  '1221': ['其他应收款', 'AR', '其他应收款'],
  '2202': ['应付账款', 'AP', '应付账款'],
  '2203': ['预收账款', 'AP', '预收账款'],
  '2241': ['其他应付款', 'AP', '其他应付款'],
}

const DEFAULT_XLSX = path.join(
  process.env.USERPROFILE || process.env.HOME || '.',
  'Desktop',
  '浙江壹品慧科技杭州分公司科目表段值信息.xlsx',
)

interface AccountSeed {
  code: string
  name: string
  transactionType: string
  direction: string
  note: string | null
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return String(Math.round(v))
  return String(v).trim()
}

function main() {
  const file = process.argv[2] || DEFAULT_XLSX
  const wb = XLSX.read(readFileSync(file), { type: 'buffer' })
  const sheetName = wb.SheetNames.find((n) => n.includes('段值')) || wb.SheetNames[0]
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName], { header: 1, blankrows: false })

  // 动态定位表头行（含「段值」列）
  let headerIdx = -1
  let codeCol = -1
  let nameCol = -1
  const noteCols: number[] = []
  for (let r = 0; r < Math.min(20, rows.length); r++) {
    const row = rows[r] || []
    const idx = row.findIndex((c) => cellText(c) === '段值')
    if (idx >= 0) {
      headerIdx = r
      codeCol = idx
      nameCol = row.findIndex((c) => cellText(c) === '段说明')
      row.forEach((c, i) => { if (cellText(c).startsWith('附加信息')) noteCols.push(i) })
      break
    }
  }
  if (headerIdx < 0 || codeCol < 0 || nameCol < 0) {
    throw new Error(`未能定位表头（需含「段值」「段说明」列）：sheet=${sheetName}`)
  }

  const seeds: AccountSeed[] = []
  const seen = new Set<string>()
  let scanned = 0
  let mismatch = 0

  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const code = cellText(row[codeCol])
    if (!/^\d{12}$/.test(code)) continue // 非 12 位科目段值（页脚/空行/异常行）跳过
    scanned++
    const mapped = PREFIX_MAP[code.slice(0, 4)]
    if (!mapped) continue // 非六大往来科目
    const [transactionType, direction, expectedPrefix] = mapped
    const name = cellText(row[nameCol])
    if (!name) continue
    if (!name.startsWith(expectedPrefix)) {
      // 双重校验：编码前缀与说明前缀不一致时告警，仍以编码前缀为准
      mismatch++
      console.warn(`[warn] 科目 ${code} 说明「${name}」与编码前缀映射「${expectedPrefix}」不一致`)
    }
    if (seen.has(code)) continue
    seen.add(code)
    const note = noteCols.map((c) => cellText(row[c])).find((t) => t && t !== 'YES') || null
    seeds.push({ code, name, transactionType, direction, note })
  }

  const stats = Object.values(PREFIX_MAP).reduce<Record<string, number>>((acc, [t]) => {
    acc[t] = seeds.filter((s) => s.transactionType === t).length
    return acc
  }, {})

  const out = `/**
 * 往来会计科目主数据种子（由 scripts/gen-transaction-accounts.ts 从集团 ERP 科目表 xlsx 生成，请勿手改）。
 * 来源值集：CG_COA_ACCOUNT（中燃集团会计科目段），仅含六大往来相关科目。
 * 生成统计：${Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(' / ')}，合计 ${seeds.length} 条。
 */

export interface TransactionAccountSeed {
  code: string
  name: string
  transactionType: string
  direction: string
  note: string | null
}

export const transactionAccounts: TransactionAccountSeed[] = [
${seeds.map((s) => `  { code: '${s.code}', name: '${s.name.replace(/'/g, "\\'")}', transactionType: '${s.transactionType}', direction: '${s.direction}', note: ${s.note ? `'${s.note.replace(/'/g, "\\'")}'` : 'null'} },`).join('\n')}
]
`

  const target = path.join(__dirname, '..', 'prisma', 'seed-data', 'transaction-accounts.ts')
  writeFileSync(target, out, 'utf8')
  console.log(`源文件：${file}\nSheet：${sheetName}｜扫描科目 ${scanned} 条｜说明前缀不一致 ${mismatch} 条`)
  console.log(`往来科目 ${seeds.length} 条：`, JSON.stringify(stats))
  console.log(`已写入 ${target}`)
}

main()
