import { describe, it, expect } from 'vitest'
import { assertCompaniesInScope, effectiveScope } from './scope-guard'
import { scopeStore } from '../middleware/scope-context'
import type { DataScope } from '../middleware/scope'

/**
 * 写入路径数据范围守卫。
 * create/createMany 无 where 可注入，Prisma 扩展无法覆盖，故导入等写入链路依赖此守卫显式校验。
 */

const restricted: DataScope = { type: 'companies', companyCodes: ['EN01', 'EN02'], summaryCodes: [] }

describe('scope-guard 写入守卫', () => {
  describe('effectiveScope', () => {
    it('无上下文且无显式范围 → null（脚本/种子链路不施加限制）', async () => {
      expect(await effectiveScope()).toBeNull()
    })

    it('有请求上下文 → 优先采用上下文中已解析的范围', async () => {
      const got = await scopeStore.run(restricted, () => effectiveScope())
      expect(got).toEqual(restricted)
    })
  })

  describe('assertCompaniesInScope', () => {
    it('全部落在范围内 → 通过', async () => {
      await expect(
        scopeStore.run(restricted, () => assertCompaniesInScope(['EN01', 'EN02'], undefined, '导入')),
      ).resolves.toBeUndefined()
    })

    it('存在越界公司 → 403 且错误文案列出越界编码', async () => {
      await expect(
        scopeStore.run(restricted, () => assertCompaniesInScope(['EN01', 'EN99'], undefined, '导入')),
      ).rejects.toMatchObject({ httpStatus: 403, code: 403 })

      const err = await scopeStore
        .run(restricted, () => assertCompaniesInScope(['EN99', 'EN98'], undefined, '导入'))
        .catch((e: Error) => e)
      expect((err as Error).message).toContain('EN99')
      expect((err as Error).message).toContain('EN98')
      expect((err as Error).message).toContain('导入')
    })

    it('scope=all → 放行任意公司', async () => {
      await expect(
        scopeStore.run({ type: 'all' } as DataScope, () => assertCompaniesInScope(['ANY'], undefined, '导入')),
      ).resolves.toBeUndefined()
    })

    it('scope=none → 一律拒绝（默认拒绝）', async () => {
      await expect(
        scopeStore.run({ type: 'none' } as DataScope, () => assertCompaniesInScope([], undefined, '导入')),
      ).rejects.toMatchObject({ httpStatus: 403, code: 403 })
    })

    it('无上下文且无显式范围 → 放行（与扩展语义一致，不阻断脚本导入）', async () => {
      await expect(assertCompaniesInScope(['ANY'], undefined, '导入')).resolves.toBeUndefined()
    })
  })
})
