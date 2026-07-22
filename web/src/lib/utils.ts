import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value) + ' 万'
}

export function formatMoneyWan(value: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPercent(value: number): string {
  return (value * 100).toFixed(2) + '%'
}

export function getChangeColor(value: number): string {
  if (value > 0) return 'text-finance-red'
  if (value < 0) return 'text-finance-green'
  return 'text-gray-500'
}

export function getChangePrefix(value: number): string {
  if (value > 0) return '+'
  return ''
}
