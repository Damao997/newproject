import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma } from '../lib/prisma'
import { analysisQuerySchema } from '../lib/analysis-query'
import { AnalysisViewService, MAX_VIEWS_PER_OWNER } from './AnalysisViewService'
import type { AuthUserContext } from '../types/express'

/**
 * 即席分析视图持久化契约测试（真实 DB 测试库）。
 *
 * 夹具：库内两个真实用户（一个作 owner，一个作「他人」）；视图按 suffix 隔离并清理。
 * 覆盖：保存/列表/共享可见性/更新删除的创建者边界/spec 校验/单人上限。
 */

let dbReady = false
let ownerId = ''
let otherId = ''
const suffix = `VW${Date.now().toString(36)}`

const ctx = (userId: string, roleCode = 'admin'): AuthUserContext => ({
  userId,
  username: `t_${suffix}`,
  roleCode,
  roleId: 'r',
  scopeValue: '*',
  companyCode: null,
  orgScopeBu: null,
  dataScopeCodes: null,
})

const validSpec = { period: '2099-06', rowDim: 'category', metrics: ['income.monthActual'] }
/** 存储的是 schema 规范化后的 spec（补默认值，如 colCodes: []）——加载时等价，且形态确定 */
const canonicalSpec = analysisQuerySchema.parse(validSpec)
const createdIds: string[] = []

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const users = await basePrisma.user.findMany({ take: 2, select: { id: true } })
    if (users.length < 2) return
    ;[ownerId, otherId] = users.map((u) => u.id)
    dbReady = true
  } catch (e) {
    console.error('[AnalysisViewService.test] 夹具准备失败：', e)
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.analysisView.deleteMany({ where: { name: { startsWith: `VWT_${suffix}` } } }).catch(() => undefined)
  await basePrisma.$disconnect().catch(() => undefined)
})

const track = <T extends { id: string }>(v: T): T => {
  createdIds.push(v.id)
  return v
}

describe('AnalysisViewService 视图持久化', () => {
  it('保存后列表可见：spec 原样返回，isOwner=true', async () => {
    if (!dbReady) return
    const owner = ctx(ownerId)
    const v = track(await AnalysisViewService.create(owner, {
      name: `VWT_${suffix}_mine`, spec: validSpec, shared: false,
    }))
    expect(v.spec).toEqual(canonicalSpec)
    const list = await AnalysisViewService.list(owner)
    const found = list.find((x) => x.id === v.id)
    expect(found?.isOwner).toBe(true)
    expect(found?.name).toBe(`VWT_${suffix}_mine`)
    expect(found?.ownerName).toBeTruthy()
  })

  it('共享视图对他人可见但不可管理（isOwner=false）', async () => {
    if (!dbReady) return
    const owner = ctx(ownerId)
    const other = ctx(otherId)
    const v = track(await AnalysisViewService.create(owner, { name: `VWT_${suffix}_shared`, spec: validSpec, shared: true }))
    const list = await AnalysisViewService.list(other)
    expect(list.find((x) => x.id === v.id)?.isOwner).toBe(false)
    await expect(AnalysisViewService.update(other, v.id, { name: 'x' })).rejects.toThrow(/创建者/)
    await expect(AnalysisViewService.remove(other, v.id)).rejects.toThrow(/创建者/)
    // 创建者可管理
    await AnalysisViewService.update(owner, v.id, { shared: false })
  })

  it('非共享视图对他人不可见', async () => {
    if (!dbReady) return
    const owner = ctx(ownerId)
    const v = track(await AnalysisViewService.create(owner, { name: `VWT_${suffix}_private`, spec: validSpec }))
    const list = await AnalysisViewService.list(ctx(otherId))
    expect(list.find((x) => x.id === v.id)).toBeUndefined()
  })

  it('update 局部更新 name/spec/shared，创建者与超管均可', async () => {
    if (!dbReady) return
    const owner = ctx(ownerId)
    const v = track(await AnalysisViewService.create(owner, { name: `VWT_${suffix}_upd`, spec: validSpec }))
    const updated = await AnalysisViewService.update(owner, v.id, {
      name: `VWT_${suffix}_upd2`, spec: { ...validSpec, rowDim: 'product' }, shared: true,
    })
    expect(updated.name).toBe(`VWT_${suffix}_upd2`)
    expect(updated.spec.rowDim).toBe('product')
    expect(updated.spec.colCodes).toEqual([])
    expect(updated.shared).toBe(true)
    // 超管可改他人视图
    const bySuper = await AnalysisViewService.update(ctx(otherId, 'superadmin'), v.id, { shared: false })
    expect(bySuper.shared).toBe(false)
    // 超管可删他人视图
    await AnalysisViewService.remove(ctx(otherId, 'superadmin'), v.id)
    expect(await basePrisma.analysisView.findUnique({ where: { id: v.id } })).toBeNull()
  })

  it('spec 非法被拒（400）：缺 rowDim / 行列同维 / 未知字段', async () => {
    if (!dbReady) return
    const owner = ctx(ownerId)
    await expect(AnalysisViewService.create(owner, { name: `VWT_${suffix}_bad1`, spec: { metrics: [] } }))
      .rejects.toThrow(/校验|rowDim|required/i)
    await expect(AnalysisViewService.create(owner, { name: `VWT_${suffix}_bad2`, spec: { rowDim: 'category', colDim: 'category' } }))
      .rejects.toThrow(/列维度不能与行维度相同/)
    await expect(AnalysisViewService.create(owner, { name: `VWT_${suffix}_bad3`, spec: { rowDim: 'category', unknownField: 1 } }))
      .rejects.toThrow()
  })

  it('name 超长/空被拒', async () => {
    if (!dbReady) return
    const owner = ctx(ownerId)
    await expect(AnalysisViewService.create(owner, { name: '', spec: validSpec })).rejects.toThrow()
    await expect(AnalysisViewService.create(owner, { name: 'x'.repeat(51), spec: validSpec })).rejects.toThrow()
  })

  it('单人视图数达上限后拒绝再建', async () => {
    if (!dbReady) return
    const owner = ctx(ownerId)
    // 已有视图中属于该 owner 的数量 + 批量建满到上限
    const owned = await basePrisma.analysisView.count({ where: { ownerId } })
    const toCreate = MAX_VIEWS_PER_OWNER - owned
    if (toCreate > 0) {
      await Promise.all(
        Array.from({ length: toCreate }, (_, i) =>
          AnalysisViewService.create(owner, { name: `VWT_${suffix}_cap${i}`, spec: validSpec }).then(track),
        ),
      )
    }
    await expect(AnalysisViewService.create(owner, { name: `VWT_${suffix}_capOver`, spec: validSpec }))
      .rejects.toThrow(new RegExp(`上限 ${MAX_VIEWS_PER_OWNER}`))
  })

  it('操作不存在的视图返回 404', async () => {
    if (!dbReady) return
    await expect(AnalysisViewService.update(ctx(ownerId), 'no-such-id', { name: 'x' })).rejects.toThrow(/不存在/)
    await expect(AnalysisViewService.remove(ctx(ownerId), 'no-such-id')).rejects.toThrow(/不存在/)
  })
})
