import { prisma } from '../src/lib/prisma'
import { recordAudit } from '../src/middleware/audit'

/**
 * 一次性数据修复：劳效比科目（OP_0702）值类型由 quantity 修正为 ratio。
 * 根因：种子 VALUE_TYPE_OVERRIDES 曾显式打标为 quantity，且 seed upsert 会重置，
 * 导致手动修改后重跑种子即跳变。本脚本仅对 quantity → ratio 单向修正（幂等），
 * 变更走审计通道留痕（与 fix-profit-leaf-metrics.ts 同标准）。
 */
async function main() {
  const target = await prisma.accountSubject.findUnique({ where: { code: 'OP_0702' }, select: { code: true, name: true, valueType: true } })
  if (!target) {
    console.log('OP_0702 不存在，跳过')
    return
  }
  if (target.valueType !== 'quantity') {
    console.log(`OP_0702 当前 valueType=${target.valueType}（非 quantity），无需修复`)
    return
  }
  // superadmin 作为审计操作者（recordAudit 需 ctx.userId）
  const admin = await prisma.user.findFirst({
    where: { status: 'active', role: { code: 'superadmin' } },
    select: { id: true, username: true },
  })
  if (!admin) throw new Error('未找到 superadmin 用户，无法执行审计写入')
  await prisma.accountSubject.update({ where: { code: 'OP_0702' }, data: { valueType: 'ratio' } })
  await recordAudit(
    {
      userId: admin.id,
      module: 'data',
      action: 'subject_change',
      targetId: 'OP_0702',
      detail: { before: { valueType: 'quantity' }, after: { valueType: 'ratio' } },
    },
    'fix-subject-value-type',
  )
  console.log(`已修复：OP_0702（${target.name}）valueType quantity → ratio（审计已记录，操作者 ${admin.username}）`)
}

main().catch((e) => { console.error('FAIL:', e.message); process.exit(1) })
