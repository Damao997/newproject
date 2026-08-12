import type { UserRole } from '@/types'

/**
 * 前端权限矩阵
 *
 * 依据《安全与权限规范》§2.2 权限矩阵 与 §2.3 Resource 三段式编码清单，
 * 按角色静态推导每个角色拥有的权限码集合。
 *
 * 权限码格式与规范 §2.3 一致：
 *   - 两段式：`{module}:{action}`，如 `indicators:export`
 *   - 三段式：`{module}:{page}:{action}`，如 `data:import:upload`、`admin:users:create`
 *
 * 说明：后端就绪后应改为使用登录接口返回的权限列表，届时本文件仅作兜底。
 */

/** 管理员拥有的全部常规权限码（对齐 §2.3，去除公开路由 auth:login 与高危码；权限配置编辑已收紧为 superadmin 专属） */
const ADMIN_PERMISSIONS: string[] = [
  'dashboard:view', 'dashboard:export',
  'indicators:view', 'indicators:export',
  'transactions:view', 'transactions:create', 'transactions:update', 'transactions:delete', 'transactions:import', 'transactions:export',
  'inventory:view', 'inventory:create', 'inventory:update', 'inventory:delete', 'inventory:import', 'inventory:export',
  'reports:view', 'reports:create', 'reports:update', 'reports:delete', 'reports:export',
  'data:browse:view', 'data:import:upload',
  'data:metric:create', 'data:metric:update', 'data:metric:delete',
  'data:company:create', 'data:company:update', 'data:company:delete',
  'data:subject:create', 'data:subject:update', 'data:subject:delete',
  'data:reclassify:company', 'data:reclassify:subject',
  'data:export',
  'tools:view',
  'admin:users:view', 'admin:users:create', 'admin:users:update', 'admin:users:delete', 'admin:users:reset-password', 'admin:users:export',
  'admin:roles:view', 'admin:roles:create', 'admin:roles:update', 'admin:roles:delete',
  'admin:permissions:view',
]

/**
 * 高危操作权限码：仅超级管理员（superadmin）持有。
 * 含物理删除（purge）、指标审批、公式规则管理、批次归档/清除、权限配置编辑。
 */
export const HIGH_RISK_PERMISSIONS: string[] = [
  'data:metric:approve',
  'data:import:rollback',
  'data:import:archive',
  'data:import:purge',
  'data:company:purge',
  'data:subject:purge',
  'data:metric:purge',
  'data:metric:convert',
  'admin:users:purge',
  // 权限配置的增删改仅 superadmin 可操作（与 server/prisma/seed.ts 同步）
  'admin:permissions:update',
]

export const ROLE_PERMISSIONS: Record<UserRole, string[]> = {
  // 超级管理员：全部常规权限 + 全部高危操作
  superadmin: [...ADMIN_PERMISSIONS, ...HIGH_RISK_PERMISSIONS],

  // 管理员：全部模块常规操作（不含高危码）
  admin: ADMIN_PERMISSIONS,

  // 财务主管：财务数据查看/导入/导出 + 往来催收；不含权限管理、不含数据结构管理
  finance_manager: [
    'dashboard:view', 'dashboard:export',
    'indicators:view', 'indicators:export',
    'transactions:view', 'transactions:create', 'transactions:update', 'transactions:delete', 'transactions:import', 'transactions:export',
    'inventory:view', 'inventory:export',
    'reports:view', 'reports:create', 'reports:update', 'reports:export',
    'data:browse:view', 'data:import:upload', 'data:export',
    'data:reclassify:company', 'data:reclassify:subject',
    'tools:view',
  ],

  // 部门经理：看板/指标/往来/存货查看 + 导出 + 催收计划；不含导入/数据结构/权限管理
  department_manager: [
    'dashboard:view', 'dashboard:export',
    'indicators:view', 'indicators:export',
    'transactions:view', 'transactions:create', 'transactions:update', 'transactions:export',
    'inventory:view', 'inventory:export',
    'reports:view', 'reports:export',
    'data:browse:view',
    'tools:view',
  ],

  // 查看者：仅看板/指标/报告查看；无导出/无修改/无导入
  viewer: [
    'dashboard:view',
    'indicators:view',
    'reports:view',
  ],

  // 财务分析师（兼 IT）：财务分析全权限 + 数据结构管理 + IT 限定用户管理（不含角色/权限变更）
  finance_analyst_it: [
    'dashboard:view', 'dashboard:export',
    'indicators:view', 'indicators:export',
    'transactions:view', 'transactions:create', 'transactions:update', 'transactions:delete', 'transactions:import', 'transactions:export',
    'inventory:view', 'inventory:create', 'inventory:update', 'inventory:delete', 'inventory:import', 'inventory:export',
    'reports:view', 'reports:create', 'reports:update', 'reports:delete', 'reports:export',
    'data:browse:view', 'data:import:upload',
    'data:metric:create', 'data:metric:update', 'data:metric:delete',
    'data:company:create', 'data:company:update', 'data:company:delete',
    'data:subject:create', 'data:subject:update', 'data:subject:delete',
    'data:reclassify:company', 'data:reclassify:subject',
    'data:export',
    'tools:view',
    'admin:users:view', 'admin:users:create', 'admin:users:update', 'admin:users:delete', 'admin:users:reset-password', 'admin:users:export',
  ],
}

/**
 * 判断给定角色是否拥有对某资源执行某操作的权限。
 *
 * 权限码由 `resource` 与 `action` 拼接为 `${resource}:${action}`，
 * 与《安全与权限规范》§2.3 的三段式编码保持一致。
 *
 * @param role     用户角色
 * @param resource 资源编码（模块级或模块:子页面级），如 `indicators`、`data:import`、`admin:users`
 * @param action   操作类型，如 `view`、`export`、`create`、`upload`、`reset-password`
 * @returns 是否允许
 */
export function hasPermission(
  role: UserRole | undefined | null,
  resource: string,
  action: string,
): boolean {
  if (!role) return false
  const permissions = ROLE_PERMISSIONS[role]
  if (!permissions) return false
  return permissions.includes(`${resource}:${action}`)
}

/** 登录后默认首页优先级（依据《安全与权限规范》模块顺序；reports 优先于 transactions，
 *  与侧边栏 navItems 展示顺序不同，故显式声明而非依赖数组顺序） */
export const HOME_ROUTE_PRIORITY: ReadonlyArray<{ resource: string; path: string }> = [
  { resource: 'dashboard:view', path: '/dashboard' },
  { resource: 'indicators:view', path: '/indicators/operating' },
  { resource: 'reports:view', path: '/reports' },
  { resource: 'transactions:view', path: '/transactions/overview' },
  { resource: 'inventory:view', path: '/inventory' },
  { resource: 'data:browse:view', path: '/data/browse' },
  { resource: 'admin:users:view', path: '/admin/users' },
]

/** 权限感知首页解析：按优先级返回第一个有权限的模块路径；无匹配返回 null（调用方跳转 /no-access） */
export function resolveHomePath(permissions: string[] | undefined | null): string | null {
  if (!permissions || permissions.length === 0) return null
  for (const { resource, path } of HOME_ROUTE_PRIORITY) {
    if (permissions.includes(resource)) return path
  }
  return null
}
