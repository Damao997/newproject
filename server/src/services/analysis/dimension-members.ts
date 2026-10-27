import { prisma } from '../../lib/prisma'
import type { Prisma } from '@prisma/client'

/**
 * 维度成员化（L2 / T31，见 docs/plans/即席分析-L1L2-阶段方案.md §3.2）：
 * 把品类 / 产品 / 费用三张配置表镜像为一等维度成员（dimension / dimension_member）。
 *
 * 定位（与方案的差异在此如实记录）：
 * - dimension_member 只存**身份镜像**（code / name / orderNo）：配置表没有父子字段，
 *   按方案「不引入新的自动推导」约定，parentCode 恒空，留待未来的维度管理 UI 手工维护层级；
 * - **匹配信息仍在原配置表**（C1 混合模式 subjectKeyword/subjectCodes 不动），成员表只回答
 *   「有哪些成员、什么顺序」，避免匹配口径双轨；
 * - **同步策略**：配置 CRUD 在同一事务内 reconcile（差集删 + 全集 upsert），seed / backfill 幂等补齐；
 * - **回退策略（灰度安全网，两层）**：
 *   1. 自动：成员集未完整覆盖当前配置行集合（含成员表为空）→ 回退配置表直读，
 *      使绕过 service 的写入口径（seed 旧逻辑、脚本直插、测试夹具）行为与改造前一致；
 *   2. 开关：env ANALYSIS_DIMENSION_MEMBERS=off|config|false|0 强制配置表模式（紧急 kill switch）。
 */

export const DIMENSION_KEYS = ['category', 'product', 'expense'] as const
export type DimensionKey = (typeof DIMENSION_KEYS)[number]

/** 维度行元数据（dimension.code 与 RowDim 对齐，dimType=business_unit） */
const DIMENSION_META: Record<DimensionKey, { code: string; name: string }> = {
  category: { code: 'category', name: '品类' },
  product: { code: 'product', name: '产品' },
  expense: { code: 'expense', name: '运营费用' },
}

/** 客户端抽象：事务内（tx）与事务外（prisma）都可同步 */
type DbClient = Prisma.TransactionClient | typeof prisma

/** 配置源行：三张配置表统一投影（费用映射无关键词，subjectKeyword 恒空串） */
export interface ConfigSourceRow {
  code: string
  name: string
  subjectKeyword: string
  subjectCodes: string[]
  orderNo: number
}

/**
 * 读某维度的**活跃配置行**（与各适配器改造前的读法逐字段一致：品类/产品 status=active；
 * 费用映射 status=active 且 deletedAt=null——软删除墓碑行进不了成员表）。
 */
async function readLiveConfigs(client: DbClient, dim: DimensionKey): Promise<ConfigSourceRow[]> {
  if (dim === 'category') {
    const rows = await client.productCategory.findMany({
      where: { status: 'active' },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, subjectKeyword: true, subjectCodes: true, sortOrder: true },
    })
    return rows.map((r) => ({ code: r.code, name: r.name, subjectKeyword: r.subjectKeyword, subjectCodes: r.subjectCodes ?? [], orderNo: r.sortOrder }))
  }
  if (dim === 'product') {
    const rows = await client.keyMetricsProduct.findMany({
      where: { status: 'active' },
      orderBy: { sortOrder: 'asc' },
      select: { code: true, name: true, subjectKeyword: true, subjectCodes: true, sortOrder: true },
    })
    return rows.map((r) => ({ code: r.code, name: r.name, subjectKeyword: r.subjectKeyword, subjectCodes: r.subjectCodes ?? [], orderNo: r.sortOrder }))
  }
  const rows = await client.expenseSubjectMapping.findMany({
    where: { status: 'active', deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { code: true, name: true, subjectCodes: true, sortOrder: true },
  })
  return rows.map((r) => ({ code: r.code, name: r.name, subjectKeyword: '', subjectCodes: r.subjectCodes ?? [], orderNo: r.sortOrder }))
}

/**
 * 成员模式开关：默认 members（配覆盖校验回退）；env 显式关闭时强制 config。
 * 关停开关语义取保守值——任何非关闭值都视为启用成员模式。
 */
export function resolveDimensionMode(): 'members' | 'config' {
  const v = process.env.ANALYSIS_DIMENSION_MEMBERS?.trim().toLowerCase()
  return v === 'off' || v === 'config' || v === 'false' || v === '0' ? 'config' : 'members'
}

/**
 * 取某维度的配置源（行/列两路适配器与列成员解析的唯一入口）：
 * - config 模式（开关关闭）：配置表直读，行为与改造前一致；
 * - members 模式（默认）：成员表定清单与顺序，配置表补匹配信息；
 *   成员表为空或**未完整覆盖配置行**时任一回退到配置表直读（见文件头回退策略）。
 */
export async function loadConfigSource(dim: DimensionKey): Promise<ConfigSourceRow[]> {
  if (resolveDimensionMode() === 'config') return readLiveConfigs(prisma, dim)

  const dimRow = await prisma.dimension.findUnique({ where: { code: DIMENSION_META[dim].code }, select: { id: true } })
  if (!dimRow) return readLiveConfigs(prisma, dim)
  const members = await prisma.dimensionMember.findMany({
    where: { dimensionId: dimRow.id },
    orderBy: { orderNo: 'asc' },
    select: { code: true, name: true, orderNo: true },
  })
  if (members.length === 0) return readLiveConfigs(prisma, dim)

  const configs = await readLiveConfigs(prisma, dim)
  const byCode = new Map(configs.map((c) => [c.code, c]))
  // 覆盖校验：配置行集合必须被成员集完整覆盖，否则视为同步被绕过（脚本直插/夹具），
  // 回退配置表，保证未同步的新配置不「消失」在成员驱动结果外
  if (configs.some((c) => !members.some((m) => m.code === c.code))) return configs

  return members.flatMap((m) => {
    const c = byCode.get(m.code)
    // 成员存在但配置行已不存在（同步被绕过的人工删库）：无匹配信息可补，跳过（等价失效配置）
    return c ? [{ code: m.code, name: m.name, subjectKeyword: c.subjectKeyword, subjectCodes: c.subjectCodes, orderNo: m.orderNo }] : []
  })
}

/**
 * 同事务同步：确保 dimension 行存在，按当前活跃配置全集 reconcile 成员
 * （差集删除 + 全集 upsert）。返回成员数（seed/backfill 日志用）。
 * 必须在配置写操作的同一事务内调用，否则配置与成员可能出现中间态。
 */
export async function syncDimensionMembers(client: DbClient, dim: DimensionKey): Promise<number> {
  const meta = DIMENSION_META[dim]
  const rows = await readLiveConfigs(client, dim)
  const dimension = await client.dimension.upsert({
    where: { code: meta.code },
    update: { name: meta.name },
    create: { code: meta.code, name: meta.name, dimType: 'business_unit' },
  })
  const existing = await client.dimensionMember.findMany({ where: { dimensionId: dimension.id }, select: { code: true } })
  const wanted = new Set(rows.map((r) => r.code))
  const stale = existing.filter((e) => !wanted.has(e.code)).map((e) => e.code)
  if (stale.length > 0) {
    await client.dimensionMember.deleteMany({ where: { dimensionId: dimension.id, code: { in: stale } } })
  }
  for (const r of rows) {
    await client.dimensionMember.upsert({
      where: { dimensionId_code: { dimensionId: dimension.id, code: r.code } },
      update: { name: r.name, orderNo: r.orderNo },
      create: { dimensionId: dimension.id, code: r.code, name: r.name, orderNo: r.orderNo },
    })
  }
  return rows.length
}

/** 全维度幂等同步（seed 末尾 / backfill 脚本用；可包在事务里） */
export async function syncAllDimensionMembers(client: DbClient = prisma): Promise<Record<DimensionKey, number>> {
  const out: Record<DimensionKey, number> = { category: 0, product: 0, expense: 0 }
  for (const dim of DIMENSION_KEYS) out[dim] = await syncDimensionMembers(client, dim)
  return out
}
