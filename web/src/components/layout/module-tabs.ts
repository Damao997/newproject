import type { SubPageTab } from './sub-page-tabs'

/** 财务指标：经营指标（默认）/ 静态指标 */
export const INDICATOR_TABS: SubPageTab[] = [
  { path: '/indicators/operating', label: '经营指标' },
  { path: '/indicators/static', label: '静态指标' },
]

/** 首页看板 · 经营分析：壹品慧关键指标表（默认）/ 壹品慧业务现金流分析 / 应收账款账龄分析表 / 存货库龄分析表 */
export const DASHBOARD_ANALYSIS_TABS: SubPageTab[] = [
  { path: '/dashboard/analysis/key-metrics', label: '壹品慧关键指标表' },
  { path: '/dashboard/analysis/cash-flow', label: '壹品慧业务现金流分析' },
  { path: '/dashboard/analysis/receivable-aging', label: '应收账款账龄分析表' },
  { path: '/dashboard/analysis/inventory-aging', label: '存货库龄分析表' },
]

/** 往来分析 · 分析明细：账龄分析（默认）/ 科目过滤 / 催收计划 */
export const TRANSACTION_DETAIL_TABS: SubPageTab[] = [
  { path: '/transactions/aging', label: '账龄分析' },
  { path: '/transactions/account-filter', label: '科目过滤' },
  { path: '/transactions/collections/plans', label: '催收计划' },
]

/** 数据管理 · 数据导入：导入管理（默认）/ 数据预览 */
export const IMPORT_TABS: SubPageTab[] = [
  { path: '/data/import', label: '导入管理' },
  { path: '/data/browse', label: '数据预览' },
]

/** 数据管理 · 重分类管理：单体公司调整（默认）/ 汇总主体调整 */
export const RECLASSIFY_TABS: SubPageTab[] = [
  { path: '/data/reclassify', label: '单体公司调整' },
  { path: '/data/reclassify/consolidation', label: '汇总主体调整' },
]

/** 数据管理 · 维度/科目体系：经营分析科目（默认）/ 静态科目 / 主体管理 / 汇总主体映射 / 公式维护 */
export const DIMENSION_TABS: SubPageTab[] = [
  { path: '/data/dimensions/operating', label: '经营分析科目' },
  { path: '/data/dimensions/static', label: '静态科目' },
  { path: '/data/dimensions/company', label: '主体管理' },
  { path: '/data/dimensions/summary', label: '汇总主体映射' },
  { path: '/data/dimensions/formulas', label: '公式维护' },
]

/** 数据管理 · 看板管理：品类配置（默认）/ 运营费用映射 / 主体配置 / 月度预算比例 */
export const BOARD_TABS: SubPageTab[] = [
  { path: '/data/board/category', label: '品类配置' },
  { path: '/data/board/expense', label: '运营费用映射' },
  { path: '/data/board/subject', label: '主体配置' },
  { path: '/data/board/budget-ratio', label: '月度预算比例' },
]
