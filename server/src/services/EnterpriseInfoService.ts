import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { logger } from '../lib/logger'
import { getProvider, type EnterpriseBasicInfo } from './enterprise-providers'

/**
 * 企业工商信息服务（其他工具）。
 * 查询链路：归一化关键词 → 查本地缓存（7 天有效）→ 未命中调 Provider → upsert 缓存；
 * 每次查询均写入 enterprise_query_log（按用户），供"最近查询"回看。
 */

/** 缓存有效期：7 天 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** 返回给前端的查询结果 DTO */
export interface EnterpriseSearchResult extends EnterpriseBasicInfo {
  /** 是否命中本地缓存 */
  fromCache: boolean
  /** 数据来源 Provider */
  provider: string
  /** 数据获取时间（ISO） */
  fetchedAt: string
}

export interface EnterpriseHistoryItem {
  id: string
  keyword: string
  matchedName: string | null
  fromCache: boolean
  createdAt: string
}

interface CacheRow {
  creditCode: string
  name: string
  legalPerson: string | null
  registeredCapital: string | null
  establishDate: string | null
  status: string | null
  companyType: string | null
  industry: string | null
  registeredAddress: string | null
  businessScope: string | null
  raw: unknown
  provider: string
  fetchedAt: Date
}

function toResult(row: CacheRow, fromCache: boolean): EnterpriseSearchResult {
  return {
    name: row.name,
    creditCode: row.creditCode,
    legalPerson: row.legalPerson,
    registeredCapital: row.registeredCapital,
    establishDate: row.establishDate,
    status: row.status,
    companyType: row.companyType,
    industry: row.industry,
    registeredAddress: row.registeredAddress,
    businessScope: row.businessScope,
    raw: null, // 原始报文仅落库备查，不回传前端
    fromCache,
    provider: row.provider,
    fetchedAt: row.fetchedAt.toISOString(),
  }
}

async function writeLog(userId: string, keyword: string, matchedName: string | null, fromCache: boolean): Promise<void> {
  await prisma.enterpriseQueryLog.create({
    data: { userId, keyword, matchedName, fromCache },
  })
}

export const EnterpriseInfoService = {
  /**
   * 查询企业工商信息（名称或统一社会信用代码）。
   * 缓存命中（未过期）直接返回；否则调 Provider 并刷新缓存。未命中返回 null。
   */
  async search(keyword: string, userId: string, traceId: string): Promise<EnterpriseSearchResult | null> {
    const kw = keyword.trim()
    if (!kw) throw errors.badRequest('查询关键词不能为空')
    if (kw.length > 100) throw errors.badRequest('查询关键词过长')

    const now = new Date()

    // 1) 本地缓存：信用代码精确或名称精确匹配，且未过期
    const cached = await prisma.enterpriseInfo.findFirst({
      where: {
        OR: [{ creditCode: kw }, { name: kw }],
        expiresAt: { gt: now },
      },
    })
    if (cached) {
      await writeLog(userId, kw, cached.name, true)
      return toResult(cached, true)
    }

    // 2) 调外部 Provider
    const provider = getProvider()
    const info = await provider.search(kw)
    if (!info) {
      await writeLog(userId, kw, null, false)
      return null
    }

    // 3) upsert 缓存（按信用代码去重），有效期 7 天
    const expiresAt = new Date(now.getTime() + CACHE_TTL_MS)
    const data = {
      name: info.name,
      legalPerson: info.legalPerson,
      registeredCapital: info.registeredCapital,
      establishDate: info.establishDate,
      status: info.status,
      companyType: info.companyType,
      industry: info.industry,
      registeredAddress: info.registeredAddress,
      businessScope: info.businessScope,
      raw: (info.raw ?? undefined) as never,
      provider: provider.name,
      fetchedAt: now,
      expiresAt,
    }
    const saved = await prisma.enterpriseInfo.upsert({
      where: { creditCode: info.creditCode },
      update: data,
      create: { creditCode: info.creditCode, ...data },
    })
    await writeLog(userId, kw, saved.name, false)
    logger.info(traceId, 'enterprise_search', { keyword: kw, provider: provider.name, matched: saved.name })
    return toResult(saved, false)
  },

  /** 本人查询历史（倒序分页） */
  async listHistory(userId: string, params: { page: number; pageSize: number }): Promise<{ items: EnterpriseHistoryItem[]; total: number }> {
    const [rows, total] = await Promise.all([
      prisma.enterpriseQueryLog.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      prisma.enterpriseQueryLog.count({ where: { userId } }),
    ])
    return {
      items: rows.map((r) => ({
        id: r.id,
        keyword: r.keyword,
        matchedName: r.matchedName,
        fromCache: r.fromCache,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
    }
  },
}
