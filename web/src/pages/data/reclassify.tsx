import { useState } from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { RECLASSIFY_TABS } from '@/components/layout/module-tabs'
import { Button } from '@/components/ui/button'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { formatMoney, formatQuantity } from '@/lib/utils'
import { ReclassifyLogsPanel } from '@/components/reclassify/reclassify-logs-panel'
import {
  ReclassifySubjectDialog,
  type ReclassifySubjectPreset,
} from '@/components/reclassify/reclassify-subject-dialog'
import {
  ReclassifyCompanyDialog,
  type ReclassifyCompanyPreset,
} from '@/components/reclassify/reclassify-company-dialog'
import { BudgetAdjustDialog, type BudgetAdjustPreset } from '@/components/reclassify/budget-adjust-dialog'
import type { PreviewStatItem, ReclassifyLogMeta } from '@/components/reclassify/shared'
import type { ReclassifyLog } from '@/types'
import { ArrowLeftRight, CalendarRange, SlidersHorizontal } from 'lucide-react'

/**
 * 数据管理 · 单体重分类：重分类日志面板 + 三类调整入口（科目调整 / 跨公司 / 预算调整）。
 * - 日志面板：分页筛选 + 只读详情 + 撤销（revert）+ 重新应用（预填原参数）；
 * - 对话框均由本页持有状态（key 强制重挂载使 preset 生效）；
 * - 写权限：data:reclassify:subject（科目/预算调整）、data:reclassify:company（跨公司 + 撤销）。
 */

type DialogState =
  | { kind: 'subject'; preset?: ReclassifySubjectPreset; readonly?: boolean; meta?: ReclassifyLogMeta; result?: PreviewStatItem[] }
  | { kind: 'company'; preset?: ReclassifyCompanyPreset; readonly?: boolean; meta?: ReclassifyLogMeta; result?: PreviewStatItem[] }
  | { kind: 'budget'; preset?: BudgetAdjustPreset; readonly?: boolean; meta?: ReclassifyLogMeta; result?: PreviewStatItem[] }

/** 分型金额展示：数量类整数（无“万”），其余按金额（万元）；历史记录缺省按金额 */
const fmtByType = (v: number, valueType?: string): string => (valueType === 'quantity' ? formatQuantity(v) : formatMoney(v))

const metaOf = (log: ReclassifyLog): ReclassifyLogMeta => ({
  operator: log.operator,
  createdAt: log.createdAt,
  affectedRows: log.affectedRows,
  revertedAt: log.revertedAt,
  revertedBy: log.revertedBy,
  invalidatedAt: log.invalidatedAt,
  invalidatedReason: log.invalidatedReason,
  invalidation: log.invalidation,
})

/** 只读详情还原的执行结果统计（来自日志 detail） */
const resultOf = (log: ReclassifyLog): PreviewStatItem[] => {
  const d = log.detail
  if (!d) return []
  if (log.type === 'company') {
    if ((d.transferMode ?? 'all') === 'all') {
      return [
        { label: '迁移明细', value: `${log.affectedRows} 条` },
        { label: '合并求和', value: `${d.mergedRows ?? 0} 条` },
      ]
    }
    return [
      { label: '匹配明细', value: `${log.affectedRows} 条` },
      { label: '转移金额', value: formatMoney(d.transferValue ?? 0), tone: 'primary' },
      { label: '累加到现有行', value: `${d.mergedRows ?? 0} 条` },
      { label: '新建明细行', value: `${d.createdRows ?? 0} 条` },
    ]
  }
  // subject_adjust（含预算调整）
  const vt = d.valueType
  return [
    { label: '影响明细行', value: `${log.affectedRows} 条` },
    ...(d.decreaseAmount ? [{ label: '调减', value: `-${fmtByType(d.decreaseAmount, vt)}` }] : []),
    ...(d.increaseAmount ? [{ label: '调增', value: `+${fmtByType(d.increaseAmount, vt)}` }] : []),
    { label: '净变动', value: fmtByType(d.netChange ?? 0, vt), tone: (d.netChange ?? 0) !== 0 ? 'warning' : 'default' },
  ]
}

export default function DataReclassifyPage() {
  const { headerRef, headerHeight } = useStickyHeader()
  const { can } = usePermission()
  // 与后端一致：科目/预算调整 → data:reclassify:subject；跨公司与撤销/汇总抵消 → data:reclassify:company
  const canSubject = can('data:reclassify', 'subject')
  const canCompany = can('data:reclassify', 'company')

  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [nonce, setNonce] = useState(0)
  const openDialog = (next: DialogState) => {
    setDialog(next)
    setNonce((n) => n + 1)
  }

  /** 失效/已撤销记录「重新应用」：按日志类型预填原参数（company+budget 旧月度口径无编辑入口，面板不会回调） */
  const handleReapply = (log: ReclassifyLog) => {
    const d = log.detail
    const period = log.period ?? log.periodFrom ?? ''
    if (log.type === 'company') {
      openDialog({
        kind: 'company',
        preset: {
          templateType: (log.templateType as 'operating' | 'static' | 'cashflow') ?? 'operating',
          sourceCompanyCode: log.sourceCompany ?? '',
          targetCompanyCode: log.targetCompany ?? '',
          transferMode: d?.transferMode ?? 'all',
          ratio: d?.ratio ?? undefined,
          amount: d?.amount ?? undefined,
          period,
          accountCodes: d?.accountCodes ?? [],
        },
      })
      return
    }
    if (log.type === 'subject_adjust' && log.templateType === 'budget') {
      openDialog({
        kind: 'budget',
        preset: {
          companyCode: log.sourceCompany ?? '',
          adjustMode: d?.adjustMode ?? 'both',
          sourceAccountCode: log.sourceSubject,
          targetAccountCode: log.targetSubject,
          decreaseAmount: d?.decreaseAmount,
          increaseAmount: d?.increaseAmount,
          period,
          reason: d?.reason,
        },
      })
      return
    }
    if (log.type === 'subject_adjust') {
      openDialog({
        kind: 'subject',
        preset: {
          templateType: (log.templateType as 'operating' | 'static' | 'cashflow' | 'budget') ?? 'operating',
          companyCode: log.sourceCompany ?? '',
          adjustMode: d?.adjustMode ?? 'both',
          sourceAccountCode: log.sourceSubject,
          targetAccountCode: log.targetSubject,
          decreaseAmount: d?.decreaseAmount,
          increaseAmount: d?.increaseAmount,
          period,
          reason: d?.reason,
        },
      })
    }
  }

  /** 行点击/「查看」打开只读详情（预填原始参数、禁止提交）；科目归类（subject）无对应对话框，不响应 */
  const handleViewDetail = (log: ReclassifyLog) => {
    const supported =
      (log.type === 'company' && log.templateType !== 'budget')
      || log.type === 'subject_adjust'
    if (!supported) return
    if (log.type === 'subject_adjust' && log.templateType === 'budget') {
      openDialog({ kind: 'budget', readonly: true, meta: metaOf(log), result: resultOf(log) })
      return
    }
    if (log.type === 'company') {
      openDialog({ kind: 'company', readonly: true, meta: metaOf(log), result: resultOf(log) })
      return
    }
    openDialog({ kind: 'subject', readonly: true, meta: metaOf(log), result: resultOf(log) })
  }

  return (
    <PageContainer
      title="单体重分类"
      description="对单一主体的科目、跨公司、预算进行调整与重分类，保留完整调整记录"
      stickyHeader
      headerRef={headerRef}
    >
      <SubPageTabs items={RECLASSIFY_TABS} />

      <ReclassifyLogsPanel
        canRevert={canCompany}
        stickyTop={headerHeight}
        onReapply={handleReapply}
        onViewDetail={handleViewDetail}
        actions={
          <>
            {canSubject && (
              <Button variant="outline" size="sm" onClick={() => openDialog({ kind: 'subject' })}>
                <SlidersHorizontal className="mr-1.5 h-4 w-4" />
                科目调整
              </Button>
            )}
            {canSubject && (
              <Button variant="outline" size="sm" onClick={() => openDialog({ kind: 'budget' })}>
                <CalendarRange className="mr-1.5 h-4 w-4" />
                预算调整
              </Button>
            )}
            {canCompany && (
              <Button variant="outline" size="sm" onClick={() => openDialog({ kind: 'company' })}>
                <ArrowLeftRight className="mr-1.5 h-4 w-4" />
                跨公司调整
              </Button>
            )}
          </>
        }
      />

      {/* key 强制重挂载：对话框以 preset 初始化内部状态，重新应用/只读查看每次全新挂载 */}
      {dialog?.kind === 'subject' && (
        <ReclassifySubjectDialog
          key={nonce}
          open
          onClose={() => setDialog(null)}
          preset={dialog.preset}
          readonly={dialog.readonly}
          meta={dialog.meta}
          result={dialog.result}
        />
      )}
      {dialog?.kind === 'company' && (
        <ReclassifyCompanyDialog
          key={nonce}
          open
          onClose={() => setDialog(null)}
          preset={dialog.preset}
          readonly={dialog.readonly}
          meta={dialog.meta}
          result={dialog.result}
        />
      )}
      {dialog?.kind === 'budget' && (
        <BudgetAdjustDialog
          key={nonce}
          open
          onClose={() => setDialog(null)}
          preset={dialog.preset}
          readonly={dialog.readonly}
          meta={dialog.meta}
          result={dialog.result}
        />
      )}
    </PageContainer>
  )
}
