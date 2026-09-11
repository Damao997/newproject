import { PrismaClient } from '@prisma/client'

/** 只读排查：列出已停用指标 + 最近的指标变更审计记录。用法：node --env-file=.env scripts/find-inactive-metrics.mjs */
const prisma = new PrismaClient()

try {
  const inactive = await prisma.metric.findMany({
    where: { status: 'inactive' },
    select: { code: true, name: true, dataType: true, formula: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  })
  console.log('=== 已停用指标（status=inactive） ===')
  for (const m of inactive) {
    console.log(`${m.code} | ${m.name} | dataType=${m.dataType} | formula=${m.formula ?? '(空)'} | 停用时间=${m.updatedAt.toISOString()}`)
  }
  if (inactive.length === 0) console.log('(无)')

  // 已停用指标的公式版本历史（恢复后可回滚找回公式）
  console.log('\n=== 已停用指标的公式版本历史 ===')
  for (const m of inactive) {
    const metric = await prisma.metric.findUnique({ where: { code: m.code }, select: { id: true } })
    const history = await prisma.metricDefinitionHistory.findMany({ where: { metricId: metric.id }, orderBy: { version: 'desc' } })
    console.log(`${m.code}（${m.name}）历史版本数：${history.length}`)
    for (const h of history) console.log(`  v${h.version} | ${h.formula || '(空)'} | ${h.description ?? ''}`)
  }

  const logs = await prisma.auditLog.findMany({
    where: { module: 'data', action: 'metric_change' },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: { targetId: true, detail: true, createdAt: true },
  })
  console.log('\n=== 最近 15 条指标变更审计 ===')
  for (const l of logs) {
    const d = l.detail ?? {}
    console.log(`${l.createdAt.toISOString()} | ${l.targetId} | ${JSON.stringify(d)}`)
  }
} finally {
  await prisma.$disconnect()
}
