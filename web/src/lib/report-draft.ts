import type { ReportSectionView } from '@/types'

/**
 * 报告编辑器本地草稿的账号隔离存取层（FE-01）。
 *
 * 隔离与归属规则：
 * - 存储键 `report-drafts:{accountId}:{reportId}`：以稳定账号 ID + 报告 ID 定位；
 * - 值内嵌 accountId / reportId / baseUpdatedAt（草稿基于的报告基准版本）/ savedAt，
 *   读取前校验归属：账号或报告不匹配一律返回 null，不向调用方暴露正文；
 * - 旧版无归属键（`report-drafts:{reportId}`）无法证明归属，不自动认领、不读取；
 * - 账号边界（登录/切号）只清理其他账号名下的草稿键，不清空整个 sessionStorage，
 *   同账号重登与刷新不受影响。
 */

export interface ReportDraftSection {
  id: string
  analysisId: string | null
  title: string
  content: string
  source: ReportSectionView['source']
  missing: boolean
}

export interface StoredReportDraft {
  accountId: string
  reportId: string
  /** 草稿保存时报告的基准版本（report.updatedAt），恢复前用于提示版本差异 */
  baseUpdatedAt: string
  savedAt: string
  /** null = 未做章节结构调整，仅正文内容有草稿 */
  sections: ReportDraftSection[] | null
  drafts: Record<string, string>
}

export interface ReportDraftPayload {
  sections: ReportDraftSection[] | null
  drafts: Record<string, string>
}

const DRAFT_KEY_PREFIX = 'report-drafts:'

export function reportDraftKey(accountId: string, reportId: string): string {
  return `${DRAFT_KEY_PREFIX}${accountId}:${reportId}`
}

/**
 * 解析并校验草稿记录。归属不可证明（旧格式无账号、账号/报告不匹配、结构无效）时返回 null，
 * 调用方据此拒绝恢复，避免跨账号或跨报告串入正文。
 */
export function parseReportDraft(raw: string | null, accountId: string, reportId: string): StoredReportDraft | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    if (record.accountId !== accountId || record.reportId !== reportId) return null
    const rawDrafts = record.drafts
    if (!rawDrafts || typeof rawDrafts !== 'object' || Array.isArray(rawDrafts)) return null
    const drafts: Record<string, string> = {}
    for (const [key, value] of Object.entries(rawDrafts as Record<string, unknown>)) {
      if (typeof value === 'string') drafts[key] = value
    }
    const sections = Array.isArray(record.sections)
      ? record.sections.flatMap((value): ReportDraftSection[] => {
          if (!value || typeof value !== 'object') return []
          const row = value as Record<string, unknown>
          if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.content !== 'string') return []
          return [{
            id: row.id,
            analysisId: typeof row.analysisId === 'string' ? row.analysisId : null,
            title: row.title,
            content: row.content,
            source: row.source && typeof row.source === 'object' ? row.source as ReportSectionView['source'] : null,
            missing: row.missing === true,
          }]
        })
      : null
    const hasDrafts = Object.keys(drafts).length > 0
    if (!sections && !hasDrafts) return null
    if (sections && sections.length === 0 && !hasDrafts) return null
    return {
      accountId,
      reportId,
      baseUpdatedAt: typeof record.baseUpdatedAt === 'string' ? record.baseUpdatedAt : '',
      savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
      sections,
      drafts,
    }
  } catch {
    return null
  }
}

/** 保存草稿：写入账号归属、报告 ID、基准版本与时间；隐私模式/配额满时降级为无暂存，不阻断编辑 */
export function saveReportDraft(accountId: string, reportId: string, baseUpdatedAt: string, payload: ReportDraftPayload): boolean {
  try {
    const record: StoredReportDraft = {
      accountId,
      reportId,
      baseUpdatedAt,
      savedAt: new Date().toISOString(),
      sections: payload.sections,
      drafts: payload.drafts,
    }
    window.sessionStorage.setItem(reportDraftKey(accountId, reportId), JSON.stringify(record))
    return true
  } catch (e) {
    console.error('报告草稿暂存失败', e)
    return false
  }
}

/** 读取草稿：读取前校验归属，未通过一律返回 null（不返回正文） */
export function readReportDraft(accountId: string, reportId: string): StoredReportDraft | null {
  let raw: string | null = null
  try {
    raw = window.sessionStorage.getItem(reportDraftKey(accountId, reportId))
  } catch (e) {
    console.error('读取报告草稿失败', e)
    return null
  }
  return parseReportDraft(raw, accountId, reportId)
}

/** 清除单个草稿键（保存成功、显式丢弃时使用） */
export function clearReportDraft(accountId: string, reportId: string): void {
  try {
    window.sessionStorage.removeItem(reportDraftKey(accountId, reportId))
  } catch (e) {
    console.error('清除报告草稿暂存失败', e)
  }
}

function removeDraftsWhere(shouldRemove: (key: string) => boolean): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i)
      if (key && shouldRemove(key)) stale.push(key)
    }
    for (const key of stale) window.sessionStorage.removeItem(key)
  } catch (e) {
    console.error('清理报告草稿暂存失败', e)
  }
}

/**
 * 显式退出清理：删除当前账号名下的全部草稿键（用户主动登出/退出重新认证时调用）。
 * 会话过期后的同页重新认证不经过 logout，不调用本函数，草稿得以保留。
 */
export function clearAccountReportDrafts(accountId: string): void {
  if (!accountId) return
  const prefix = `${DRAFT_KEY_PREFIX}${accountId}:`
  removeDraftsWhere((key) => key.startsWith(prefix))
}

/**
 * 账号边界清理：登录/切号后仅保留当前账号名下的草稿键。
 * 其他账号的键与无法证明归属的旧格式键（`report-drafts:{reportId}`）一并清理，
 * 刷新不受影响；不触碰其他前缀的存储项。
 */
export function clearOtherAccountReportDrafts(accountId: string): void {
  if (!accountId) return
  const keepPrefix = `${DRAFT_KEY_PREFIX}${accountId}:`
  removeDraftsWhere((key) => key.startsWith(DRAFT_KEY_PREFIX) && !key.startsWith(keepPrefix))
}
