import { PrismaClient } from '@prisma/client'

/** 校验：临时库校验流程未污染开发库，且无残留角色 */
const prisma = new PrismaClient()

async function main(): Promise<void> {
  const perm = await prisma.permission.count()
  const users = await prisma.user.count()
  const roles = await prisma.role.count()
  const leftoverRole = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_roles WHERE rolname = 'yipinhui_app'`,
  )
  const leftoverDb = await prisma.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n FROM pg_database WHERE datname = 'yipinhui_deploy_check'`,
  )
  const publicCreate = await prisma.$queryRawUnsafe<{ has: boolean }[]>(
    `SELECT has_schema_privilege('postgres', 'public', 'CREATE') AS has`,
  )

  console.log('dev permission rows =', perm)
  console.log('dev users =', users)
  console.log('dev roles =', roles)
  console.log('leftover yipinhui_app role =', leftoverRole[0]?.n)
  console.log('leftover scratch db =', leftoverDb[0]?.n)
  console.log('dev postgres CREATE on public =', publicCreate[0]?.has)
}

main()
  .catch((e) => {
    console.error('check failed:', e)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
