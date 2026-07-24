import type { PrismaClient } from '@prisma/client'
import type { AuthUserContext } from '../types/express'

/**
 * 数据范围（scope）过滤 —— Prisma 扩展。
 * 三优先级（见 docs/references/security.md）：
 *   1. user.company_code 非空 → 精确绑定单体公司
 *   2. company_code 空且 org_scope_bu 非空 → BU 映射的公司集合
 *   3. 两者皆空且 role.scope_value='*' → 全量
 *   兜底：无范围 → none（空结果，默认拒绝，防越权）
 *
 * 禁止硬编码 if(role==='admin')，统一通过 scope_value='*' 判定全量。
 */

export type DataScope =
  | { type: 'all' }
  | { type: 'companies'; companyCodes: string[] }
  | { type: 'none' }

// 含 company_code 维度、需按数据范围过滤的模型（Prisma 模型名）
const SCOPED_MODELS = new Set<string>([
  'FactOperating',
  'FactStatic',
  'FactBudget',
  'TransactionDetail',
  'AgingRecord',
  'CollectionPlan',
  'InventoryRecord',
  'Counterparty',
])

const READ_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

export function buildScopeWhere(scope: DataScope): Record<string, unknown> | null {
  switch (scope.type) {
    case 'all':
      return null
    case 'companies':
      return { companyCode: { in: scope.companyCodes } }
    case 'none':
      // 空集合 → 不返回任何行
      return { companyCode: { in: [] as string[] } }
  }
}

/**
 * 纯函数：依据模型/操作/数据范围计算注入 scope 过滤后的 where。
 */
export function applyScopeWhere(
  model: string,
  operation: string,
  where: unknown,
  scope: DataScope,
): unknown {
  const scopeWhere = buildScopeWhere(scope)
  if (scopeWhere && SCOPED_MODELS.has(model) && READ_OPERATIONS.has(operation)) {
    return { AND: [where ?? {}, scopeWhere] }
  }
  return where
}

/**
 * 依据数据范围派生带 scope 过滤的 Prisma 客户端。
 * 对 SCOPED_MODELS 的读操作自动追加 companyCode 过滤（与既有 where 合并）。
 */
export function applyScope<T extends PrismaClient | { $extends: unknown }>(client: T, scope: DataScope): T {
  const scopeWhere = buildScopeWhere(scope)
  // scope=all 不需要注入过滤，直接返回原客户端
  if (scopeWhere === null) return client

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).$extends({
    name: 'scope',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          args.where = applyScopeWhere(model, operation, args.where, scope)
          return query(args)
        },
      },
    },
  }) as T
}

/**
 * 依据当前用户上下文解析数据范围。
 * 需要读取 company.business_unit 完成 org_scope_bu → company_code 映射。
 */
export async function resolveScope(
  client: Pick<PrismaClient, 'company'>,
  authUser: Pick<AuthUserContext, 'companyCode' | 'orgScopeBu' | 'scopeValue'>,
): Promise<DataScope> {
  // 优先级 1：精确绑定单体公司
  if (authUser.companyCode) {
    return { type: 'companies', companyCodes: [authUser.companyCode] }
  }

  // 优先级 2：事业部范围映射
  if (authUser.orgScopeBu && authUser.orgScopeBu.length > 0) {
    const companies = await client.company.findMany({
      where: { businessUnit: { in: authUser.orgScopeBu }, status: 'active' },
      select: { code: true },
    })
    return { type: 'companies', companyCodes: companies.map((c) => c.code) }
  }

  // 优先级 3：角色全量
  if (authUser.scopeValue === '*') {
    return { type: 'all' }
  }

  // 兜底：无范围
  return { type: 'none' }
}
