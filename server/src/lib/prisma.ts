import { PrismaClient } from '@prisma/client'
import { applyScope, applyScopeFromContext } from '../middleware/scope'
import { applySoftDelete } from '../middleware/soft-delete'

/**
 * PrismaClient 单例 + 扩展装配点。
 * - softDelete 扩展：查询自动追加 status='active' 过滤。
 * - scopeContext 扩展：按请求上下文（ALS）自动追加 companyCode 数据范围过滤。
 *
 * scope 与请求相关，但由 attachScope 中间件写入 AsyncLocalStorage 后由扩展读取，
 * 因此可全局装配而无需逐个 service 透传客户端。
 * 无请求上下文（seed / scripts / 单测）时 scopeContext 不注入任何过滤。
 */
const basePrisma = new PrismaClient()

// 全局装配软删除 + 请求级数据范围过滤（对所有查询生效）
export const prisma = applyScopeFromContext(applySoftDelete(basePrisma))

export type ExtendedPrisma = typeof prisma

/**
 * 依据显式数据范围派生带 scope 过滤的 Prisma 客户端。
 * 常规请求链路无需调用（已由 scopeContext 扩展覆盖）；
 * 保留用于脚本或需绕开请求上下文显式指定范围的场景。
 */
export function prismaForUser(scope: Parameters<typeof applyScope>[1]) {
  return applyScope(prisma, scope)
}

export { basePrisma }
