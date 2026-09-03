import type { SubPageTab } from './sub-page-tabs'

/** 财务指标：经营指标（默认）/ 静态指标 / 现金流量表 */
export const INDICATOR_TABS: SubPageTab[] = [
  { path: '/indicators/operating', label: '经营指标' },
  { path: '/indicators/static', label: '静态指标' },
  { path: '/indicators/cashflow', label: '现金流量表' },
]

/** 分析报告中心：汇总报告（默认）/ 单项分析（侧边栏平铺后原二级入口由页内 Tab 承接） */
export const REPORTS_TABS: SubPageTab[] = [
  { path: '/reports', label: '汇总报告' },
  { path: '/reports/analyses', label: '单项分析' },
]

/** 首页看板 · 经营分析：壹品慧关键指标表（默认）/ 壹品慧业务现金流分析 / 应收账款账龄分析表 / 存货库龄分析表
 * / 品类预算达成 / 公司预算达成 / 运营费用（后三项由原综合分析卡迁入） */
export const DASHBOARD_ANALYSIS_TABS: SubPageTab[] = [
  { path: '/dashboard/analysis/key-metrics', label: '壹品慧关键指标表' },
  { path: '/dashboard/analysis/cash-flow', label: '壹品慧业务现金流分析' },
  { path: '/dashboard/analysis/receivable-aging', label: '应收账款账龄分析表' },
  { path: '/dashboard/analysis/inventory-aging', label: '存货库龄分析表' },
  { path: '/dashboard/analysis/category-budget', label: '品类预算达成' },
  { path: '/dashboard/analysis/subject-budget', label: '公司预算达成' },
  { path: '/dashboard/analysis/expense', label: '运营费用' },
]

/** 往来分析 6 个子页（统一 Tab 导航）：往来总览（默认）/ 账龄分析 / 科目过滤 / 导入覆盖 / 催收计划 / 业务员回款 */
export const TRANSACTION_TABS: SubPageTab[] = [
  { path: '/transactions/overview', label: '往来总览' },
  { path: '/transactions/aging', label: '账龄分析' },
  { path: '/transactions/account-filter', label: '科目过滤' },
  { path: '/transactions/coverage', label: '导入覆盖' },
  { path: '/transactions/collections/plans', label: '催收计划' },
  { path: '/transactions/collections/salesmen', label: '业务员回款' },
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

/** 数据管理 · 维度/科目体系：经营分析科目（默认）/ 静态科目 / 现金流量科目 / 主体管理 / 汇总主体映射 / 公式维护 */
export const DIMENSION_TABS: SubPageTab[] = [
  { path: '/data/dimensions/operating', label: '经营分析科目' },
  { path: '/data/dimensions/static', label: '静态科目' },
  { path: '/data/dimensions/cashflow', label: '现金流量科目' },
  { path: '/data/dimensions/company', label: '主体管理' },
  { path: '/data/dimensions/summary', label: '汇总主体映射' },
  { path: '/data/dimensions/formulas', label: '公式维护' },
]

/** 数据管理 · 映射管理：品类配置（默认）/ 运营费用映射 / 主体配置 / 月度预算比例 / 产品配置 */
export const BOARD_TABS: SubPageTab[] = [
  { path: '/data/board/category', label: '品类配置' },
  { path: '/data/board/expense', label: '运营费用映射' },
  { path: '/data/board/subject', label: '主体配置' },
  { path: '/data/board/budget-ratio', label: '月度预算比例' },
  { path: '/data/board/product', label: '产品配置' },
]
