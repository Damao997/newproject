/* eslint-disable no-console */
import { basePrisma } from '../src/lib/prisma'
import { recordAudit } from '../src/middleware/audit'

/**
 * 一次性转换：静态科目总资产/总负债/权益净资产（BS01/BS02/BS03）由计算类改为数据类。
 * 依据：这三项为资产负债表直填科目，应为数据类（静态导入模板仅包含数据类科目行）。
 *
 * 说明：不走 DataService.convertMetricType —— calc→data 分支会被活跃公式引用
 * （资产负债率/ROA 引用总资产、ROE 引用权益净资产）拒绝；而公式引用数据类指标本为合法
 * （如 ROE 引用数据类「壹品慧净利润」），故此处直接转换并写审计留痕。
 * 三项均无存储公式（靠子级求和），无 formula 清理与历史版本问题；幂等可重跑。
 * 树聚合值不受影响（非叶节点恒为子级求和）；seed 重跑不会回写类型（metric upsert 更新分支不覆盖 dataType）。
 *
 * 用法：node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/convert-static-summary-to-data.ts [--dry-run]
 */
const DRY_RUN = process.argv.includes('--dry-run')

/** 目标科目：编码固定（段位表 BS01/BS02/BS03），名称校验防编码漂移 */
const TARGETS = [
  { code: 'BS01', name: '总资产' },
  { code: 'BS02', name: '总负债' },
  { code: 'BS03', name: '权益净资产' },
] as const

async function main() {
  const admin = await basePrisma.user.findFirst({
    where: { status: 'active', role: { code: 'superadmin' } },
    select: { id: true, username: true },
  })
  if (!admin) throw new Error('未找到 superadmin 用户，无法执行审计写入')

  const ctx = { userId: admin.id, traceId: 'convert-static-summary-to-data' }
  let changed = 0
  let skipped = 0
  for (const t of TARGETS) {
    const metric = await basePrisma.metric.findUnique({
      where: { code: t.code },
      select: { id: true, name: true, dataType: true, formula: true, dependsOn: true, status: true },
    })
    if (!metric) throw new Error(`${t.code} 无对应 metric，请先执行 seed 初始化科目体系`)
    if (metric.name !== t.name) throw new Error(`编码漂移：${t.code} 当前名称为「${metric.name}」，预期「${t.name}」，请人工确认`)
    if (metric.dataType === 'data') {
      skipped++
      console.log(`[skip] ${t.code} ${metric.name} 已是数据类`)
      continue
    }
    if (metric.dataType !== 'calc') {
      throw new Error(`${t.code} ${metric.name} 当前为 ${metric.dataType}（非 calc），请人工确认后处理`)
    }
    if (metric.formula) {
      throw new Error(`${t.code} ${metric.name} 残留公式「${metric.formula}」，与预期（无公式、靠子级求和）不符，请人工确认`)
    }
    console.log(`[${DRY_RUN ? 'dry-run' : 'convert'}] ${t.code} ${metric.name}: calc → data`)
    if (!DRY_RUN) {
      await basePrisma.metric.update({
        where: { code: t.code },
        data: { dataType: 'data', formula: null, dependsOn: [] },
      })
      await recordAudit({
        userId: admin.id,
        module: 'data',
        action: 'metric_change',
        targetId: t.code,
        detail: { action: 'convert', from: 'calc', to: 'data', before: null, after: null, reason: '资产负债表直填科目调整为数据类（一次性脚本）' },
      }, ctx.traceId)
      changed++
    }
  }
  console.log(DRY_RUN ? `dry-run 完成：待转换 ${TARGETS.length - skipped} 条，跳过 ${skipped} 条` : `转换完成：${changed} 条，跳过 ${skipped} 条`)
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => basePrisma.$disconnect())
