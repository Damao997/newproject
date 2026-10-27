import type { ConfirmOptions } from '@/components/ui/confirm-dialog'
import { REPORT_STATUS_LABEL } from '@/lib/constants'
import type { ReportListItem } from '@/lib/api'

export type ReportStatus = 'draft' | 'published' | 'archived'

export interface StatusTarget {
  status: ReportStatus
  label: string
}

/** 主操作（卡片按钮）：draft→发布、published→归档、archived→恢复草稿 */
export const NEXT_STATUS: Record<string, StatusTarget> = {
  draft: { status: 'published', label: '发布' },
  published: { status: 'archived', label: '归档' },
  archived: { status: 'draft', label: '恢复为草稿' },
}

/** 次要状态操作（更多菜单）：published 支持撤回为草稿直达（后端状态机 draft↔published 本就允许） */
export const EXTRA_STATUS: Record<string, StatusTarget[]> = {
  published: [{ status: 'draft', label: '撤回为草稿' }],
}

/**
 * 按风险生成状态流转确认文案：
 * - 发布：影响可读范围语义（转只读、进入已发布、具备公开分享资格），必须确认；
 * - 归档：从默认列表隐藏且不可编辑、公开链接失效，必须确认；
 * - 已发布撤回草稿：公开链接立即失效，必须确认；
 * - 已归档恢复草稿：可逆且仅恢复编辑能力，直接执行并提示，不机械加弹框。
 * 可见范围按代码现状表述：报告列表按数据范围收敛，发布不改变成员可见性，公开链接需单独开启。
 */
export function describeStatusAction(report: Pick<ReportListItem, 'title' | 'status'>, target: StatusTarget, scopeName: string): ConfirmOptions | null {
  const current = REPORT_STATUS_LABEL[report.status] ?? report.status
  const targetLabel = REPORT_STATUS_LABEL[target.status] ?? target.label
  const change = `将「${report.title}」由「${current}」变更为「${targetLabel}」。`

  if (target.status === 'published') {
    return {
      title: '发布报告',
      description: `${change}发布后报告转为只读，需撤回为草稿才能继续编辑；可见范围不变，仍为拥有报告查看权限且数据范围覆盖「${scopeName}」的成员。公开分享不会自动开启，需在阅读页单独设置。`,
      confirmText: '发布',
    }
  }
  if (target.status === 'archived') {
    return {
      title: '归档报告',
      description: `${change}归档后报告从默认列表隐藏（可在「已归档」筛选中查看），且不可编辑；已开启的公开分享链接将无法访问。`,
      confirmText: '归档',
    }
  }
  if (report.status === 'published') {
    return {
      title: '撤回为草稿',
      description: `${change}撤回后报告恢复可编辑，并从已发布列表移除；已开启的公开分享链接将无法访问。`,
      confirmText: '撤回',
    }
  }
  return null
}
