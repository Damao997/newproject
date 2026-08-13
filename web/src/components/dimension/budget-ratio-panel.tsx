import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { useBudgetRatio, useBudgetRatioMutation, useAvailablePeriods } from '@/hooks/api-queries'
import { formatMoneyWan, cn } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, Loader2, RotateCcw, Save } from 'lucide-react'

interface BudgetRatioPanelProps {
  canUpdate?: boolean
}

/** 预设月度占比（%）：财年 4月起顺序 4月3%、5月8%、6月11%、7月4%、8月7%、9月12%、10月7%、11月10%、12月13%、1月5%、2月8%、3月12% */
const DEFAULT_RATIOS = [3, 8, 11, 4, 7, 12, 7, 10, 13, 5, 8, 12]

const round2 = (n: number): number => Number(n.toFixed(2))

/** 年度预算按占比拆分（预览用，与后端 splitMonthlyBudget 同规则）：占比完整 12 项且总和≈100 时按占比拆分（末月余差），否则 /12 均摊 */
function splitMonthly(annual: number, ratios: number[]): number[] {
  const sum = ratios.reduce((s, r) => s + r, 0)
  const valid = ratios.length === 12 && ratios.every((r) => Number.isFinite(r) && r >= 0 && r <= 100) && Math.abs(Math.round(sum * 100) - 10000) <= 1
  if (!valid) return Array.from({ length: 12 }, () => round2(annual / 12))
  const out: number[] = []
  for (let i = 0; i < 12; i++) {
    if (i === 11) out.push(round2(annual - out.reduce((s, v) => s + v, 0)))
    else out.push(round2((annual * ratios[i]) / 100))
  }
  return out
}

/**
 * 预算月度占比配置面板（看板月度预算按占比拆分）：
 * 按财年维护 12 个月占比（总和恒 100%），自动读取该财年生效预算总额并按占比拆分各月预算金额；
 * 年度预算总额可手动覆盖用于即时预览（不落库）；保存后看板趋势图月度预算线按占比拆分。
 */
export function BudgetRatioPanel({ canUpdate = false }: BudgetRatioPanelProps) {
  // 财年候选：当前财年 ±3 年（与导入页目标财年候选口径一致），默认最新候选
  const { data: periodsData } = useAvailablePeriods()
  const currentFy = useMemo(() => {
    const startMonth = periodsData?.fiscalStartMonth ?? 1
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    return `FY${m >= startMonth ? y : y - 1}`
  }, [periodsData?.fiscalStartMonth])
  const fyOptions = useMemo(() => {
    const base = Number(currentFy.replace(/^FY/, ''))
    return [base + 1, base, base - 1, base - 2, base - 3].map((y) => `FY${y}`)
  }, [currentFy])
  const defaultFy = fyOptions[0]
  const [fiscalYear, setFiscalYear] = useState<string>(defaultFy)
  useEffect(() => { setFiscalYear(defaultFy) }, [defaultFy])

  const { data, isLoading } = useBudgetRatio(fiscalYear)
  const mutation = useBudgetRatioMutation()

  // 月份标签按财年起始月动态生成（4月…3月）
  const monthLabels = useMemo(() => {
    const startMonth = periodsData?.fiscalStartMonth ?? 4
    return Array.from({ length: 12 }, (_, i) => `${((startMonth - 1 + i) % 12) + 1}月`)
  }, [periodsData?.fiscalStartMonth])

  // 本地编辑状态：占比（字符串便于编辑）与年度总额覆盖（'' = 使用服务端生效总额）
  const [ratios, setRatios] = useState<string[]>(DEFAULT_RATIOS.map(String))
  const [annualInput, setAnnualInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  // 切换财年后同步服务端占比（编辑中不被刷新覆盖：仅按 fiscalYear 触发）
  useEffect(() => {
    if (data) {
      setRatios(data.ratios.map(String))
      setAnnualInput('')
      setError(null)
      setSavedMsg(null)
    }
  }, [data?.fiscalYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const ratioNums = useMemo(() => ratios.map((v) => Number(v)), [ratios])
  const ratioSum = useMemo(() => Math.round(ratioNums.reduce((s, r) => s + (Number.isFinite(r) ? r : 0), 0) * 100) / 100, [ratioNums])
  const hasInvalidRatio = ratios.some((v) => v.trim() !== '' && !Number.isFinite(Number(v)))
  const ratioOk = !hasInvalidRatio && ratioNums.length === 12 && ratioNums.every((r) => Number.isFinite(r) && r >= 0 && r <= 100) && Math.abs(ratioSum - 100) <= 0.01

  // 预览用年度总额：手动覆盖 > 服务端生效总额
  const annualTotal = useMemo(() => {
    const manual = annualInput.trim() === '' ? NaN : Number(annualInput)
    return Number.isFinite(manual) && manual >= 0 ? manual : (data?.annualTotal ?? 0)
  }, [annualInput, data?.annualTotal])
  const monthlyAmounts = useMemo(
    () => (annualTotal > 0 ? splitMonthly(annualTotal, ratioNums) : (data?.monthlyAmounts ?? [])),
    [annualTotal, ratioNums, data?.monthlyAmounts],
  )

  const setRatioAt = useCallback((i: number, v: string) => {
    setRatios((prev) => prev.map((x, idx) => (idx === i ? v : x)))
    setSavedMsg(null)
  }, [])

  // 月度占比行数据（label + index 双驱动，render 内读取 ratios/monthlyAmounts/ratioNums）
  const ratioRows = monthLabels.map((label, index) => ({ label, index }))
  const ratioColumns: DataTableColumn<(typeof ratioRows)[number]>[] = useMemo(() => [
    { key: 'label', header: '月份', cellClassName: 'font-medium text-foreground' },
    {
      key: 'ratio', header: '预算占比（%）', align: 'right',
      render: ({ label, index }) => (
        <Input
          className="ml-auto h-7 w-[90px] text-right font-num"
          type="number"
          min={0}
          max={100}
          step="0.01"
          value={ratios[index]}
          onChange={(e) => setRatioAt(index, e.target.value)}
          disabled={!canUpdate}
          aria-label={`${label}预算占比`}
        />
      ),
    },
    {
      key: 'amount', header: '拆分金额（万元）', align: 'right', cellClassName: 'font-num text-foreground',
      render: ({ index }) => {
        const amount = monthlyAmounts[index]
        return amount === null || amount === undefined ? <span className="text-muted-foreground">—</span> : formatMoneyWan(amount)
      },
    },
    {
      key: 'split', header: '拆分占比', align: 'right',
      render: ({ index }) => {
        const amount = monthlyAmounts[index]
        const r = ratioNums[index]
        const validR = Number.isFinite(r) && r >= 0 && r <= 100
        return (
          <span className={cn('font-num', validR && amount ? 'text-muted-foreground' : 'text-muted-foreground/50')}>
            {validR ? `${Math.round(r * 100) / 100}%` : '—'}
          </span>
        )
      },
    },
  ], [ratios, setRatioAt, canUpdate, monthlyAmounts, ratioNums])

  const handleReset = () => {
    setRatios(DEFAULT_RATIOS.map(String))
    setError(null)
    setSavedMsg(null)
  }

  const handleSave = async () => {
    if (!ratioOk) {
      setError('占比校验不通过：12 个月占比须为 0-100 的数值且总和为 100%')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await mutation.update.mutateAsync({ fiscalYear, ratios: ratioNums })
      setSavedMsg(`FY${fiscalYear.replace(/^FY/, '')} 财年月度占比已保存，看板月度预算将按新占比拆分。`)
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      {/* 说明 + 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted-foreground">
          维护看板月度预算的占比分配：年度预算总额按占比拆分到财年各月（趋势图月度预算线与月度达成率同步采用该口径）。
          占比之和必须恒为 100%；未配置的财年使用预设占比（4月3%…3月12%）。年度预算总额自动读取该财年生效预算，可手动输入覆盖用于即时预览。
        </p>
        <div className="flex shrink-0 items-center gap-2">
          {canUpdate && (
            <Button variant="outline" size="sm" onClick={handleReset} title="恢复为预设占比（4月3%…3月12%，保存后生效）">
              <RotateCcw className="mr-2 h-4 w-4" />
              恢复默认占比
            </Button>
          )}
          {canUpdate && (
            <Button size="sm" onClick={handleSave} disabled={saving || !ratioOk}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              保存占比
            </Button>
          )}
        </div>
      </div>

      {/* 财年 + 年度预算总额 */}
      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-muted/20 p-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">财年</Label>
          <Select value={fiscalYear} onValueChange={(v) => setFiscalYear(v)}>
            <SelectTrigger className="h-8 w-[120px]">
              <SelectValue placeholder="选择财年" />
            </SelectTrigger>
            <SelectContent>
              {fyOptions.map((fy) => (
                <SelectItem key={fy} value={fy}>{fy}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            年度预算总额（万元）{annualInput.trim() !== '' ? '· 手动覆盖（仅预览，不落库）' : ''}
          </Label>
          <Input
            className="h-8 w-[180px] font-num"
            type="number"
            min={0}
            step="0.01"
            value={annualInput}
            onChange={(e) => { setAnnualInput(e.target.value); setSavedMsg(null) }}
            placeholder={data ? formatMoneyWan(data.annualTotal) : '加载中…'}
            disabled={!canUpdate || isLoading}
          />
        </div>
        <p className="max-w-sm flex-1 text-xs text-muted-foreground">
          来源：{fiscalYear} 财年生效预算批次合计（全部公司全部科目）；未导入预算时为 0，可手动输入预览拆分效果。
        </p>
      </div>

      {/* 占比总和校验条 */}
      <div className={cn('flex items-center gap-2 rounded-lg border p-3 text-sm',
        ratioOk ? 'border-success/25 bg-success/10 text-success-strong' : 'border-destructive/25 bg-destructive/[0.06] text-destructive')}>
        {ratioOk ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
        <span>
          占比总和：<span className="font-num font-medium">{Number.isFinite(ratioSum) ? ratioSum : '-'}%</span>
          {ratioOk ? '（=100%，校验通过）' : `（须为 100%，当前差额 ${Number.isFinite(ratioSum) ? (Math.round((100 - ratioSum) * 100) / 100).toFixed(2) : '-'}%）`}
        </span>
      </div>

      {/* 12 个月占比 + 拆分金额 */}
      <DataTable
        columns={ratioColumns}
        data={ratioRows}
        rowKey={(r) => r.label}
        density="compact"
        caption="月度预算占比配置"
        footer={
          <tr className="border-t border-border bg-muted/30">
            <td className="px-3 py-2 font-medium">合计</td>
            <td className="px-3 py-2 text-right font-num font-medium">{Number.isFinite(ratioSum) ? `${ratioSum}%` : '—'}</td>
            <td className="px-3 py-2 text-right font-num font-medium">
              {monthlyAmounts.every((v) => v !== null && v !== undefined)
                ? formatMoneyWan(monthlyAmounts.reduce((s, v) => s + (v ?? 0), 0))
                : '—'}
            </td>
            <td className="px-3 py-2 text-right">
              <span className={cn('text-xs font-medium', ratioOk ? 'text-success-strong' : 'text-destructive')}>
                {ratioOk ? 'Σ=100%' : 'Σ≠100%'}
              </span>
            </td>
          </tr>
        }
      />

      {error && (
        <p className="flex items-center gap-1.5 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          {error}
        </p>
      )}
      {savedMsg && (
        <p className="flex items-center gap-1.5 text-xs text-success-strong">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {savedMsg}
        </p>
      )}
      {isLoading && <p className="text-xs text-muted-foreground">占比配置加载中…</p>}
    </div>
  )
}
