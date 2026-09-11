import { prisma } from '../src/lib/prisma'
import { recordAudit } from '../src/middleware/audit'

/**
 * 一次性数据修复：费用类新增科目 order_no=0 导致科目树排序错乱。
 * 根因：DataService.createSubject 曾不写入 orderNo（落库默认 0），「研发费用」（OP_0501010118）与
 * 「仓储及配送费用」（OP_0501010119）按 orderNo 升序渲染时被排到「付现运营费用」最前。
 * 本脚本按编码序（数据模型规范 §3.2 编码即树序）将两科目插入正确位置（104/105），
 * 并顺延后续 order_no≥104 科目 +2（非付现运营费用 104→106、折旧摊销 105→107、财务费用 106→108）；
 * 幂等可重跑，变更走审计通道留痕（与 fix-subject-value-type.ts 同标准）。
 */
async function main() {
  const targets = [
    { code: 'OP_0501010118', name: '研发费用', expectOrderNo: 104 },
    { code: 'OP_0501010119', name: '仓储及配送费用', expectOrderNo: 105 },
  ]
  const codes = targets.map((t) => t.code)
  const before = await prisma.accountSubject.findMany({ where: { code: { in: codes } }, select: { code: true, name: true, orderNo: true } })
  const beforeByCode = new Map(before.map((r) => [r.code, r.orderNo]))
  // 幂等：目标科目已到位则跳过
  if (targets.every((t) => beforeByCode.get(t.code) === t.expectOrderNo)) {
    console.log(`已修复过（${targets.map((t) => `${t.name}=${t.expectOrderNo}`).join(' / ')}），跳过`)
    return
  }
  // 防护：其他 order_no=0 科目不在本脚本处理范围（仅告警）
  const others = await prisma.accountSubject.findMany({ where: { orderNo: 0, code: { notIn: codes } }, select: { code: true, name: true } })
  if (others.length > 0) console.warn(`警告：仍存在其他 order_no=0 科目：${others.map((o) => `${o.code}（${o.name}）`).join('、')}，请确认是否需要另行处理`)
  // superadmin 作为审计操作者（recordAudit 需 ctx.userId）
  const admin = await prisma.user.findFirst({
    where: { status: 'active', role: { code: 'superadmin' } },
    select: { id: true, username: true },
  })
  if (!admin) throw new Error('未找到 superadmin 用户，无法执行审计写入')

  const shifted = await prisma.$transaction(async (tx) => {
    // 顺延：order_no≥104 且非目标科目 → +2
    const r = await tx.accountSubject.updateMany({
      where: { orderNo: { gte: 104 }, code: { notIn: codes } },
      data: { orderNo: { increment: 2 } },
    })
    for (const t of targets) {
      await tx.accountSubject.update({ where: { code: t.code }, data: { orderNo: t.expectOrderNo } })
    }
    return r.count
  })

  await recordAudit(
    {
      userId: admin.id,
      module: 'data',
      action: 'subject_change',
      targetId: codes.join(','),
      detail: {
        entity: 'subject_order',
        before: Object.fromEntries(before.map((r) => [r.code, r.orderNo])),
        after: Object.fromEntries(targets.map((t) => [t.code, t.expectOrderNo])),
        shifted,
      },
    },
    'fix-expense-subject-order',
  )
  console.log(`已修复：${targets.map((t) => `${t.code}（${t.name}）order_no ${beforeByCode.get(t.code)} → ${t.expectOrderNo}`).join('；')}；顺延 ${shifted} 条（审计已记录，操作者 ${admin.username}）`)
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
