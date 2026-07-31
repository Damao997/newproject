import type { PrismaClient } from '@prisma/client'
import type { AuthUserContext } from '../types/express'
import { currentScope } from './scope-context'

/**
 * 数据范围（scope）过滤 —— Prisma 扩展。
 * 优先级（见 docs/references/security.md）：
 *   0. user.data_scope_codes 非空 → 多选范围（汇总主体展开为下属单体）
 *   1. user.company_code 非空 → 精确绑定单体公司
 *   2. user.org_scope_bu 非空 → 按事业部映射单体公司
 *   3. company_code 空且 role.scope_value='*' → 全量
 *   兜底：无范围 → none（空结果，默认拒绝，防越权）
 *
 * 禁止硬编码 if(role==='admin')，统一通过 scope_value='*' 判定全量。
 *
 * 汇总主体采用「全有或全无」授权：成员集非空且全部落在授权单体内才算授权，
 * 避免把「部分成员之和」当作汇总总额呈现（口径失真）。
 * companyCodes 只含单体编码，汇总主体编码单独放 summaryCodes —— 汇总值由成员求和得出，
 * 若把汇总编码一并注入事实表过滤，存在汇总层级数据时会重复计算。
 */

export type DataScope =
  | { type: 'all' }
  | { type: 'companies'; companyCodes: string[]; summaryCodes: string[] }
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
  'SubjectAnalysis',
])

/**
 * 需注入 scope 过滤的操作。
 * updateMany/deleteMany 接受任意 where，可安全注入；
 * update/delete/upsert 要求唯一 where，注入会破坏 Prisma 入参，改由写入路径显式校验。
 */
const READ_OPERATIONS = new Set<string>([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
  'deleteMany',
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
 * 显式派生用；请求链路统一走 applyScopeFromContext + attachScope。
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
 * 全局装配：按请求上下文（ALS）注入 scope 过滤。
 * 无 store 时不做任何改动 —— seed / scripts / 单测行为不变。
 */
export function applyScopeFromContext<T extends PrismaClient | { $extends: unknown }>(client: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (client as any).$extends({
    name: 'scopeContext',
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          const scope = currentScope()
          if (scope) args.where = applyScopeWhere(model, operation, args.where, scope)
          return query(args)
        },
      },
    },
  }) as T
}

type ScopeClient = Pick<PrismaClient, 'company' | 'companyAggregationMap'>

type ScopeUser = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & {
  orgScopeBu?: string[] | null
  dataScopeCodes?: string[] | null
}

/**
 * 「全有或全无」判定：返回成员集非空且全部落在 allowedSingles 内的汇总主体编码。
 * 使「直接分配汇总主体」与「其成员被完整分配」两种配置等价授权。
 */
async function authorizedSummaries(client: ScopeClient, allowedSingles: Set<string>): Promise<string[]> {
  const summaries = await client.company.findMany({
    where: { entityType: 'summary', status: 'active' },
    select: { code: true },
  })
  if (summaries.length === 0) return []
  const maps = await client.companyAggregationMap.findMany({
    where: { summaryCompanyCode: { in: summaries.map((s) => s.code) } },
    select: { summaryCompanyCode: true, singleCompanyCode: true },
  })
  const membersBySummary = new Map<string, string[]>()
  for (const m of maps) {
    const list = membersBySummary.get(m.summaryCompanyCode) ?? []
    list.push(m.singleCompanyCode)
    membersBySummary.set(m.summaryCompanyCode, list)
  }
  const authorized: string[] = []
  for (const s of summaries) {
    const members = membersBySummary.get(s.code) ?? []
    // 成员集为空的汇总主体无可核对范围 → 不授权（默认拒绝）
    if (members.length > 0 && members.every((m) => allowedSingles.has(m))) authorized.push(s.code)
  }
  return authorized
}

/** 收敛为 companies 范围：单体集为空则默认拒绝 */
async function toCompaniesScope(client: ScopeClient, singles: Set<string>): Promise<DataScope> {
  if (singles.size === 0) return { type: 'none' }
  const summaryCodes = await authorizedSummaries(client, singles)
  return { type: 'companies', companyCodes: [...singles], summaryCodes }
}

/**
 * 依据当前用户上下文解析数据范围。
 */
export async function resolveScope(
  _client: ScopeClient,
  authUser: ScopeUser,
): Promise<DataScope> {
  // 优先级 0：多选数据范围（单体 + 汇总主体），汇总主体展开为下属单体
  if (authUser.dataScopeCodes && authUser.dataScopeCodes.length > 0) {
    const codes = [...new Set(authUser.dataScopeCodes)]
    const companies = await _client.company.findMany({
      where: { code: { in: codes }, status: 'active' },
      select: { code: true, entityType: true },
    })
    const singles = new Set(companies.filter((c) => c.entityType === 'single').map((c) => c.code))
    const summaryCodes = companies.filter((c) => c.entityType === 'summary').map((c) => c.code)
    if (summaryCodes.length > 0) {
      const maps = await _client.companyAggregationMap.findMany({
        where: { summaryCompanyCode: { in: summaryCodes } },
        select: { singleCompanyCode: true },
      })
      for (const m of maps) singles.add(m.singleCompanyCode)
    }
    // 配置了范围但编码均已失效 → 默认拒绝，防越权
    return toCompaniesScope(_client, singles)
  }

  // 优先级 1：精确绑定单体公司
  if (authUser.companyCode) {
    return toCompaniesScope(_client, new Set([authUser.companyCode]))
  }

  // 优先级 2：orgScopeBu → 通过 company.businessUnit 映射为 companyCodes
  if (authUser.orgScopeBu && authUser.orgScopeBu.length > 0) {
    const companies = await _client.company.findMany({
      where: { businessUnit: { in: authUser.orgScopeBu }, status: 'active', entityType: 'single' },
      select: { code: true },
    })
    if (companies.length > 0) {
      return toCompaniesScope(_client, new Set(companies.map((c) => c.code)))
    }
  }

  // 优先级 3：角色全量
  if (authUser.scopeValue === '*') {
    return { type: 'all' }
  }

  // 兜底：无范围
  return { type: 'none' }
}
