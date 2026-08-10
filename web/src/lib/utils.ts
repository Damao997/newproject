import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(value: number): string {
  // 零值统一显示 '-'（仅显示层，不影响内部计算/存储）
  if (value === 0) return '-'
  return new Intl.NumberFormat('zh-CN', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' 万'
}

export function formatMoneyWan(value: number): string {
  if (value === 0) return '-'
  return new Intl.NumberFormat('zh-CN', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number): string {
  if (value === 0) return '-'
  return (value * 100).toFixed(1) + '%'
}

/** 科目值类型：金额（万元）/ 数量（户、天等）/ 比率（0-1 小数） */
export type MetricValueType = 'amount' | 'quantity' | 'ratio'

/** 数量：千分位整数（台数/户数/天数等不带小数） */
export function formatQuantity(value: number): string {
  if (value === 0) return '-'
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(value)
}

/** 按科目值类型分发格式化：金额千分位两位小数 / 数量整数 / 比率百分比（1 位小数） */
export function formatMetricValue(value: number, valueType?: MetricValueType | string): string {
  if (valueType === 'ratio') return formatPercent(value)
  if (valueType === 'quantity') return formatQuantity(value)
  return formatMoneyWan(value)
}

export function getChangeColor(value: number): string {
  if (value > 0) return 'text-finance-red'
  if (value < 0) return 'text-finance-green'
  return 'text-muted-foreground'
}

export function getChangePrefix(value: number): string {
  if (value > 0) return '+'
  return ''
}
