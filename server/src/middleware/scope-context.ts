import { AsyncLocalStorage } from 'node:async_hooks'
import type { DataScope } from './scope'

/**
 * 请求级数据范围上下文（AsyncLocalStorage）。
 *
 * 设计意图：scope 与请求绑定，但 36 个 service 均以模块级 `import { prisma }` 取客户端。
 * 若改为逐个透传派生客户端需大面积改签名，故改由 ALS 承载 DataScope，
 * 全局 Prisma 扩展（applyScopeFromContext）在查询时按需读取并注入过滤。
 *
 * 无 store（seed / server/scripts/* / 单元测试）时不注入任何过滤，行为与改造前一致。
 */
export const scopeStore = new AsyncLocalStorage<DataScope>()

/** 当前请求的数据范围；不在请求上下文中时为 undefined */
export function currentScope(): DataScope | undefined {
  return scopeStore.getStore()
}

/**
 * 临时退出 scope 上下文执行 fn。
 * 用于必须取得跨范围真值的场景（如引用完整性校验：范围外仍有事实数据时不得放行停用）。
 */
export function withoutScope<T>(fn: () => T): T {
  return scopeStore.exit(fn)
}
