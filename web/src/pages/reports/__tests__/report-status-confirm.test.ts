import { describe, it, expect } from 'vitest'
import { describeStatusAction, NEXT_STATUS, EXTRA_STATUS } from '../report-status-confirm'

const report = { title: '浙江壹品慧九月经营分析', status: 'draft' }
const scopeName = '杭州分公司'

describe('报告状态确认文案（FE-05）', () => {
  it('发布确认包含确切标题、当前→目标状态、真实可见范围与只读/分享边界', () => {
    const options = describeStatusAction(report, NEXT_STATUS.draft, scopeName)
    expect(options).not.toBeNull()
    expect(options!.title).toBe('发布报告')
    expect(options!.confirmText).toBe('发布')
    const text = options!.description!
    expect(text).toContain('浙江壹品慧九月经营分析')
    expect(text).toContain('由「草稿」变更为「已发布」')
    expect(text).toContain('可见范围不变')
    expect(text).toContain('拥有报告查看权限且数据范围覆盖「杭州分公司」的成员')
    expect(text).toContain('转为只读')
    expect(text).toContain('公开分享不会自动开启')
  })

  it('归档确认说明隐藏、不可编辑与分享链接失效', () => {
    const options = describeStatusAction({ ...report, status: 'published' }, NEXT_STATUS.published, scopeName)
    expect(options!.title).toBe('归档报告')
    const text = options!.description!
    expect(text).toContain('由「已发布」变更为「已归档」')
    expect(text).toContain('从默认列表隐藏')
    expect(text).toContain('已开启的公开分享链接将无法访问')
  })

  it('已发布撤回草稿确认说明公开链接失效', () => {
    const options = describeStatusAction({ ...report, status: 'published' }, EXTRA_STATUS.published[0], scopeName)
    expect(options!.title).toBe('撤回为草稿')
    const text = options!.description!
    expect(text).toContain('由「已发布」变更为「草稿」')
    expect(text).toContain('恢复可编辑')
    expect(text).toContain('公开分享链接将无法访问')
  })

  it('已归档恢复草稿属低风险可逆操作，不弹确认框', () => {
    expect(describeStatusAction({ ...report, status: 'archived' }, NEXT_STATUS.archived, scopeName)).toBeNull()
  })
})
