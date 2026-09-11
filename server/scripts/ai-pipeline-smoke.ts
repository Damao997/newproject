import 'dotenv/config'
import { basePrisma, prisma } from '../src/lib/prisma'
import { AIProxyService } from '../src/services/AIProxyService'

/**
 * DeepSeek 全链路管道联调（本地手动运行）：
 *   cd server; npx tsx scripts/ai-pipeline-smoke.ts
 * 验证 AIProxyService.polishStream / analyzeStream 全链路：脱敏→chatStream→输出过滤→还原、真实指标事实注入。
 * 需 DB 运行且已 seed，且 server/.env 配置有效 DeepSeek key/模型。
 */

const SCOPE = { companyCode: null, scopeValue: '*' } as const

async function main(): Promise<void> {
  await basePrisma.$queryRaw`SELECT 1`
  const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
  const userId = admin?.id ?? 'smoke'
  const company = await prisma.company.findFirst({ where: { entityType: 'single', status: 'active' }, select: { code: true, name: true } })
  const subject = await prisma.accountSubject.findFirst({ where: { subjectType: 'operating', status: 'active' }, select: { code: true, name: true } })
  if (!company || !subject) {
    console.error('[pipeline] 缺少公司或科目 seed 数据，终止。')
    process.exit(1)
  }

  // ===== polish 管道 =====
  console.log('\n[pipeline] === polish（含公司名脱敏+还原）===')
  const polishInput = `${company.name}本月收入涨了不少，比去年多挺多。`
  console.log('[pipeline] 原文：', polishInput)
  process.stdout.write('[pipeline] 流式：')
  const polish = await AIProxyService.polishStream(
    { text: polishInput, style: 'formal', userId },
    (d) => process.stdout.write(d),
  )
  console.log('\n[pipeline] 最终(已还原公司名)：', polish.finalText)
  console.log('[pipeline] 公司名还原校验：', polish.finalText.includes(company.name) ? '包含真实公司名 ✅' : '未包含（LLM 可能改写措辞）')

  // ===== analyze 管道 =====
  console.log('\n[pipeline] === analyze（真实同比/达成率事实注入）===')
  console.log(`[pipeline] 目标：${company.name} / ${subject.name} / 2025-06`)
  process.stdout.write('[pipeline] 流式：')
  const analyze = await AIProxyService.analyzeStream(
    { scope: SCOPE, companyCode: company.code, subjectCode: subject.code, subjectType: 'operating', period: '2025-06', userId },
    (d) => process.stdout.write(d),
  )
  console.log('\n[pipeline] 最终：', analyze.finalText.slice(0, 200))
  console.log('[pipeline] 编码泄露校验：', /CO\d{6}|OP_\d{2}(?:\d{2})*|ET\d{4}/.test(analyze.finalText) ? '发现编码 ❌' : '无内部编码 ✅')

  console.log('\n[pipeline] 全链路联调完成 ✅')
}

main()
  .catch((err) => {
    console.error('[pipeline] 异常：', err instanceof Error ? err.message : err)
    process.exitCode = 2
  })
  .finally(async () => {
    await basePrisma.$disconnect().catch(() => undefined)
  })
