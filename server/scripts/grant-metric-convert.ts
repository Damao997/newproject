import { prisma } from '../src/lib/prisma'

/**
 * 一次性增量脚本：为 superadmin 角色补授高危权限码 data:metric:convert（指标类型转换）。
 * 与 prisma/seed.ts 的权限主清单保持一致；幂等（已存在则跳过）。
 * 用法：npx tsx scripts/grant-metric-convert.ts
 */
async function main(): Promise<void> {
  const role = await prisma.role.findUnique({ where: { code: 'superadmin' }, select: { id: true } })
  if (!role) {
    console.error('[grant] superadmin 角色不存在，请先执行 seed')
    process.exitCode = 1
    return
  }
  const exists = await prisma.permission.findFirst({ where: { roleId: role.id, resource: 'data:metric:convert' } })
  if (exists) {
    console.log('[grant] data:metric:convert 已存在，跳过')
    return
  }
  await prisma.permission.create({ data: { roleId: role.id, resource: 'data:metric:convert', action: 'update' } })
  console.log('[grant] 已为 superadmin 授予 data:metric:convert ✓')
}

main()
  .catch((e) => {
    console.error('[grant] 失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
