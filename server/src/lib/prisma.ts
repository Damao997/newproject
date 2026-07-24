import { PrismaClient } from '@prisma/client'
import { applyScope } from '../middleware/scope'
import { applySoftDelete } from '../middleware/soft-delete'

/**
 * PrismaClient 单例 + 扩展装配点。
 * - softDelete 扩展：查询自动追加 status='active' 过滤。
 * - scope 扩展点：数据范围过滤在业务模块按需通过 forUser() 派生带范围的客户端。
 *
 * 注意：softDelete 为全局默认扩展；scope 与请求上下文相关，
 * 因此不在此处全局注入，而是由请求作用域调用 prismaForUser() 派生。
 */
const basePrisma = new PrismaClient()

// 全局装配软删除过滤（对所有查询生效）
export const prisma = applySoftDelete(basePrisma)

export type ExtendedPrisma = typeof prisma

/**
 * 依据当前用户数据范围派生带 scope 过滤的 Prisma 客户端。
 * 业务模块（dashboard/indicators/data 等）在读取事实/业务数据时使用。
 */
export function prismaForUser(scope: Parameters<typeof applyScope>[1]) {
  return applyScope(prisma, scope)
}

export { basePrisma }
