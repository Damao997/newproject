import { PrismaClient } from '@prisma/client'

/**
 * 一次性脚本：为 存货周转天数/应收账款周转天数 回填跨期间公式（与 seed-domain CALC_METRIC_FORMULA_DEFS 同口径）。
 * 幂等：按名称解析编码后覆盖写入 formula/dependsOn。用法：node --env-file=.env scripts/backfill-turnover-formulas.mjs
 */
const prisma = new PrismaClient()

const DEFS = [
  { name: '存货周转天数', refs: ['存货', '成本'], template: (c) => `({${c[0]}@YEAR_START} + {${c[0]}}) / 2 * {DAYS_YTD} / {${c[1]}@YTD_ACTUAL}` },
  { name: '应收账款周转天数', refs: ['应收账款', '收入'], template: (c) => `({${c[0]}@YEAR_START} + {${c[0]}}) / 2 * {DAYS_YTD} / {${c[1]}@YTD_ACTUAL}` },
]

try {
  const subjects = await prisma.accountSubject.findMany({ select: { code: true, name: true } })
  const nameToCode = new Map(subjects.map((s) => [s.name, s.code]))
  for (const def of DEFS) {
    const selfCode = nameToCode.get(def.name)
    const refs = def.refs.map((n) => nameToCode.get(n))
    if (!selfCode || refs.some((c) => !c)) {
      console.log(`[backfill] 跳过 ${def.name}：科目未解析`)
      continue
    }
    const formula = def.template(refs)
    const metric = await prisma.metric.findUnique({ where: { code: selfCode } })
    if (!metric || metric.dataType !== 'calc') {
      console.log(`[backfill] 跳过 ${def.name}：指标不存在或非计算类`)
      continue
    }
    await prisma.metric.update({ where: { code: selfCode }, data: { formula, dependsOn: refs } })
    console.log(`[backfill] ${selfCode} ${def.name} ← ${formula}（status=${metric.status}）`)
  }
  console.log('[backfill] 完成 ✓（inactive 指标需在公式维护页恢复启用后参与计算）')
} catch (e) {
  console.error('[backfill] 失败：', e)
  process.exitCode = 1
} finally {
  await prisma.$disconnect()
}
