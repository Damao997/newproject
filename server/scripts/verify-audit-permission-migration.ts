import { PrismaClient } from '@prisma/client'

/**
 * 迁移后核验（B3 + B5）：
 *  1. audit_log.user_agent 列存在且为 varchar(512) 可空
 *  2. permission.action 已是 PermissionAction 枚举，且枚举含 7 个值
 *  3. permission 存量行未丢失，action 分布正常
 *  4. 非法 action 写入被库级拒绝
 */
const prisma = new PrismaClient()

async function main(): Promise<void> {
  const uaCol = await prisma.$queryRawUnsafe<{ data_type: string; character_maximum_length: number | null; is_nullable: string }[]>(
    `SELECT data_type, character_maximum_length, is_nullable
       FROM information_schema.columns
      WHERE table_name = 'audit_log' AND column_name = 'user_agent'`,
  )
  console.log('[1] audit_log.user_agent =', JSON.stringify(uaCol))

  const actionCol = await prisma.$queryRawUnsafe<{ data_type: string; udt_name: string }[]>(
    `SELECT data_type, udt_name
       FROM information_schema.columns
      WHERE table_name = 'permission' AND column_name = 'action'`,
  )
  console.log('[2a] permission.action =', JSON.stringify(actionCol))

  const enumVals = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT e.enumlabel FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'PermissionAction'
      ORDER BY e.enumsortorder`,
  )
  console.log('[2b] PermissionAction values =', enumVals.map((r) => r.enumlabel).join(','))

  const total = await prisma.permission.count()
  const grouped = await prisma.permission.groupBy({ by: ['action'], _count: { action: true } })
  console.log('[3] permission rows =', total)
  console.log('[3] action distribution =', grouped.map((g) => `${g.action}:${g._count.action}`).join(' '))

  const roleCount = await prisma.role.count()
  console.log('[3] roles =', roleCount)

  // 非法 action 必须被库级拒绝
  const anyRole = await prisma.role.findFirst({ select: { id: true } })
  if (anyRole) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "permission" (id, role_id, resource, action) VALUES (gen_random_uuid(), '${anyRole.id}', '__probe__', 'viewx')`,
      )
      console.log('[4] FAIL: 非法 action 竟被接受')
    } catch (e) {
      console.log('[4] OK: 非法 action 被库级拒绝 ->', (e as Error).message.split('\n')[0].slice(0, 90))
    }
  }

  const uaSample = await prisma.auditLog.findFirst({
    where: { userAgent: { not: null } },
    select: { module: true, action: true, ip: true, userAgent: true },
    orderBy: { createdAt: 'desc' },
  })
  console.log('[5] 最近一条带 UA 的审计 =', uaSample ? JSON.stringify(uaSample) : '（尚无，需登录后产生）')
}

main()
  .catch((e) => {
    console.error('核验失败:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
