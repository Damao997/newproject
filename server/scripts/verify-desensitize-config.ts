import { PrismaClient } from '@prisma/client'

const p = new PrismaClient()
async function main() {
  const rows = await p.aiDesensitizeConfig.findMany({
    select: { configType: true, pattern: true, enabled: true, priority: true },
    orderBy: { configType: 'asc' },
  })
  console.log(JSON.stringify(rows, null, 2))
}
main()
  .catch((e) => {
    console.error(e.message)
    process.exit(1)
  })
  .finally(() => p.$disconnect())
