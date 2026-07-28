import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { seedDomain } from './seed-domain'
import { seedCompaniesAndMapping } from './seed-companies'

// ============================================================
// 种子数据：预置角色 + 完整权限矩阵 + 公司主体 + 演示用户
// 依据 CLAUDE.md 附录 C（8 模块 × 6 操作 × 5 角色）与数据模型规范 §2.4 / §7.2。
// 幂等：所有写入按唯一键 upsert，可重复执行。
// ============================================================

const prisma = new PrismaClient()

// ---- 权限主清单：resource（三段式）→ action（6 操作枚举）----
const PERMISSIONS: { resource: string; action: string }[] = [
  // 首页看板
  { resource: 'dashboard:view', action: 'view' },
  { resource: 'dashboard:export', action: 'export' },
  // 财务指标
  { resource: 'indicators:view', action: 'view' },
  { resource: 'indicators:export', action: 'export' },
  // 往来分析
  { resource: 'transactions:view', action: 'view' },
  { resource: 'transactions:create', action: 'create' },
  { resource: 'transactions:update', action: 'update' },
  { resource: 'transactions:delete', action: 'delete' },
  { resource: 'transactions:import', action: 'import' },
  { resource: 'transactions:export', action: 'export' },
  // 存货管理
  { resource: 'inventory:view', action: 'view' },
  { resource: 'inventory:create', action: 'create' },
  { resource: 'inventory:update', action: 'update' },
  { resource: 'inventory:delete', action: 'delete' },
  { resource: 'inventory:import', action: 'import' },
  { resource: 'inventory:export', action: 'export' },
  // 分析报告
  { resource: 'reports:view', action: 'view' },
  { resource: 'reports:create', action: 'create' },
  { resource: 'reports:update', action: 'update' },
  { resource: 'reports:delete', action: 'delete' },
  { resource: 'reports:export', action: 'export' },
  // 数据管理
  { resource: 'data:browse:view', action: 'view' },
  { resource: 'data:import:upload', action: 'import' },
  { resource: 'data:metric:create', action: 'create' },
  { resource: 'data:metric:update', action: 'update' },
  { resource: 'data:metric:delete', action: 'delete' },
  { resource: 'data:company:create', action: 'create' },
  { resource: 'data:company:update', action: 'update' },
  { resource: 'data:company:delete', action: 'delete' },
  { resource: 'data:subject:create', action: 'create' },
  { resource: 'data:subject:update', action: 'update' },
  { resource: 'data:subject:delete', action: 'delete' },
  { resource: 'data:reclassify:company', action: 'update' },
  { resource: 'data:reclassify:subject', action: 'update' },
  { resource: 'data:export', action: 'export' },
  // 数据管理（高危操作，仅 superadmin）
  { resource: 'data:metric:approve', action: 'approve' },
  { resource: 'data:formula-rule:manage', action: 'manage' },
  { resource: 'data:import:archive', action: 'import' },
  { resource: 'data:import:purge', action: 'delete' },
  { resource: 'data:company:purge', action: 'delete' },
  { resource: 'data:subject:purge', action: 'delete' },
  { resource: 'data:metric:purge', action: 'delete' },
  // 其他工具
  { resource: 'tools:view', action: 'view' },
  // 权限管理
  { resource: 'admin:users:view', action: 'view' },
  { resource: 'admin:users:create', action: 'create' },
  { resource: 'admin:users:update', action: 'update' },
  { resource: 'admin:users:delete', action: 'delete' },
  { resource: 'admin:users:reset-password', action: 'update' },
  { resource: 'admin:users:export', action: 'export' },
  { resource: 'admin:roles:view', action: 'view' },
  { resource: 'admin:roles:create', action: 'create' },
  { resource: 'admin:roles:update', action: 'update' },
  { resource: 'admin:roles:delete', action: 'delete' },
  { resource: 'admin:permissions:view', action: 'view' },
  { resource: 'admin:permissions:update', action: 'update' },
  // 权限管理（高危操作，仅 superadmin）
  { resource: 'admin:users:purge', action: 'delete' },
]

const ALL_RESOURCES = PERMISSIONS.map((p) => p.resource)

// ---- 高危操作权限码：仅授予 superadmin，admin 及其他角色一律排除 ----
const HIGH_RISK_RESOURCES = [
  'data:metric:approve',
  'data:formula-rule:manage',
  'data:import:archive',
  'data:import:purge',
  'data:company:purge',
  'data:subject:purge',
  'data:metric:purge',
  'admin:users:purge',
  // 权限配置的增删改仅 superadmin 可操作（数据驱动收紧，不硬编码角色名）
  'admin:permissions:update',
]

/** superadmin：全量（含高危码） */
const SUPERADMIN_GRANTS = ALL_RESOURCES

/** admin：全部常规权限，不含高危码 */
const ADMIN_GRANTS = ALL_RESOURCES.filter((r) => !HIGH_RISK_RESOURCES.includes(r))

// ---- 各角色授予的 resource 集合（依据附录 C 权限矩阵）----
const FINANCE_MANAGER_GRANTS = [
  'dashboard:view', 'dashboard:export',
  'indicators:view', 'indicators:export',
  'transactions:view', 'transactions:create', 'transactions:update',
  'transactions:delete', 'transactions:import', 'transactions:export',
  'inventory:view', 'inventory:export',
  'reports:view', 'reports:create', 'reports:update', 'reports:export',
  'data:browse:view', 'data:import:upload', 'data:export',
  'data:reclassify:company', 'data:reclassify:subject',
  'tools:view',
]

const DEPARTMENT_MANAGER_GRANTS = [
  'dashboard:view', 'dashboard:export',
  'indicators:view', 'indicators:export',
  'transactions:view', 'transactions:create', 'transactions:update', 'transactions:export',
  'inventory:view', 'inventory:export',
  'reports:view', 'reports:export',
  'data:browse:view',
  'tools:view',
]

const VIEWER_GRANTS = [
  'dashboard:view',
  'indicators:view',
  'reports:view',
]

// 财务分析师兼IT：财务分析全权限 + 权限管理仅 users（不含 roles/permissions/高危码）
const ANALYST_IT_GRANTS = ALL_RESOURCES.filter(
  (r) => !r.startsWith('admin:roles') && !r.startsWith('admin:permissions') && !HIGH_RISK_RESOURCES.includes(r),
)

interface RoleSeed {
  code: string
  name: string
  description: string
  scopeValue: string
  grants: string[]
}

const ROLES: RoleSeed[] = [
  { code: 'superadmin', name: '超级管理员', description: '最高权限管理员，含物理删除/审批等高危操作，全部公司', scopeValue: '*', grants: SUPERADMIN_GRANTS },
  { code: 'admin', name: '管理员', description: '系统全权管理员，全部公司', scopeValue: '*', grants: ADMIN_GRANTS },
  { code: 'finance_manager', name: '财务主管', description: '财务数据管理+分析；不含权限管理与数据结构管理', scopeValue: '', grants: FINANCE_MANAGER_GRANTS },
  { code: 'department_manager', name: '部门经理', description: '仅本事业部；看板/指标/往来/存货查看导出+催收计划', scopeValue: '', grants: DEPARTMENT_MANAGER_GRANTS },
  { code: 'viewer', name: '查看者', description: '仅看板/指标/报告查看；无导出/修改/导入', scopeValue: '', grants: VIEWER_GRANTS },
  { code: 'finance_analyst_it', name: '财务分析师(兼IT)', description: '财务分析全权限 + 用户管理（不含角色/权限变更）', scopeValue: '*', grants: ANALYST_IT_GRANTS },
]

// ---- 公司主数据：由 seed-companies.ts 从《分析主体及汇总映射.xlsx》导入（EN 单体 + ET 汇总 + 聚合映射）----

// ---- 演示用户（每角色一个）----
interface UserSeed {
  username: string
  displayName: string
  roleCode: string
  companyCode?: string
}

const USERS: UserSeed[] = [
  { username: 'superadmin', displayName: '超级管理员', roleCode: 'superadmin' },
  { username: 'admin', displayName: '系统管理员', roleCode: 'admin' },
  { username: 'finance.manager', displayName: '财务主管-张三', roleCode: 'finance_manager', companyCode: 'EN330059' },
  { username: 'dept.manager', displayName: '部门经理-李四', roleCode: 'department_manager', companyCode: 'EN330059' },
  { username: 'viewer', displayName: '查看者-王五', roleCode: 'viewer', companyCode: 'EN330058' },
  { username: 'analyst.it', displayName: '财务分析师-赵六', roleCode: 'finance_analyst_it' },
]

async function main(): Promise<void> {
  const defaultPassword = process.env.SEED_DEFAULT_PASSWORD || 'Yipinhui@2026'
  const bcryptCost = Number(process.env.BCRYPT_COST || 12)

  console.log('[seed] 开始种子数据写入...')

  // 1) 公司主体 + 汇总映射（从映射 Excel 导入）
  await seedCompaniesAndMapping(prisma)

  // 2) 角色 + 权限（预置角色 is_system=true 锁定）
  for (const r of ROLES) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { name: r.name, description: r.description, scopeValue: r.scopeValue, isSystem: true },
      create: { code: r.code, name: r.name, description: r.description, scopeValue: r.scopeValue, isSystem: true },
    })

    // 权限差量同步：删除多余，写入缺失（保持幂等且贴合矩阵）
    const wanted = new Set(r.grants)
    const existing = await prisma.permission.findMany({ where: { roleId: role.id } })
    const existingSet = new Set(existing.map((p) => p.resource))

    // 删除不再授予的
    const toRemove = existing.filter((p) => !wanted.has(p.resource))
    if (toRemove.length > 0) {
      await prisma.permission.deleteMany({ where: { id: { in: toRemove.map((p) => p.id) } } })
    }

    // 写入缺失的
    for (const resource of r.grants) {
      if (existingSet.has(resource)) continue
      const def = PERMISSIONS.find((p) => p.resource === resource)
      if (!def) {
        console.warn(`[seed] 未在权限主清单中找到 resource=${resource}，跳过`)
        continue
      }
      await prisma.permission.create({
        data: { roleId: role.id, resource: def.resource, action: def.action },
      })
    }
    console.log(`[seed] 角色 ${r.code} 权限 ${r.grants.length} 条 完成`)
  }

  // 3) 演示用户（密码 bcrypt 哈希）
  const passwordHash = await bcrypt.hash(defaultPassword, bcryptCost)
  for (const u of USERS) {
    const role = await prisma.role.findUnique({ where: { code: u.roleCode } })
    if (!role) throw new Error(`角色不存在：${u.roleCode}`)
    await prisma.user.upsert({
      where: { username: u.username },
      update: {
        displayName: u.displayName,
        roleId: role.id,
        companyCode: u.companyCode ?? null,
      },
      create: {
        username: u.username,
        displayName: u.displayName,
        passwordHash,
        roleId: role.id,
        companyCode: u.companyCode ?? null,
      },
    })
  }
  console.log(`[seed] 演示用户 ${USERS.length} 个 完成`)
  console.log(`[seed] 演示用户初始口令（仅本地开发）：${defaultPassword}`)

  // 4) 领域数据：期间维度 / 科目 / 指标 / 事实
  await seedDomain(prisma)

  console.log('[seed] 全部完成 ✓')
}

main()
  .catch((e) => {
    console.error('[seed] 失败：', e)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
