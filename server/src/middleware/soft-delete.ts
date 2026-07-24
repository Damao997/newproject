import type { PrismaClient } from '@prisma/client'

/**
 * 软删除过滤 —— Prisma 扩展。
 * 对带 status 字段的模型，读操作自动追加 status='active'（见 docs/references/db.md）。
 * 调用方显式传入 status 时以调用方为准（如后台需查看 inactive）。
 */

// 带 status（RecordStatus）字段的模型（Prisma 模型名）
const STATUS_MODELS = new Set<string>([
  'Company',
  'AccountSubject',
  'Counterparty',
  'User',
  'Role',
  'Metric',
  'SubjectAnalysis',
])

const READ_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

export function hasStatusFilter(where: unknown): boolean {
  if (!where || typeof where !== 'object') return false
  const w = where as Record<string, unknown>
  if ('status' in w) return true
  // 组合条件中已显式声明 status 也视为调用方接管
  for (const key of ['AND', 'OR', 'NOT'] as const) {
    const branch = w[key]
    if (Array.isArray(branch) && branch.some((b) => hasStatusFilter(b))) return true
    if (branch && typeof branch === 'object' && hasStatusFilter(branch)) return true
  }
  return false
}

/**
 * 纯函数：依据模型/操作/既有 where 计算注入软删除过滤后的 where。
 * 抽出以便单测，同时供扩展复用。
 */
export function applyActiveWhere(model: string, operation: string, where: unknown): unknown {
  if (STATUS_MODELS.has(model) && READ_OPERATIONS.has(operation) && !hasStatusFilter(where)) {
    return { ...((where as Record<string, unknown>) ?? {}), status: 'active' }
  }
  return where
}

export function applySoftDelete<T extends PrismaClient>(client: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).$extends({
    name: 'softDelete',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          args.where = applyActiveWhere(model, operation, args.where)
          return query(args)
        },
      },
    },
  }) as T
}
