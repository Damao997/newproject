import { describe, it, expect } from 'vitest'
import { scopeStore, currentScope, withoutScope } from './scope-context'
import { applyScopeWhere, type DataScope } from './scope'

/**
 * 请求级 scope 上下文（ALS）行为约束。
 * 关键不变量：无上下文时不得注入任何过滤 —— 否则 seed / server/scripts/* / 单测会被静默改写查询。
 */
describe('scope 请求上下文（AsyncLocalStorage）', () => {
  const scope: DataScope = { type: 'companies', companyCodes: ['EN01'], summaryCodes: [] }

  /** 模拟全局扩展中的注入逻辑：仅在存在上下文时改写 where */
  function injectAsExtension(where: unknown): unknown {
    const s = currentScope()
    return s ? applyScopeWhere('FactOperating', 'findMany', where, s) : where
  }

  it('无 store → currentScope 为 undefined，扩展不注入过滤', () => {
    expect(currentScope()).toBeUndefined()
    expect(injectAsExtension({ period: '2025-06' })).toEqual({ period: '2025-06' })
  })

  it('store 内 → 扩展按范围注入 companyCode 过滤', () => {
    scopeStore.run(scope, () => {
      expect(currentScope()).toEqual(scope)
      expect(injectAsExtension({ period: '2025-06' })).toEqual({
        AND: [{ period: '2025-06' }, { companyCode: { in: ['EN01'] } }],
      })
    })
  })

  it('withoutScope 内 → 退出上下文，取跨范围真值（引用完整性校验依赖此行为）', () => {
    scopeStore.run(scope, () => {
      withoutScope(() => {
        expect(currentScope()).toBeUndefined()
        expect(injectAsExtension({ companyCode: 'EN99' })).toEqual({ companyCode: 'EN99' })
      })
      // 退出块后上下文恢复
      expect(currentScope()).toEqual(scope)
    })
  })

  it('store 跨 await 边界保持（异步 handler 链路）', async () => {
    await new Promise<void>((resolve) => {
      scopeStore.run(scope, async () => {
        await Promise.resolve()
        await new Promise((r) => setTimeout(r, 1))
        expect(currentScope()).toEqual(scope)
        resolve()
      })
    })
  })

  it('withoutScope 返回 Promise 时也保持上下文隔离', async () => {
    await new Promise<void>((resolve) => {
      scopeStore.run(scope, async () => {
        const inner = await withoutScope(async () => currentScope())
        expect(inner).toBeUndefined()
        resolve()
      })
    })
  })
})
