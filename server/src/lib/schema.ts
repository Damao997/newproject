import { z } from 'zod'

/**
 * Zod 校验 schema（前后端共享语义，校验逻辑收敛到后端单一实现）。
 * 命名与前端 web/src/types 的 LoginRequest / LoginResponse 对齐。
 */

export const loginSchema = z.object({
  username: z.string().trim().min(1, '用户名不能为空').max(64, '用户名过长'),
  password: z.string().min(1, '密码不能为空').max(128, '密码过长'),
})
export type LoginInput = z.infer<typeof loginSchema>

export const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'refreshToken 不能为空'),
})
export type RefreshInput = z.infer<typeof refreshSchema>

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
