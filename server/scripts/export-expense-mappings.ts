/* eslint-disable no-console */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * 导出运营费用映射配置（expense_subject_mapping 全量，不含墓碑行）为 JSON 文件。
 *
 * 用途：数据库全量重置（删除 server/.pgdata 或 migrate dev 漂移重置）前备份映射配置，
 * 重置完成并重新 seed 后由 import-expense-mappings.ts 恢复，自定义映射/归并/停用/排序不丢失。
 *
 * 用法（server 目录下）：
 *   npm run mapping:export                      # 默认输出 ./expense-mappings-<YYYYMMDD>.json
 *   npx tsx scripts/export-expense-mappings.ts --out <path>
 */
const prisma = new PrismaClient()

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}

interface MappingExportRow {
  code: string
  name: string
  subjectCodes: string[]
  sortOrder: number
  status: 'active' | 'inactive'
}

async function main(): Promise<void> {
  const out = argValue('--out')
    ?? path.resolve(process.cwd(), `expense-mappings-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.json`)

  const rows = await prisma.expenseSubjectMapping.findMany({
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
  })

  const data: MappingExportRow[] = rows.map((r) => ({
    code: r.code,
    name: r.name,
    subjectCodes: [...r.subjectCodes],
    sortOrder: r.sortOrder,
    status: r.status === 'inactive' ? 'inactive' : 'active',
  }))

  writeFileSync(out, JSON.stringify(data, null, 2), 'utf8')
  console.log(`[export] 运营费用映射 ${data.length} 条 已导出 -> ${out}`)
  for (const m of data) {
    console.log(`  ${m.code}  ${m.name}  (${m.subjectCodes.length} 科目, sort=${m.sortOrder}, ${m.status})`)
  }
}

main()
  .catch((e) => {
    console.error('[export] 失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
