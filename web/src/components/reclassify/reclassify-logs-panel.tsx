import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useCompanies, useSubjects, useReclassifyLogs, useRevertReclassifyLog } from '@/hooks/api-queries'
import { formatMoney, formatQuantity, cn } from '@/lib/utils'
import { ArrowRight, Undo2 } from 'lucide-react'
import { TYPE_LABEL, TEMPLATE_LABEL_SHORT } from './shared'
import type { ReclassifyLog } from '@/types'

interface ReclassifyLogsPanelProps {
  /** 是否可执行撤销（data:reclassify:company 权限） */
  canRevert: boolean
}

const PAGE_SIZE = 10

const TYPE_BADGE_CLASS: Record<string, string> = {
  company: 'border-transparent bg-blue-100 text-blue-800',
  subject: 'border-transparent bg-secondary text-secondary-foreground',
  subject_adjust: 'border-transparent bg-amber-100 text-amber-800',
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
        {(d.decreaseAmount ?? 0) > 0 && <span className="text-red-600">-{formatByType(d.decreaseAmount ?? 0, d.valueType)}</span>}
        {(d.increaseAmount ?? 0) > 0 && <span className="text-green-700">+{formatByType(d.increaseAmount ?? 0, d.valueType)}</span>}
        <span className={cn(net !== 0 ? 'text-amber-700' : 'text-muted-foreground')}>（净 {formatByType(net, d.valueType)}）</span>
      </span>
    )
  }
  return <span className="text-muted-foreground">-</span>
}

/** 行展开明细：调整期间、原因、合并/新建行数、撤销留痕等 */
function ExpandedDetail({ log }: { log: ReclassifyLog }) {
  const d = log.detail
  const period = log.period ?? (log.periodFrom || log.periodTo ? `${log.periodFrom ?? '不限'} ~ ${log.periodTo ?? '不限'}` : '全部期间')
  return (
    <div className="space-y-1 py-1 text-xs text-muted-foreground">
      <p>调整期间：{period}</p>
      {log.type === 'company' && d && (
        <p>
          合并 {d.mergedRows ?? 0} 行，新建 {d.createdRows ?? 0} 行
          {d.accountCodes && d.accountCodes.length > 0 && <>；筛选科目：{d.accountCodes.join('、')}</>}
        </p>
      )}
      {log.type === 'subject_adjust' && d && (
        <>
          <p>累加 {d.mergedRows ?? 0} 行，新建 {d.createdRows ?? 0} 行</p>
          {d.reason && <p className="text-foreground">调整原因：{d.reason}</p>}
        </>
      )}
      {log.revertedAt && (
        <p className="text-amber-700">已于 {new Date(log.revertedAt).toLocaleString('zh-CN')} 由 {log.revertedBy ?? '-'} 撤销。</p>
      )}
      {!d && <p>无更多明细（历史记录）。</p>}
    </div>
  )
}

/**
 * 重分类记录面板（内嵌于数据管理页）：分页展示跨公司/科目归类/科目调整历史，
 * 行点击展开查看原因与行数明细；含快照的记录支持一键撤销（逆向恢复事实行）。
 */
export function ReclassifyLogsPanel({ canRevert }: ReclassifyLogsPanelProps) {
  const [type, setType] = useState('all')
  const [page, setPage] = useState(1)
  const [expandedKeys, setExpandedKeys] = useState<Set<string | number>>(new Set())
  const [message, setMessage] = useState<string | null>(null)
  const { confirm, element: confirmElement } = useConfirm()
  const { data, isFetching } = useReclassifyLogs({ page, pageSize: PAGE_SIZE, type: type === 'all' ? undefined : type })
  const revertMutation = useRevertReclassifyLog()

  // 源/目标中文名称映射：公司 + 经营/静态科目（无匹配时回退编码展示）
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

  const items = (data?.items ?? []) as ReclassifyLog[]
  const total = data?.total ?? 0

  const toggleExpanded = (row: ReclassifyLog) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(row.id)) next.delete(row.id)
      else next.add(row.id)
      return next
    })
  }

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
    { key: 'operator', header: '操作人' },
    {
      key: 'status', header: '状态',
      render: (r) => r.revertedAt
        ? <Badge variant="outline" className="border-transparent bg-muted text-muted-foreground">已撤销</Badge>
        : <Badge variant="outline" className="border-transparent bg-green-100 text-green-800">已生效</Badge>,
    },
  ]
  if (canRevert) {
    columns.push({
      key: 'actions', header: '操作', align: 'right',
      render: (r) => r.revertible ? (
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
      ) : (
        <span className="text-xs text-muted-foreground">{r.revertedAt ? '已撤销' : '不可撤销'}</span>
      ),
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">类型:</span>
        <Select value={type} onValueChange={(v) => { setType(v); setPage(1); setExpandedKeys(new Set()) }}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="company">跨公司</SelectItem>
            <SelectItem value="subject">科目归类</SelectItem>
            <SelectItem value="subject_adjust">科目调整</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {message && <p className="text-xs text-muted-foreground">{message}</p>}

      <div className="overflow-x-auto">
        <DataTable
          columns={columns}
          data={items}
          rowKey={(r) => r.id}
          emptyText={isFetching ? '加载中...' : '暂无重分类记录'}
          onRowClick={toggleExpanded}
          expandedKeys={expandedKeys}
          renderExpanded={(r) => <ExpandedDetail log={r} />}
        />
      </div>
      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} />
      {confirmElement}
    </div>
  )
}
