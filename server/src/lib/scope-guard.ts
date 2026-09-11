import { prisma } from './prisma'
import { errors } from './errors'
import { resolveScope, type DataScope } from '../middleware/scope'
import { currentScope } from '../middleware/scope-context'
import type { AuthUserContext } from '../types/express'

/**
 * 数据范围守卫（写入路径专用）。
 *
 * Prisma 的 scopeContext 扩展只能覆盖带 where 的读与 updateMany/deleteMany，
 * create/createMany 无 where 可注入，因此导入等写入路径须在入库前显式校验目标公司。
 */

export type ScopeInput = Pick<AuthUserContext, 'companyCode' | 'scopeValue'> & {
  dataScopeCodes?: string[] | null
  orgScopeBu?: string[] | null
}

/**
 * 取当前生效的数据范围：优先用请求上下文中已解析的结果（权威且省去重复查询），
 * 无上下文时按传入的用户上下文解析。
 * 两者皆无 → null，表示非请求链路（脚本/种子/单测），与 scopeContext 扩展的语义保持一致：
 * 不施加范围限制。HTTP 链路各路由均挂载 attachScope，故上下文恒存在。
 */
export async function effectiveScope(scope?: ScopeInput): Promise<DataScope | null> {
  const ctx = currentScope()
  if (ctx) return ctx
  if (!scope) return null
  return resolveScope(prisma, scope)
}

/**
 * 断言涉及的公司编码均落在数据范围内，否则 403 并列出越界编码。
 * 用于 create/createMany 等无 where 可注入、扩展无法覆盖的写入路径。
 * @param action 用于拼接错误文案的动作名，如「重分类」「导入」
 */
export async function assertCompaniesInScope(
  codes: string[],
  scope?: ScopeInput,
  action = '操作',
): Promise<void> {
  const s = await effectiveScope(scope)
  if (s === null || s.type === 'all') return
  if (s.type === 'none') throw errors.forbidden(`无数据范围，无法${action}`)
  const allowed = new Set(s.companyCodes)
  const outside = [...new Set(codes)].filter((c) => !allowed.has(c))
  if (outside.length > 0) {
    throw errors.forbidden(`公司 ${outside.join('、')} 不在您的数据范围内，无法${action}`)
  }
}
