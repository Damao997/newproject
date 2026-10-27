import { z } from 'zod'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { analysisQuerySchema } from '../lib/analysis-query'
import type { AuthUserContext } from '../types/express'

/** spec 类型 = analysisQuerySchema 的输出型（与前端 AnalysisQuerySpec 契约一致，不跨端引用） */
export type AnalysisViewSpec = z.infer<typeof analysisQuerySchema>

/**
 * 即席分析视图持久化（自定义报表，L1-3，见 docs/plans/即席分析-L1L2-阶段方案.md §2.2/§3.1）。
 *
 * 权限模型（复用 dashboard:view，零迁移成本）：
 *   - shared = true  → 所有具 dashboard:view 的用户可见、可加载
 *   - 更新/删除      → 仅创建者或 superadmin
 * 视图 = 具名 spec：加载时把 spec 交回前端工作台，不走服务端执行，
 * 因此「加载」无独立接口，list 的 spec 字段即加载结果。
 */

/** 单人视图数上限：防误用/囤积；超限 400 明确报错（与 colCodes 上限同风格） */
export const MAX_VIEWS_PER_OWNER = 50

const NAME_MAX = 50

const createSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX),
  spec: analysisQuerySchema,
  shared: z.boolean().optional(),
}).strict()

const updateSchema = z.object({
  name: z.string().trim().min(1).max(NAME_MAX).optional(),
  spec: analysisQuerySchema.optional(),
  shared: z.boolean().optional(),
}).strict()

export interface AnalysisViewItem {
  id: string
  name: string
  ownerId: string
  ownerName: string
  shared: boolean
  spec: AnalysisViewSpec
  isOwner: boolean
  createdAt: string
  updatedAt: string
}

function canManage(user: AuthUserContext, ownerId: string): boolean {
  return user.userId === ownerId || user.roleCode === 'superadmin'
}

export const AnalysisViewService = {
  /** 我的视图 + 共享视图（他人），按更新时间倒序 */
  async list(user: AuthUserContext): Promise<AnalysisViewItem[]> {
    const rows = await prisma.analysisView.findMany({
      where: { OR: [{ ownerId: user.userId }, { shared: true }] },
      orderBy: { updatedAt: 'desc' },
    })
    if (rows.length === 0) return []
    // 归属人展示名一次性查（避免 N+1）；用户被删时视图仍在（无外键），降级显示用户名占位
    const owners = await prisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.ownerId))] } },
      select: { id: true, displayName: true, username: true },
    })
    const ownerName = new Map(owners.map((u) => [u.id, u.displayName || u.username]))
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      ownerId: r.ownerId,
      ownerName: ownerName.get(r.ownerId) ?? '已注销用户',
      shared: r.shared,
      spec: r.spec as unknown as AnalysisViewSpec,
      isOwner: r.ownerId === user.userId,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }))
  },

  /** 保存视图：spec 必须过 analysisQuerySchema（校验不执行，确保存下的都能加载） */
  async create(user: AuthUserContext, input: unknown): Promise<AnalysisViewItem> {
    const parsed = createSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw errors.badRequest(issue ? `${issue.path.join('.') || 'body'}：${issue.message}` : '视图参数校验失败')
    }
    const { name, spec, shared = false } = parsed.data
    const owned = await prisma.analysisView.count({ where: { ownerId: user.userId } })
    if (owned >= MAX_VIEWS_PER_OWNER) {
      throw errors.badRequest(`单人视图数已达上限 ${MAX_VIEWS_PER_OWNER}，请先删除不再使用的视图`)
    }
    const row = await prisma.analysisView.create({
      data: { name, ownerId: user.userId, shared, spec: spec as unknown as object },
    })
    return {
      id: row.id, name: row.name, ownerId: row.ownerId, ownerName: user.username, shared: row.shared,
      spec: spec as AnalysisViewSpec, isOwner: true,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }
  },

  /** 更新（仅创建者或超管）：name/spec/shared 可局部更新 */
  async update(user: AuthUserContext, id: string, input: unknown): Promise<AnalysisViewItem> {
    const parsed = updateSchema.safeParse(input)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      throw errors.badRequest(issue ? `${issue.path.join('.') || 'body'}：${issue.message}` : '视图参数校验失败')
    }
    const existing = await prisma.analysisView.findUnique({ where: { id } })
    if (!existing) throw errors.notFound('视图不存在')
    if (!canManage(user, existing.ownerId)) throw errors.forbidden('仅视图创建者可修改')
    const row = await prisma.analysisView.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.spec !== undefined ? { spec: parsed.data.spec as unknown as object } : {}),
        ...(parsed.data.shared !== undefined ? { shared: parsed.data.shared } : {}),
      },
    })
    return {
      id: row.id, name: row.name, ownerId: row.ownerId, ownerName: user.username, shared: row.shared,
      spec: row.spec as unknown as AnalysisViewSpec, isOwner: row.ownerId === user.userId,
      createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    }
  },

  /** 删除（创建者或超管） */
  async remove(user: AuthUserContext, id: string): Promise<void> {
    const existing = await prisma.analysisView.findUnique({ where: { id } })
    if (!existing) throw errors.notFound('视图不存在')
    if (!canManage(user, existing.ownerId)) throw errors.forbidden('仅视图创建者可删除')
    await prisma.analysisView.delete({ where: { id } })
  },
}
