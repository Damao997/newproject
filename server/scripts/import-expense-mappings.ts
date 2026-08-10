/* eslint-disable no-console */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isValidMappingCode } from '../src/services/ExpenseAnalysisService'

/**
 * 导入运营费用映射配置（与 export-expense-mappings.ts 输出格式一致）。
 *
 * 用途：数据库全量重置（删除 server/.pgdata 或 migrate dev 漂移重置）后恢复映射配置，
 * 在重新执行 prisma:seed 之后运行。
 *
 * 幂等行为：
 *   - 按 code upsert：已存在（含墓碑行）则更新 name/subjectCodes/sortOrder/status 并清除墓碑复活，
 *     不存在则创建；重复执行安全。
 *   - 不删除源文件中不存在的行（防误删，seed 默认映射保留）。
 *
 * 用法（server 目录下）：
 *   npm run mapping:import                # 默认读取 ./expense-mappings.json
 *   npx tsx scripts/import-expense-mappings.ts --file <path>
 */
const prisma = new PrismaClient()

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

interface MappingImportRow {
  code: string
  name: string
  subjectCodes: string[]
  sortOrder: number
  status: 'active' | 'inactive'
}

function parseRows(data: unknown): MappingImportRow[] {
  if (!Array.isArray(data)) throw new Error('文件格式错误：应为 JSON 数组（export-expense-mappings.ts 的输出）')
  return data.map((r, i) => {
    const row = r as Partial<MappingImportRow>
    if (typeof row.code !== 'string' || !row.code) throw new Error(`第 ${i + 1} 条缺少 code`)
    // 与 ExpenseAnalysisService.create 同口径：code 须为科目编码（OP_ 数字）或 EXP_ 前缀小写英文
    if (!isValidMappingCode(row.code.trim())) throw new Error(`第 ${i + 1} 条 code 不合法（${row.code}）：需为科目编码或 EXP_ 前缀小写英文`)
    if (typeof row.name !== 'string' || !row.name) throw new Error(`第 ${i + 1} 条缺少 name`)
    if (!Array.isArray(row.subjectCodes)) throw new Error(`第 ${i + 1} 条 subjectCodes 应为数组`)
    const subjectCodes = [...new Set(row.subjectCodes.map((c) => String(c).trim()).filter(Boolean))]
    if (subjectCodes.length === 0) throw new Error(`第 ${i + 1} 条至少需要 1 个运营费用科目`)
    return {
      code: row.code.trim(),
      name: row.name.trim(),
      subjectCodes,
      sortOrder: typeof row.sortOrder === 'number' ? row.sortOrder : Number(row.sortOrder ?? 0),
      status: row.status === 'inactive' ? 'inactive' : 'active',
    }
  })
}

async function main(): Promise<void> {
  const file = argValue('--file') ?? path.resolve(process.cwd(), 'expense-mappings.json')
  const rows = parseRows(JSON.parse(readFileSync(file, 'utf8')))

  const existingCodes = new Set(
    (await prisma.expenseSubjectMapping.findMany({ select: { code: true } })).map((m) => m.code),
  )
  let created = 0
  let updated = 0
  for (const r of rows) {
    await prisma.expenseSubjectMapping.upsert({
      where: { code: r.code },
      update: {
        name: r.name,
        subjectCodes: r.subjectCodes,
        sortOrder: r.sortOrder,
        status: r.status,
        deletedAt: null, // 墓碑行导入即复活（恢复配置语义）
      },
      create: {
        code: r.code,
        name: r.name,
        subjectCodes: r.subjectCodes,
        sortOrder: r.sortOrder,
        status: r.status,
      },
    })
    if (existingCodes.has(r.code)) updated++
    else created++
    console.log(`  ${r.code}  ${r.name}  (${r.subjectCodes.length} 科目, sort=${r.sortOrder}, ${r.status})`)
  }
  console.log(`[import] 完成：新增 ${created} 条，更新 ${updated} 条（含墓碑复活） <- ${file}`)
}

main()
  .catch((e) => {
    console.error('[import] 失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
