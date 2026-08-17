import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { usePageStore } from '@/stores/pageStateStore'
import { useCompanies, useSubjects } from '@/hooks/api-queries'
import { ReclassifyCompanyDialog } from '@/components/reclassify/reclassify-company-dialog'
import { ReclassifySubjectDialog } from '@/components/reclassify/reclassify-subject-dialog'
import { BudgetAdjustDialog } from '@/components/reclassify/budget-adjust-dialog'
import { ReclassifyLogsPanel } from '@/components/reclassify/reclassify-logs-panel'
import { TEMPLATE_LABEL, ReadonlyLogMeta, SectionTitle, invalidationText, type PreviewStatItem, type ReclassifyLogMeta } from '@/components/reclassify/shared'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatMoney, formatQuantity } from '@/lib/utils'
import type { ReclassifyLog } from '@/types'
import { ArrowLeftRight, ArrowRight, CalendarRange, SlidersHorizontal } from 'lucide-react'

/**
 * 数据管理 · 重分类管理 → 单体公司调整：调整记录管理 + 数据调整入口。
 * 操作按钮与「类型」筛选同行（筛选在左、按钮在右）：
 * - 科目调整：同一公司内科目金额/数量调整；
 * - 跨公司调整：不同公司间的数据迁移/重分类；
 * - 年度预算调整：仅按财年（全年）整体调整预算数据。
 * 汇总抵消入口在「汇总主体调整」独立页面（/data/reclassify/consolidation）。
 * 对话框预填从数据预览筛选状态跨页读取（pageStateStore 全局共享）。
 */

/** 只读详情中的科目引用：优先中文名称（title 提示编码），根节点/无匹配回退特殊文案或编码 */
function SubjectRef({ code, nameOf }: { code: string | null; nameOf: (code: string | null) => string | null }) {
  if (!code) return <span className="text-muted-foreground">-</span>
  if (code === '(root)') return <span className="text-xs text-muted-foreground">根节点</span>
  const name = nameOf(code)
  return name
    ? <span className="text-xs" title={code}>{name}</span>
    : <span className="font-mono text-xs">{code}</span>
}

export default function DataReclassifyPage() {
  const { can } = usePermission()
  const { headerRef, headerHeight } = useStickyHeader()
  const canReclassifyCompany = can('data:reclassify', 'company')
  const canReclassifySubject = can('data:reclassify', 'subject')

  // 数据编辑入口：复用重分类/科目调整通道（校验、预览影响、二次确认、审计留痕均在对话框内）
  const [adjustSubjectOpen, setAdjustSubjectOpen] = useState(false)
  const [reclassifyCompanyOpen, setReclassifyCompanyOpen] = useState(false)
  // 年度预算调整（仅作用于 budget 模板，按财年整体调整，不拆分月份）
  const [budgetAdjustOpen, setBudgetAdjustOpen] = useState(false)
  // 重分类记录「重新应用」目标：失效/已撤销日志 → 打开对应对话框并预填原参数（key 重挂载生效）
  const [reapplyLog, setReapplyLog] = useState<ReclassifyLog | null>(null)
  // 重分类记录「只读查看」目标：点击记录行 → 打开预填原始参数的只读详情对话框
  const [viewLog, setViewLog] = useState<ReclassifyLog | null>(null)

  // 对话框预填：跨页读取数据预览筛选状态（仅选 1 家公司时预填该公司）
  const browseSubjectType = usePageStore((s) => s.dataBrowse.subjectType)
  const browseCompanies = usePageStore((s) => s.dataBrowse.companies)
  const singleBrowseCompany = browseCompanies.length === 1 ? browseCompanies[0] : undefined

  // 只读详情名称映射：公司 + 经营/静态科目（无匹配时回退编码展示）
  const { data: companies } = useCompanies()
  const { data: operatingSubjects } = useSubjects({ type: 'operating', pageSize: 1000 })
  const { data: staticSubjects } = useSubjects({ type: 'static', pageSize: 1000 })
  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of companies ?? []) m.set(c.code, c.name)
    for (const s of operatingSubjects?.items ?? []) m.set(s.code, s.name)
    for (const s of staticSubjects?.items ?? []) m.set(s.code, s.name)
    return m
  }, [companies, operatingSubjects, staticSubjects])
  const nameOf = (code: string | null) => (code ? (nameMap.get(code) ?? null) : null)

  /** 分型金额展示：数量类整数（无“万”），其余按金额（万元）；历史记录无 valueType 回退金额 */
  const formatByType = (v: number, valueType?: string): string => (valueType === 'quantity' ? formatQuantity(v) : formatMoney(v))

  /** 只读详情「执行结果」：从日志 detail 还原当时的执行结果统计（无匹配数据返回 undefined） */
  const resultOf = (l: ReclassifyLog): PreviewStatItem[] | undefined => {
    const d = l.detail
    if (l.type === 'company' && d?.transferMode) {
      const items: PreviewStatItem[] = []
      if (d.transferMode === 'all') {
        items.push({ label: '迁移明细', value: `${l.affectedRows} 条` })
        if (d.transferValue !== undefined) items.push({ label: '合计金额', value: formatMoney(d.transferValue), tone: 'primary' })
      } else {
        items.push({ label: '匹配明细', value: `${l.affectedRows} 条` })
        if (d.transferValue !== undefined) items.push({ label: '转移金额', value: formatMoney(d.transferValue), tone: 'primary' })
        if ((d.mergedRows ?? 0) > 0) items.push({ label: '累加到现有行', value: `${d.mergedRows} 条` })
      }
      if ((d.createdRows ?? 0) > 0) items.push({ label: '新建明细行', value: `${d.createdRows} 条` })
      return items
    }
    if (l.type === 'subject_adjust' && d) {
      const qty = d.valueType === 'quantity'
      const items: PreviewStatItem[] = [{ label: '源科目匹配', value: `${l.affectedRows} 条` }]
      if ((d.decreaseAmount ?? 0) > 0) items.push({ label: qty ? '调减数量' : '调减金额', value: `-${formatByType(d.decreaseAmount ?? 0, d.valueType)}`, tone: 'primary' })
      if ((d.increaseAmount ?? 0) > 0) items.push({ label: qty ? '调增数量' : '调增金额', value: `+${formatByType(d.increaseAmount ?? 0, d.valueType)}`, tone: 'primary' })
      if (d.netChange !== undefined) items.push({ label: '净变动', value: formatByType(d.netChange, d.valueType), tone: d.netChange !== 0 ? 'warning' : 'default' })
      if ((d.createdRows ?? 0) > 0) items.push({ label: '新建明细行', value: `${d.createdRows} 条` })
      return items
    }
    return undefined
  }

  return (
    <PageContainer title="单体公司调整" stickyHeader headerRef={headerRef}>
      <ReclassifyLogsPanel
        canRevert={canReclassifyCompany}
        stickyTop={headerHeight}
        actions={
          <>
            {canReclassifySubject && (
              <Button variant="outline" size="sm" aria-label="科目调整" onClick={() => setAdjustSubjectOpen(true)}>
                <SlidersHorizontal className="mr-2 h-4 w-4" />
                科目调整
              </Button>
            )}
            {canReclassifyCompany && (
              <Button variant="outline" size="sm" aria-label="跨公司调整" onClick={() => setReclassifyCompanyOpen(true)}>
                <ArrowLeftRight className="mr-2 h-4 w-4" />
                跨公司调整
              </Button>
            )}
            {canReclassifySubject && (
              <Button variant="outline" size="sm" aria-label="年度预算调整" onClick={() => setBudgetAdjustOpen(true)}>
                <CalendarRange className="mr-2 h-4 w-4" />
                年度预算调整
              </Button>
            )}
          </>
        }
        onReapply={(log) => {
          setReapplyLog(log)
          if (log.type === 'company') setReclassifyCompanyOpen(true)
          else if (log.templateType === 'budget') setBudgetAdjustOpen(true)
          else setAdjustSubjectOpen(true)
        }}
        onViewDetail={(log) => {
          // 只读查看：设置目标日志并打开对应只读对话框（subject 类型由独立只读 Dialog 控制）
          setViewLog(log)
          if (log.type === 'company') setReclassifyCompanyOpen(true)
          else if (log.templateType === 'budget') setBudgetAdjustOpen(true)
          else if (log.type === 'subject_adjust') setAdjustSubjectOpen(true)
        }}
      />

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
              preset={log?.type === 'subject_adjust' && log.templateType !== 'budget' ? {
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
              result={viewLog ? resultOf(viewLog) : undefined}
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
              result={viewLog ? resultOf(viewLog) : undefined}
            />

            {/* 年度预算调整（仅全年维度；编辑/重新应用/只读查看共用） */}
            <BudgetAdjustDialog
              key={`budget-${singleBrowseCompany ?? 'all'}-${log?.id ?? 'none'}`}
              open={budgetAdjustOpen}
              onClose={() => { setBudgetAdjustOpen(false); closeLog() }}
              defaultCompany={singleBrowseCompany}
              preset={log?.type === 'subject_adjust' && log.templateType === 'budget' ? {
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
              result={viewLog ? resultOf(viewLog) : undefined}
            />

            {/* 科目归类（换父）记录：无调整表单，仅只读展示操作留痕（调整科目/旧父→新父/分类变更） */}
            <Dialog open={!!viewLog && viewLog.type === 'subject'} onOpenChange={(o) => !o && setViewLog(null)}>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>科目归类调整详情</DialogTitle>
                  <DialogDescription>科目归类调整（换父）在科目树中执行，此处展示操作留痕</DialogDescription>
                  {viewLog?.type === 'subject' && <ReadonlyLogMeta meta={metaOf(viewLog)} />}
                </DialogHeader>
                <div className="space-y-4">
                  <section className="space-y-2">
                    <SectionTitle>调整信息</SectionTitle>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>模板类型</Label>
                        <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                          {viewLog?.templateType ? (TEMPLATE_LABEL[viewLog.templateType] ?? viewLog.templateType) : '科目体系'}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label>调整科目</Label>
                        <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                          {viewLog?.detail?.subjectCode ? (nameOf(viewLog.detail.subjectCode) ?? viewLog.detail.subjectCode) : '-'}
                        </div>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label>调整路径（旧父 → 新父）</Label>
                      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-1.5 text-sm">
                        <SubjectRef code={viewLog?.sourceSubject ?? null} nameOf={nameOf} />
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                        <SubjectRef code={viewLog?.targetSubject ?? null} nameOf={nameOf} />
                      </div>
                    </div>
                    {viewLog?.detail?.fromCategory !== undefined && viewLog?.detail?.toCategory !== undefined && (
                      <p className="text-xs text-muted-foreground">分类归属：{viewLog.detail.fromCategory} → {viewLog.detail.toCategory}</p>
                    )}
                  </section>
                  {viewLog?.invalidatedAt && (
                    <p className="text-xs text-destructive">{invalidationText(viewLog)}</p>
                  )}
                  <p className="text-sm text-muted-foreground">请在「维度/科目体系」的科目树中查看该科目的当前归属与调整历史。</p>
                </div>
                <DialogFooter className="gap-2 sm:gap-0">
                  <Button variant="outline" onClick={() => setViewLog(null)}>关闭</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )
      })()}
    </PageContainer>
  )
}
