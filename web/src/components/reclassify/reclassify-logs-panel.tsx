import { useMemo, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useSubjects, useReclassifyLogs, useRevertReclassifyLog } from '@/hooks/api-queries'
import { useCompanyDisplayName } from '@/hooks/useCompanyDisplay'
import { formatMoney, formatQuantity, cn } from '@/lib/utils'
import { ArrowRight, Eye, RotateCcw, Undo2 } from 'lucide-react'
import { TYPE_LABEL, TEMPLATE_LABEL_SHORT, invalidationText } from './shared'
import type { ReclassifyLog } from '@/types'

interface ReclassifyLogsPanelProps {
  /** 是否可执行撤销与跨公司重分类重新应用（data:reclassify:company 权限） */
  canRevert: boolean
  /** 是否可重新应用科目调整记录（data:reclassify:subject 权限） */
  canReapplySubject?: boolean
  /** 失效/已撤销记录「重新应用」：由父级按类型打开对应对话框并预填原参数 */
  onReapply?: (log: ReclassifyLog) => void
  /** 点击记录行打开只读详情对话框（预填原始操作参数） */
  onViewDetail?: (log: ReclassifyLog) => void
  /** 筛选行右侧的操作按钮区（科目调整/跨公司调整/年度预算调整等入口） */
  actions?: ReactNode
}

const PAGE_SIZE = 10

const TYPE_BADGE_CLASS: Record<string, string> = {
  company: 'border-transparent bg-info/10 text-info',
  subject: 'border-transparent bg-secondary text-secondary-foreground',
  subject_adjust: 'border-transparent bg-warning/15 text-warning-strong',
}

const TRANSFER_MODE_LABEL: Record<string, string> = {
  all: '整体迁移',
  ratio: '按比例',
  amount: '按金额',
}

const ADJUST_MODE_LABEL: Record<string, string> = {
  both: '双向',
  decrease: '仅调减',
  increase: '仅调增',
}

/** 分型金额展示：数量类整数（无“万”），其余按金额（万元）；历史记录无 valueType 回退金额 */
const formatByType = (v: number, valueType?: string): string => (valueType === 'quantity' ? formatQuantity(v) : formatMoney(v))

/** 「源 → 目标」结构化展示：优先中文名称（title 提示编码），无匹配回退编码 */
function SourceTarget({ log, nameOf }: { log: ReclassifyLog; nameOf: (code: string | null) => string | null }) {
  const [source, target] =
    log.type === 'company'
      ? [log.sourceCompany, log.targetCompany]
      : [log.sourceSubject, log.targetSubject]
  const renderSide = (code: string | null, emptyText: string) => {
    if (!code) return <span className="text-xs text-muted-foreground">{emptyText}</span>
    const name = nameOf(code)
    return name
      ? <span className="text-xs" title={code}>{name}</span>
      : <span className="font-mono text-xs">{code}</span>
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      {renderSide(source, log.type === 'subject_adjust' ? '仅调增' : '-')}
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
      {renderSide(target, log.type === 'subject_adjust' ? '仅调减' : '-')}
      {log.templateType && (
        <span className="text-xs text-muted-foreground">（{TEMPLATE_LABEL_SHORT[log.templateType] ?? log.templateType}）</span>
      )}
    </span>
  )
}

/** 「金额明细」列：按类型展示转移方式/金额或调减调增净变动 */
function AmountDetail({ log }: { log: ReclassifyLog }) {
  const d = log.detail
  if (log.type === 'company') {
    if (!d?.transferMode) return <span className="text-muted-foreground">-</span>
    return (
      <span className="inline-flex items-center gap-1.5 text-xs">
        <span className="text-muted-foreground">{TRANSFER_MODE_LABEL[d.transferMode] ?? d.transferMode}{d.transferMode === 'ratio' && d.ratio ? ` ${Math.round(d.ratio * 10000) / 100}%` : ''}</span>
        {d.transferValue !== undefined && <span className="font-num font-medium">{formatMoney(d.transferValue)}</span>}
      </span>
    )
  }
  if (log.type === 'subject_adjust' && d) {
    const net = d.netChange ?? 0
    const modeLabel = d.adjustMode ? ADJUST_MODE_LABEL[d.adjustMode] : null
    return (
      <span className="inline-flex items-center gap-1.5 font-num text-xs">
        {modeLabel && <span className="text-muted-foreground">{modeLabel}</span>}
        {(d.decreaseAmount ?? 0) > 0 && <span className="text-destructive">-{formatByType(d.decreaseAmount ?? 0, d.valueType)}</span>}
        {(d.increaseAmount ?? 0) > 0 && <span className="text-success-strong">+{formatByType(d.increaseAmount ?? 0, d.valueType)}</span>}
        <span className={cn(net !== 0 ? 'text-warning-strong' : 'text-muted-foreground')}>（净 {formatByType(net, d.valueType)}）</span>
      </span>
    )
  }
  return <span className="text-muted-foreground">-</span>
}

/**
 * 重分类记录面板（内嵌于数据管理页）：分页展示跨公司/科目归类/科目调整历史，
 * 行点击或操作列「查看」打开只读详情；含快照的记录支持一键撤销（逆向恢复事实行）。
 */
export function ReclassifyLogsPanel({ canRevert, canReapplySubject = false, onReapply, onViewDetail, actions, stickyTop = 0 }: ReclassifyLogsPanelProps & { stickyTop?: number }) {
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [message, setMessage] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()
  const { data, isFetching } = useReclassifyLogs({ page, pageSize: PAGE_SIZE, type: type === 'all' ? undefined : type })
  const revertMutation = useRevertReclassifyLog()

  // 源/目标中文名称映射：公司（跟随「显示简称」开关，无简称回退全称）+ 经营/静态/现金流科目（无匹配时回退编码展示）
  const { displayNameMap } = useCompanyDisplayName()
  const { data: operatingSubjects } = useSubjects({ type: 'operating', pageSize: 1000 })
  const { data: staticSubjects } = useSubjects({ type: 'static', pageSize: 1000 })
  const { data: cashflowSubjects } = useSubjects({ type: 'cashflow', pageSize: 1000 })
  const nameMap = useMemo(() => {
    const m = new Map<string, string>()
    for (const [code, name] of displayNameMap) m.set(code, name)
    for (const s of operatingSubjects?.items ?? []) m.set(s.code, s.name)
    for (const s of staticSubjects?.items ?? []) m.set(s.code, s.name)
    for (const s of cashflowSubjects?.items ?? []) m.set(s.code, s.name)
    return m
  }, [displayNameMap, operatingSubjects, staticSubjects, cashflowSubjects])
  const nameOf = (code: string | null) => (code ? (nameMap.get(code) ?? null) : null)

  const items = (data?.items ?? []) as ReclassifyLog[]
  const total = data?.total ?? 0

  const handleRevert = async (log: ReclassifyLog) => {
    const ok = await confirm({
      title: '撤销重分类',
      description: `将按操作快照逆向恢复本次${TYPE_LABEL[log.type] ?? log.type}（${new Date(log.createdAt).toLocaleString('zh-CN')}，影响 ${log.affectedRows} 行）涉及的事实数据，看板与指标将即时刷新。确认撤销？`,
      danger: true,
      confirmText: '确认撤销',
    })
    if (!ok) return
    setMessage(null)
    try {
      const res = await revertMutation.mutateAsync(log.id)
      setMessage(`撤销完成：已恢复 ${res.restoredRows} 条明细。`)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '撤销失败')
    }
  }

  const columns: DataTableColumn<ReclassifyLog>[] = [
    { key: 'createdAt', header: '时间', cellClassName: 'whitespace-nowrap text-muted-foreground', render: (r) => new Date(r.createdAt).toLocaleString('zh-CN') },
    {
      key: 'type', header: '类型',
      render: (r) => <Badge variant="outline" className={TYPE_BADGE_CLASS[r.type]}>{TYPE_LABEL[r.type] ?? r.type}</Badge>,
    },
    { key: 'target', header: '源 → 目标', render: (r) => <SourceTarget log={r} nameOf={nameOf} /> },
    { key: 'period', header: '期间', cellClassName: 'font-num text-xs', render: (r) => r.period ?? (r.periodFrom ? `${r.periodFrom}~${r.periodTo ?? ''}` : '全部') },
    { key: 'amount', header: '金额明细', render: (r) => <AmountDetail log={r} /> },
    {
      key: 'affectedRows', header: '影响行数', align: 'right', cellClassName: 'font-num',
      render: (r) => (r.type === 'subject' ? '-' : r.affectedRows),
    },
    // 操作人列宽固定 12 个英文字符（约 6 个汉字）：用户名正常展示，UUID 等长值截断省略，hover 见全称
    { key: 'operator', header: '操作人', render: (r) => (
      <span className="block max-w-[12ch] truncate" title={r.operator}>{r.operator}</span>
    ) },
    {
      key: 'status', header: '状态',
      render: (r) => r.revertedAt
        ? <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">已撤销</Badge>
        : r.invalidatedAt
          ? <Badge variant="outline" title={invalidationText(r)} className="border-transparent bg-destructive/10 text-destructive">已失效</Badge>
          : <Badge variant="outline" className="border-transparent bg-success/10 text-success-strong">已生效</Badge>,
    },
  ]
  // 操作列恒渲染：查看入口对所有用户可见（含无撤销/重新应用权限者）；撤销/重新应用按权限与记录状态显示
  columns.push({
    key: 'actions', header: '操作', align: 'right',
    render: (r) => (
      <div className="flex items-center justify-end gap-1">
        <Button
          variant="ghost"
          size="sm"
          title="查看调整明细（只读）"
          aria-label="查看调整明细"
          onClick={(e) => { e.stopPropagation(); onViewDetail?.(r) }}
        >
          <Eye className="h-4 w-4" />
        </Button>
        {canRevert && r.revertible ? (
          <Button
            variant="ghost"
            size="sm"
            title="撤销本次调整（逆向恢复）"
            disabled={revertMutation.isPending}
            onClick={(e) => { e.stopPropagation(); handleRevert(r) }}
          >
            <Undo2 className="mr-1 h-4 w-4" />
            撤销
          </Button>
        ) : (r.invalidatedAt || r.revertedAt) && (r.type === 'company' || r.type === 'subject_adjust') && !(r.type === 'company' && r.templateType === 'budget') && onReapply
          && (r.type === 'company' ? canRevert : canReapplySubject) ? (
          // 重新应用：提交后更新原日志记录状态为已生效（不新建记录）；
          // 历史「跨公司+预算」日志（旧月度口径）已无对应编辑入口，仅保留只读查看
          <Button
            variant="ghost"
            size="sm"
            title="在最新数据上重新执行本次调整（参数可修改，更新原记录状态，不新建记录）"
            onClick={(e) => { e.stopPropagation(); onReapply(r) }}
          >
            <RotateCcw className="mr-1 h-4 w-4" />
            重新应用
          </Button>
        ) : canRevert ? (
          <span className="text-xs text-muted-foreground">{r.revertedAt ? '已撤销' : '不可撤销'}</span>
        ) : null}
      </div>
    ),
  })

  return (
    <div className="flex min-h-0 flex-1 flex-col space-y-2">
      {/* 筛选工具条（吸顶） */}
      <Card className="sticky z-10 shrink-0 rounded-card px-4 py-2.5" style={{ top: stickyTop }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">类型:</span>
          <Select value={type} onValueChange={(v) => { setType(v); setPage(1) }}>
            <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="company">跨公司</SelectItem>
              <SelectItem value="subject">科目归类</SelectItem>
              <SelectItem value="subject_adjust">科目调整</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      </Card>

      {message && <p className="shrink-0 text-xs text-muted-foreground">{message}</p>}

      <DataTable
        columns={columns}
        data={items}
        rowKey={(r) => r.id}
        density="compact"
        emptyText={isFetching ? '加载中…' : '暂无重分类记录'}
        onRowClick={(r) => onViewDetail?.(r)}
        maxHeight={`calc(100dvh - ${stickyTop}px - 24px)`}
      />
      <Pagination className="shrink-0" page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      {confirmElement}
    </div>
  )
}
