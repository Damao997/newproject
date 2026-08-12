import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PageContainer } from '@/components/layout/page-container'
import { usePermission } from '@/hooks/usePermission'
import { usePageStore } from '@/stores/pageStateStore'
import { ReclassifyCompanyDialog } from '@/components/reclassify/reclassify-company-dialog'
import { ReclassifySubjectDialog } from '@/components/reclassify/reclassify-subject-dialog'
import { ReclassifyLogsPanel } from '@/components/reclassify/reclassify-logs-panel'
import { ReadonlyLogMeta, type ReclassifyLogMeta } from '@/components/reclassify/shared'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { ReclassifyLog } from '@/types'
import { ConsolidationAdjustDialog } from '@/components/reclassify/consolidation-adjust-dialog'
import { ArrowLeftRight } from 'lucide-react'

/** 数据调整入口（科目调整 / 跨公司重分类 / 汇总抵消）：按权限码显隐 */
function ReclassifyMenu({ canSubject, canCompany, onSubject, onCompany, onConsolidation }: {
  canSubject: boolean
  canCompany: boolean
  onSubject: () => void
  onCompany: () => void
  onConsolidation: () => void
}) {
  if (!canSubject && !canCompany) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" aria-label="数据调整">
          <ArrowLeftRight className="mr-2 h-4 w-4" />
          数据调整
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {canSubject && (
          <DropdownMenuItem onClick={onSubject}>科目调整</DropdownMenuItem>
        )}
        {canCompany && (
          <DropdownMenuItem onClick={onCompany}>跨公司重分类</DropdownMenuItem>
        )}
        {canCompany && (
          <DropdownMenuItem onClick={onConsolidation}>汇总抵消调整</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * 数据管理 · 重分类管理：重分类/科目调整记录管理 + 数据调整入口
 * （科目调整/跨公司重分类/汇总抵消调整对话框）。
 * 汇总抵消调整记录在 /data/reclassify/consolidation 独立页面。
 * 对话框预填从数据预览筛选状态跨页读取（pageStateStore 全局共享，与拆分前行为一致）。
 */
export default function DataReclassifyPage() {
  const { can } = usePermission()
  const canReclassifyCompany = can('data:reclassify', 'company')
  const canReclassifySubject = can('data:reclassify', 'subject')

  // 数据编辑入口：复用重分类/科目调整通道（校验、预览影响、二次确认、审计留痕均在对话框内）
  const [adjustSubjectOpen, setAdjustSubjectOpen] = useState(false)
  const [reclassifyCompanyOpen, setReclassifyCompanyOpen] = useState(false)
  // 重分类记录「重新应用」目标：失效/已撤销日志 → 打开对应对话框并预填原参数（key 重挂载生效）
  const [reapplyLog, setReapplyLog] = useState<ReclassifyLog | null>(null)
  // 重分类记录「只读查看」目标：点击记录行 → 打开预填原始参数的只读详情对话框
  const [viewLog, setViewLog] = useState<ReclassifyLog | null>(null)
  // 汇总抵消调整（仅作用于汇总主体口径，单体报表不受影响）
  const [consolidationOpen, setConsolidationOpen] = useState(false)

  // 对话框预填：跨页读取数据预览筛选状态（仅选 1 家公司时预填该公司）
  const browseSubjectType = usePageStore((s) => s.dataBrowse.subjectType)
  const browseCompanies = usePageStore((s) => s.dataBrowse.companies)
  const singleBrowseCompany = browseCompanies.length === 1 ? browseCompanies[0] : undefined

  return (
    <PageContainer title="重分类管理">
      <div className="space-y-4">
        <div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ReclassifyMenu
              canSubject={canReclassifySubject}
              canCompany={canReclassifyCompany}
              onSubject={() => setAdjustSubjectOpen(true)}
              onCompany={() => setReclassifyCompanyOpen(true)}
              onConsolidation={() => setConsolidationOpen(true)}
            />
          </div>
          <div className="mt-3">
            <ReclassifyLogsPanel
              canRevert={canReclassifyCompany}
              onReapply={(log) => {
                setReapplyLog(log)
                if (log.type === 'company') setReclassifyCompanyOpen(true)
                else setAdjustSubjectOpen(true)
              }}
              onViewDetail={(log) => setViewLog(log)}
            />
          </div>
        </div>
      </div>

      {/* 日志 → 对话框预填参数与只读元信息（company/subject_adjust 共用；subject 换父类型无表单参数） */}
      {(() => {
        const log = viewLog ?? reapplyLog
        const templateTypeOf = (l: ReclassifyLog): 'operating' | 'static' | 'budget' =>
          l.templateType === 'static' || l.templateType === 'budget' ? l.templateType : 'operating'
        const metaOf = (l: ReclassifyLog): ReclassifyLogMeta => ({
          operator: l.operator,
          createdAt: l.createdAt,
          affectedRows: l.affectedRows,
          revertedAt: l.revertedAt,
          revertedBy: l.revertedBy,
          invalidatedAt: l.invalidatedAt,
          invalidatedReason: l.invalidatedReason,
          invalidation: l.invalidation,
        })
        const closeLog = () => { setReapplyLog(null); setViewLog(null) }
        return (
          <>
            {/* 同公司科目间调整（编辑/重新应用/只读查看共用；key 重挂载使 preset 生效） */}
            <ReclassifySubjectDialog
              key={`adjust-${browseSubjectType}-${singleBrowseCompany ?? 'all'}-${log?.id ?? 'none'}`}
              open={adjustSubjectOpen}
              onClose={() => { setAdjustSubjectOpen(false); closeLog() }}
              defaultTemplateType={browseSubjectType}
              defaultCompany={singleBrowseCompany}
              preset={log?.type === 'subject_adjust' ? {
                templateType: templateTypeOf(log),
                companyCode: log.sourceCompany ?? '',
                adjustMode: log.detail?.adjustMode ?? 'both',
                sourceAccountCode: log.sourceSubject ?? undefined,
                targetAccountCode: log.targetSubject ?? undefined,
                decreaseAmount: log.detail?.decreaseAmount ?? undefined,
                increaseAmount: log.detail?.increaseAmount ?? undefined,
                period: log.period ?? log.periodFrom ?? '',
                reason: log.detail?.reason ?? '',
              } : undefined}
              readonly={!!viewLog}
              meta={viewLog ? metaOf(viewLog) : undefined}
            />

            {/* 跨公司重分类（编辑/重新应用/只读查看共用；key 重挂载使 preset 生效） */}
            <ReclassifyCompanyDialog
              key={`reclassify-${browseSubjectType}-${singleBrowseCompany ?? 'all'}-${log?.id ?? 'none'}`}
              open={reclassifyCompanyOpen}
              onClose={() => { setReclassifyCompanyOpen(false); closeLog() }}
              defaultTemplateType={browseSubjectType}
              defaultSourceCompany={singleBrowseCompany}
              preset={log?.type === 'company' ? {
                templateType: templateTypeOf(log),
                sourceCompanyCode: log.sourceCompany ?? '',
                targetCompanyCode: log.targetCompany ?? '',
                transferMode: log.detail?.transferMode ?? 'all',
                ratio: log.detail?.ratio ?? undefined,
                amount: log.detail?.amount ?? undefined,
                period: log.period ?? log.periodFrom ?? '',
                accountCodes: log.detail?.accountCodes ?? [],
              } : undefined}
              readonly={!!viewLog}
              meta={viewLog ? metaOf(viewLog) : undefined}
            />

            {/* 科目归类（换父）记录：无调整表单，仅只读展示操作留痕 */}
            <Dialog open={!!viewLog && viewLog.type === 'subject'} onOpenChange={(o) => !o && setViewLog(null)}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>科目归类调整详情</DialogTitle>
                  <DialogDescription>
                    科目归类调整（换父）在科目树中执行，此处仅展示操作留痕
                    {viewLog?.type === 'subject' && <ReadonlyLogMeta meta={metaOf(viewLog)} />}
                  </DialogDescription>
                </DialogHeader>
                <p className="text-sm text-muted-foreground">请在「维度/科目体系」的科目树中查看该科目的当前归属与调整历史。</p>
              </DialogContent>
            </Dialog>
          </>
        )
      })()}

      {/* 汇总抵消调整（仅作用于汇总主体口径，单体报表不受影响） */}
      <ConsolidationAdjustDialog
        open={consolidationOpen}
        onClose={() => setConsolidationOpen(false)}
      />
    </PageContainer>
  )
}
