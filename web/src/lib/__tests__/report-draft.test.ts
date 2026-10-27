import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAccountReportDrafts,
  clearOtherAccountReportDrafts,
  clearReportDraft,
  parseReportDraft,
  readReportDraft,
  reportDraftKey,
  saveReportDraft,
  type ReportDraftSection,
} from '../report-draft'

const ACCOUNT_A = 'account-a'
const ACCOUNT_B = 'account-b'
const REPORT_1 = 'report-1'
const REPORT_2 = 'report-2'
const BASE_VERSION = '2026-09-30T08:30:00.000Z'

function sampleSection(overrides: Partial<ReportDraftSection> = {}): ReportDraftSection {
  return { id: 'section-1', analysisId: null, title: '经营概览', content: '<p>草稿内容</p>', source: null, missing: false, ...overrides }
}

describe('报告草稿账号隔离存取（FE-01）', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('同账号同报告保存后可读回，记录归属、基准版本与时间', () => {
    const before = Date.now()
    expect(saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>修改</p>' } })).toBe(true)
    const record = readReportDraft(ACCOUNT_A, REPORT_1)
    expect(record).not.toBeNull()
    expect(record).toMatchObject({ accountId: ACCOUNT_A, reportId: REPORT_1, baseUpdatedAt: BASE_VERSION })
    expect(record!.drafts).toEqual({ 'section-1': '<p>修改</p>' })
    expect(new Date(record!.savedAt).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('异账号读不到 A 的草稿（键与归属双重校验）', () => {
    saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>A 的内容</p>' } })
    expect(readReportDraft(ACCOUNT_B, REPORT_1)).toBeNull()
    expect(sessionStorage.getItem(reportDraftKey(ACCOUNT_B, REPORT_1))).toBeNull()
  })

  it('不同报告之间草稿互不可见', () => {
    saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>报告1草稿</p>' } })
    expect(readReportDraft(ACCOUNT_A, REPORT_2)).toBeNull()
  })

  it('值内归属被篡改（账号或报告不匹配）时拒绝读取，不暴露正文', () => {
    saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>正文</p>' } })
    const key = reportDraftKey(ACCOUNT_A, REPORT_1)
    const tampered = JSON.parse(sessionStorage.getItem(key)!)
    tampered.accountId = ACCOUNT_B
    sessionStorage.setItem(key, JSON.stringify(tampered))
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).toBeNull()
    expect(readReportDraft(ACCOUNT_B, REPORT_1)).toBeNull()
  })

  it('无归属旧键（report-drafts:{reportId}）不自动认领', () => {
    sessionStorage.setItem(`report-drafts:${REPORT_1}`, JSON.stringify({ drafts: { 'section-1': '<p>旧格式草稿</p>' }, savedAt: BASE_VERSION }))
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).toBeNull()
    expect(readReportDraft(ACCOUNT_B, REPORT_1)).toBeNull()
    // 未认领也不主动删除（归属不明，由账号边界统一处理）
    expect(sessionStorage.getItem(`report-drafts:${REPORT_1}`)).not.toBeNull()
  })

  it('结构损坏或正文类型非法的记录返回 null', () => {
    const key = reportDraftKey(ACCOUNT_A, REPORT_1)
    sessionStorage.setItem(key, '{broken json')
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).toBeNull()
    sessionStorage.setItem(key, JSON.stringify({ accountId: ACCOUNT_A, reportId: REPORT_1, drafts: null }))
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).toBeNull()
    sessionStorage.setItem(key, JSON.stringify({ accountId: ACCOUNT_A, reportId: REPORT_1, drafts: {}, sections: [] }))
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).toBeNull()
    // 逐项过滤非法正文字段；结构章节保留
    expect(parseReportDraft(JSON.stringify({
      accountId: ACCOUNT_A, reportId: REPORT_1, drafts: { ok: '<p>1</p>', bad: 42 },
      sections: [sampleSection(), { id: 7 }, 'x'],
    }), ACCOUNT_A, REPORT_1)).toMatchObject({ drafts: { ok: '<p>1</p>' } })
  })

  it('结构章节与正文草稿同时保存时可完整恢复', () => {
    saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, {
      sections: [sampleSection(), sampleSection({ id: 'local-2', title: '', content: '' })],
      drafts: { 'local-2': '<p>新增章节内容</p>' },
    })
    const record = readReportDraft(ACCOUNT_A, REPORT_1)
    expect(record!.sections).toHaveLength(2)
    expect(record!.sections![1]).toMatchObject({ id: 'local-2', analysisId: null, missing: false })
  })

  it('clearReportDraft 只删除指定账号与报告的键', () => {
    saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>1</p>' } })
    saveReportDraft(ACCOUNT_A, REPORT_2, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>2</p>' } })
    clearReportDraft(ACCOUNT_A, REPORT_1)
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).toBeNull()
    expect(readReportDraft(ACCOUNT_A, REPORT_2)).not.toBeNull()
  })

  it('账号边界清理只移除其他账号与无归属旧键，保留当前账号与无关存储项', () => {
    saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>A1</p>' } })
    saveReportDraft(ACCOUNT_A, REPORT_2, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>A2</p>' } })
    saveReportDraft(ACCOUNT_B, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>B1</p>' } })
    sessionStorage.setItem(`report-drafts:${REPORT_1}`, JSON.stringify({ drafts: { 'section-1': '<p>旧键</p>' } }))
    sessionStorage.setItem('other-feature-draft', '保留')
    clearOtherAccountReportDrafts(ACCOUNT_A)
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).not.toBeNull()
    expect(readReportDraft(ACCOUNT_A, REPORT_2)).not.toBeNull()
    expect(readReportDraft(ACCOUNT_B, REPORT_1)).toBeNull()
    expect(sessionStorage.getItem(`report-drafts:${REPORT_1}`)).toBeNull()
    expect(sessionStorage.getItem('other-feature-draft')).toBe('保留')
  })

  it('同账号重登后草稿仍可恢复（账号边界清理不清除本人键）', () => {
    saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>重登恢复</p>' } })
    clearOtherAccountReportDrafts(ACCOUNT_A)
    expect(readReportDraft(ACCOUNT_A, REPORT_1)!.drafts['section-1']).toBe('<p>重登恢复</p>')
  })

  it('显式登出清理本人全部草稿键，不影响其他账号与无关存储项', () => {
    saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>A1</p>' } })
    saveReportDraft(ACCOUNT_A, REPORT_2, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>A2</p>' } })
    saveReportDraft(ACCOUNT_B, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>B1</p>' } })
    sessionStorage.setItem('other-feature-draft', '保留')
    clearAccountReportDrafts(ACCOUNT_A)
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).toBeNull()
    expect(readReportDraft(ACCOUNT_A, REPORT_2)).toBeNull()
    expect(readReportDraft(ACCOUNT_B, REPORT_1)).not.toBeNull()
    expect(sessionStorage.getItem('other-feature-draft')).toBe('保留')
  })

  it('会话存储不可用时保存返回 false 且读取返回 null，不抛出异常', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceeded') })
    expect(saveReportDraft(ACCOUNT_A, REPORT_1, BASE_VERSION, { sections: null, drafts: { 'section-1': '<p>1</p>' } })).toBe(false)
    setItem.mockRestore()
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError') })
    expect(readReportDraft(ACCOUNT_A, REPORT_1)).toBeNull()
    getItem.mockRestore()
  })
})
