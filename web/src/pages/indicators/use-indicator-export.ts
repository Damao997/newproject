import { useState } from 'react'
import { exportToExcel } from '@/lib/export'
import type { OperatingRow, StaticRow, CashflowRow } from '@/hooks/api-queries'
import { exportKeysFor, valueFormatterFor, type IndicatorSubjectType } from './indicators-adapters'

/** 前序展开为 {row, depth}（导出与 AI 预分析数据准备共用） */
export function flattenForExport<T extends { children?: T[] }>(rows: T[], depth = 0): { row: T; depth: number }[] {
  const out: { row: T; depth: number }[] = []
  for (const r of rows) {
    out.push({ row: r, depth })
    if (r.children && r.children.length > 0) out.push(...flattenForExport(r.children, depth + 1))
  }
  return out
}

type ExportRow = OperatingRow | StaticRow | CashflowRow

/** 指标导出：loading + 结果反馈状态（从 index.tsx 原样搬迁，行为零变化） */
export function useIndicatorExport(opts: {
  subjectType: IndicatorSubjectType
  /** 调用方提供当前筛选条件下的行（原 activeItems） */
  getRows: () => ExportRow[]
  /** 列设置中隐藏的列 key（导出跳过） */
  getHiddenColumns: () => string[]
  /** 文件名 scope 后缀（去重分类口径标识：'_原始口径' / ''） */
  getFilenameScope: () => string
}) {
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState<string | null>(null)
  const [exportErr, setExportErr] = useState<string | null>(null)

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setExportMsg(null)
    setExportErr(null)
    try {
      const pct = (v: number) => `${v.toFixed(1)}%`
      // 分型导出：比率列乘 100 加 %，数量取整，金额保持数值；同比统一按增长率百分比（后端已按增长率返回）
      const fmtVal = valueFormatterFor(opts.subjectType)
      const fmtYoy = (v: number) => pct(v)
      const flat = flattenForExport(opts.getRows())
      // 去重分类口径导出时文件名标识区分，避免与正式口径混淆
      const scopeSuffix = opts.getFilenameScope()
      if (opts.subjectType === 'operating') {
        // 导出列顺序与表格一致（达成率归累计组尾）；跳过列设置中隐藏的列
        const keys = exportKeysFor('operating').filter((k) => !opts.getHiddenColumns().includes(k))
        const rows = flat.map(({ row, depth }) => {
          const o = row as OperatingRow
          // 展示类（display）只读展示：导出值列统一写「—」，与 browse/后端 maskDisplayRows 口径对齐
          const cols: Record<string, string | number> = o.dataType === 'display'
            ? { budget: '—', actual: '—', samePeriod: '—', yoy: '—', ytd: '—', samePeriodYtd: '—', ytdYoy: '—', achievement: '—' }
            : { budget: fmtVal(o.budget, o.valueType), actual: fmtVal(o.actual, o.valueType), samePeriod: fmtVal(o.samePeriod, o.valueType),
                yoy: fmtYoy(o.yoy), ytd: fmtVal(o.ytd, o.valueType), samePeriodYtd: fmtVal(o.samePeriodYtd, o.valueType),
                ytdYoy: fmtYoy(o.ytdYoy), achievement: pct(o.achievement) }
          return { account: `${'　'.repeat(depth)}${o.name}`, ...Object.fromEntries(keys.map((k) => [k, cols[k]])) }
        })
        const headerMap: Record<string, string> = {
          budget: '预算金额(万)', actual: '本月实际(万)', samePeriod: '同期实际(万)', yoy: '同比',
          ytd: '本年累计(万)', samePeriodYtd: '同期累计(万)', ytdYoy: '累计同比', achievement: '达成率',
        }
        const filename = `财务指标_经营指标${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
        await exportToExcel({
          filename,
          sheetName: '经营指标',
          columns: [
            { header: '科目', key: 'account', width: 40 },
            ...keys.map((k) => ({ header: headerMap[k], key: k, width: (k === 'yoy' || k === 'ytdYoy' || k === 'achievement') ? 10 : 14 })),
          ],
          rows,
        })
        setExportMsg(`已导出：${filename}`)
      } else if (opts.subjectType === 'cashflow') {
        // 现金流量分支：本月/同期/本年累计/同期累计/同比，跳过隐藏列
        const keys = exportKeysFor('cashflow').filter((k) => !opts.getHiddenColumns().includes(k))
        const rows = flat.map(({ row, depth }) => {
          const f = row as CashflowRow
          // 展示类（display）只读展示：导出值列统一写「—」（口径同 browse/后端 maskDisplayRows）
          const cols: Record<string, string | number> = f.dataType === 'display'
            ? { actual: '—', samePeriod: '—', ytd: '—', samePeriodYtd: '—', yoy: '—' }
            : { actual: fmtVal(f.current, f.valueType), samePeriod: fmtVal(f.samePeriod, f.valueType),
                ytd: fmtVal(f.ytd, f.valueType), samePeriodYtd: fmtVal(f.samePeriodYtd, f.valueType), yoy: fmtYoy(f.yoy) }
          return { account: `${'　'.repeat(depth)}${f.name}`, ...Object.fromEntries(keys.map((k) => [k, cols[k]])) }
        })
        const filename = `财务指标_现金流量表${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
        await exportToExcel({
          filename,
          sheetName: '现金流量表',
          columns: [
            { header: '科目', key: 'account', width: 40 },
            ...keys.map((k) => ({
              header: k === 'actual' ? '本月金额(万)' : k === 'samePeriod' ? '同期金额(万)' : k === 'ytd' ? '本年累计(万)' : k === 'samePeriodYtd' ? '同期累计(万)' : '同比',
              key: k, width: k === 'yoy' ? 10 : 14,
            })),
          ],
          rows,
        })
        setExportMsg(`已导出：${filename}`)
      } else {
        // 静态分支同理：科目 + ['actual','samePeriod','yoy'] 过滤 hiddenColumns
        const keys = exportKeysFor('static').filter((k) => !opts.getHiddenColumns().includes(k))
        const rows = flat.map(({ row, depth }) => {
          const s = row as StaticRow
          // 展示类（display）只读展示：导出值列统一写「—」（口径同 browse/后端 maskDisplayRows）
          const cols: Record<string, string | number> = s.dataType === 'display'
            ? { actual: '—', samePeriod: '—', yoy: '—' }
            : { actual: fmtVal(s.current, s.valueType), samePeriod: fmtVal(s.samePeriod, s.valueType), yoy: fmtYoy(s.yoy) }
          return { account: `${'　'.repeat(depth)}${s.name}`, ...Object.fromEntries(keys.map((k) => [k, cols[k]])) }
        })
        const filename = `财务指标_静态指标${scopeSuffix}_${new Date().toISOString().slice(0, 10)}.xlsx`
        await exportToExcel({
          filename,
          sheetName: '静态指标',
          columns: [
            { header: '科目', key: 'account', width: 40 },
            ...keys.map((k) => ({ header: k === 'actual' ? '本期金额(万)' : k === 'samePeriod' ? '同期金额(万)' : '变动率', key: k, width: k === 'yoy' ? 10 : 16 })),
          ],
          rows,
        })
        setExportMsg(`已导出：${filename}`)
      }
    } catch (err) {
      // 导出失败：仅提示错误（不误设成功提示），按钮状态由 finally 复位
      setExportErr(`导出失败：${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }

  return { exporting, exportMsg, exportErr, handleExport }
}
