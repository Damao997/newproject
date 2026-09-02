import { z } from 'zod'

/**
 * Zod 校验 schema（前后端共享语义，校验逻辑收敛到后端单一实现）。
 * 命名与前端 web/src/types 的 LoginRequest / LoginResponse 对齐。
 */

export const loginSchema = z.object({
  username: z.string().trim().min(1, '用户名不能为空').max(64, '用户名过长'),
  password: z.string().min(1, '密码不能为空').max(128, '密码过长'),
  // 勾选后服务端签发「7 天内免登录」持久令牌；仅在登录成功且勾选时下发，缺省 false
  rememberMe: z.boolean().optional(),
})
export type LoginInput = z.infer<typeof loginSchema>

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken 不能为空'),
})
export type RefreshInput = z.infer<typeof refreshSchema>

export const autoLoginSchema = z.object({
  // 客户端持有的明文持久令牌；服务端 SHA-256 哈希后比对，不存明文
  persistentLoginToken: z.string().min(1, '持久令牌不能为空').max(128, '持久令牌过长'),
})
export type AutoLoginInput = z.infer<typeof autoLoginSchema>

export const updatePasswordSchema = z
  .object({
    oldPassword: z.string().min(1, '原密码不能为空').max(128),
    newPassword: z
      .string()
      .min(8, '新密码至少 8 位')
      .max(128, '新密码过长')
      .regex(/[A-Za-z]/, '新密码需包含字母')
      .regex(/[0-9]/, '新密码需包含数字'),
  })
  .refine((data) => data.oldPassword !== data.newPassword, {
    message: '新密码不能与原密码相同',
    path: ['newPassword'],
  })
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>

/**
 * 角色权限批量替换入参。
 * action 必须落在 PermissionAction 枚举内 —— 与 schema.prisma 的枚举、
 * prisma/seed.ts 的 PERMISSIONS 三处保持同一值域。
 * 无此校验时非法 action 会直达 createMany，由 PG 抛 22P02 变成 500；
 * 此处前置拦截，改为语义清晰的 400。
 */
export const permissionActionSchema = z.enum([
  'view',
  'create',
  'update',
  'delete',
  'export',
  'import',
  'approve',
])

export const updateRolePermissionsSchema = z.object({
  permissions: z
    .array(
      z.object({
        resource: z
          .string()
          .trim()
          .min(1, 'resource 不能为空')
          .max(128, 'resource 过长')
          // 二/三段式资源码：模块:子页面[:操作]，仅允许小写字母/数字/连字符 + 冒号分隔。
          // 至少两段 —— seed.ts 中全部资源码均含冒号（如 dashboard:view、data:import:upload），
          // 单段式（仅模块名）不是有效权限码，放行会产生永不命中的死权限。
          .regex(/^[a-z0-9-]+(:[a-z0-9-]+){1,2}$/, 'resource 必须为冒号分隔的二/三段式小写编码'),
        action: permissionActionSchema,
      }),
    )
    .max(500, '权限条目过多'),
})
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>

/** 批量覆盖多角色权限：roleIds 至少 1 个、至多 50 个；permissions 校验规则与单角色一致 */
export const updateRolePermissionsBatchSchema = z.object({
  roleIds: z.array(z.string().uuid('无效的角色 ID')).min(1, '至少选择一个角色').max(50, '一次最多操作 50 个角色'),
  permissions: updateRolePermissionsSchema.shape.permissions,
})
export type UpdateRolePermissionsBatchInput = z.infer<typeof updateRolePermissionsBatchSchema>
