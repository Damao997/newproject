import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PAGINATION } from '@/lib/constants'

/**
 * 页面查询条件与视图状态持久化（路由切换/刷新后自动恢复）。
 *
 * 持久化范围：查询条件（主体/公司/期间/类型/关键词等）+ 视图状态（展开、分页）；
 * 不持久化瞬时状态（对话框开关、编辑草稿、分析抽屉 target 等，仍由页面 useState 管理）。
 * 与 periodStore / companyDisplayStore 同为 zustand + persist（localStorage）模式。
 * 失效值（期间/公司编码被删或越权）由各页面在候选加载后校验回退。
 */

// ===== 各分区状态形状 =====

export interface IndicatorsState {
  /** 'all' | 'company:X' | 'summary:X' */
  dimFilter: string
  /** '' = 最新期间；'all' = 全部期间 */
  periodFilter: string
  excludeReclassify: boolean
  /** 展开科目编码（Set 序列化为数组便于持久化） */
  expandedCodes: string[]
}

export interface DataBrowseState {
  /** 公司多选，空数组 = 全部公司 */
  companies: string[]
  /** '' = 最新期间 */
  period: string
  subjectType: 'operating' | 'static'
  /** 展开行编码（Set 序列化为数组） */
  expandedRows: string[]
}

export interface TransactionOverviewState {
  /** 公司多选（图表与卡片共享），空数组 = 全部公司；单体与汇总主体互斥，不可同时选中 */
  companies: string[]
  /** '' = 跟随最新期间（仅作用于卡片） */
  period: string
  /** 趋势卡筛选（往来变动趋势） */
  trend: { type: string; rangeMode: string; customFrom: string; customTo: string }
}

export interface TransactionDetailsState {
  page: number
  pageSize: number
  /** 'all' | 公司编码 */
  company: string
  /** '' = 跟随最新期间；'all' = 全部期间 */
  period: string
  /** '' = 全部类型 */
  type: string
  /** 科目多选，空数组 = 全部科目 */
  accounts: string[]
  /** 'all' | 'internal' | 'related' | 'external' */
  party: string
  keyword: string
}

export interface TransactionAgingState {
  /** 'all' | 公司编码 */
  company: string
  /** '' = 跟随最新期间 */
  period: string
  /** '' = 全部类型 */
  type: string
  /** 科目多选，空数组 = 全部科目 */
  accounts: string[]
  /** 'all' | 'internal' | 'related' | 'external' */
  party: string
  /** 'type' | 'counterparty' */
  groupBy: string
}

export interface TransactionInternalState {
  /** 'all' | 公司编码 */
  company: string
}

export interface TransactionCoverageState {
  /** 覆盖矩阵月份窗口：3 | 6 | 12 */
  months: number
}

export interface TransactionAccountFilterState {
  /** 是否展示全部科目（默认收敛为有数据/已排除） */
  showAll: boolean
}

export interface TransactionCollectionsState {
  page: number
  pageSize: number
  /** 'all' | 公司编码 */
  company: string
  /** '' = 全部状态 */
  status: string
  keyword: string
}

export interface TransactionsState {
  overview: TransactionOverviewState
  details: TransactionDetailsState
  aging: TransactionAgingState
  internal: TransactionInternalState
  coverage: TransactionCoverageState
  'account-filter': TransactionAccountFilterState
  collections: TransactionCollectionsState
}

export interface DashboardState {
  /** '' = 最新期间 */
  period: string
  /** '' = 自动模式；'all' | 'company:X' | 'summary:X' */
  dim: string
  trendMetric: string
}

export interface InventoryState {
  /** 公司多选，空数组 = 全部公司 */
  companies: string[]
  /** '' = 跟随最新期间 */
  period: string
}

export interface FormulasState {
  subjectType: 'operating' | 'static'
  keyword: string
  category: string
  status: string
  page: number
}

// ===== 默认值 =====

const DEFAULT_SUMMARY_CODE = 'ET0001'

const defaultIndicators: IndicatorsState = {
  dimFilter: 'all',
  periodFilter: '',
  excludeReclassify: false,
  expandedCodes: [],
}

const defaultDataBrowse: DataBrowseState = {
  companies: [],
  period: '',
  subjectType: 'operating',
  expandedRows: [],
}

const defaultOverview: TransactionOverviewState = {
  companies: [DEFAULT_SUMMARY_CODE],
  period: '',
  trend: { type: '应收账款', rangeMode: 'fiscal', customFrom: '', customTo: '' },
}

const defaultDetails: TransactionDetailsState = {
  page: 1,
  pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
  company: DEFAULT_SUMMARY_CODE,
  period: '',
  type: '应收账款',
  accounts: [],
  party: 'external',
  keyword: '',
}

const defaultAging: TransactionAgingState = {
  company: DEFAULT_SUMMARY_CODE,
  period: '',
  type: '应收账款',
  accounts: [],
  party: 'external',
  groupBy: 'type',
}

const defaultInternal: TransactionInternalState = { company: 'all' }

const defaultCoverage: TransactionCoverageState = { months: 6 }

const defaultAccountFilter: TransactionAccountFilterState = { showAll: false }

const defaultCollections: TransactionCollectionsState = {
  page: 1,
  pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
  company: 'all',
  status: '',
  keyword: '',
}

const defaultDashboard: DashboardState = { period: '', dim: '', trendMetric: 'revenue' }

const defaultInventory: InventoryState = { companies: [], period: '' }

const defaultFormulas: FormulasState = { subjectType: 'operating', keyword: '', category: 'all', status: 'all', page: 1 }

const defaultTransactions: TransactionsState = {
  overview: defaultOverview,
  details: defaultDetails,
  aging: defaultAging,
  internal: defaultInternal,
  coverage: defaultCoverage,
  'account-filter': defaultAccountFilter,
  collections: defaultCollections,
}

// ===== Store =====

interface PageStateStore {
  indicators: IndicatorsState
  dataBrowse: DataBrowseState
  transactions: TransactionsState
  dashboard: DashboardState
  inventory: InventoryState
  formulas: FormulasState

  setIndicators: (patch: Partial<IndicatorsState>) => void
  setDataBrowse: (patch: Partial<DataBrowseState>) => void
  setTransactionsTab: <K extends keyof TransactionsState>(tab: K, patch: Partial<TransactionsState[K]>) => void
  setDashboard: (patch: Partial<DashboardState>) => void
  setInventory: (patch: Partial<InventoryState>) => void
  setFormulas: (patch: Partial<FormulasState>) => void
}

/** 深合并持久化值：缺字段用默认值补全，结构演进（新增字段）时安全 */
function mergePersisted(persisted: unknown, current: PageStateStore): PageStateStore {
  const p = (persisted ?? {}) as Partial<PageStateStore>
  const t = p.transactions
  return {
    ...current,
    indicators: { ...defaultIndicators, ...(p.indicators ?? {}) },
    dataBrowse: { ...defaultDataBrowse, ...(p.dataBrowse ?? {}) },
    transactions: {
      overview: {
        ...defaultOverview,
        ...(t?.overview ?? {}),
        trend: { ...defaultOverview.trend, ...(t?.overview?.trend ?? {}) },
      },
      details: { ...defaultDetails, ...(t?.details ?? {}) },
      aging: { ...defaultAging, ...(t?.aging ?? {}) },
      internal: { ...defaultInternal, ...(t?.internal ?? {}) },
      coverage: { ...defaultCoverage, ...(t?.coverage ?? {}) },
      'account-filter': { ...defaultAccountFilter, ...(t?.['account-filter'] ?? {}) },
      collections: { ...defaultCollections, ...(t?.collections ?? {}) },
    },
    dashboard: { ...defaultDashboard, ...(p.dashboard ?? {}) },
    inventory: { ...defaultInventory, ...(p.inventory ?? {}) },
    formulas: { ...defaultFormulas, ...(p.formulas ?? {}) },
  }
}

export const usePageStore = create<PageStateStore>()(
  persist(
    (set) => ({
      indicators: defaultIndicators,
      dataBrowse: defaultDataBrowse,
      transactions: defaultTransactions,
      dashboard: defaultDashboard,
      inventory: defaultInventory,
      formulas: defaultFormulas,

      setIndicators: (patch) => set((s) => ({ indicators: { ...s.indicators, ...patch } })),
      setDataBrowse: (patch) => set((s) => ({ dataBrowse: { ...s.dataBrowse, ...patch } })),
      setTransactionsTab: (tab, patch) =>
        set((s) => ({ transactions: { ...s.transactions, [tab]: { ...s.transactions[tab], ...patch } } })),
      setDashboard: (patch) => set((s) => ({ dashboard: { ...s.dashboard, ...patch } })),
      setInventory: (patch) => set((s) => ({ inventory: { ...s.inventory, ...patch } })),
      setFormulas: (patch) => set((s) => ({ formulas: { ...s.formulas, ...patch } })),
    }),
    {
      name: 'page-state-storage',
      version: 1,
      partialize: (state) => ({
        indicators: state.indicators,
        dataBrowse: state.dataBrowse,
        transactions: state.transactions,
        dashboard: state.dashboard,
        inventory: state.inventory,
        formulas: state.formulas,
      }),
      merge: mergePersisted,
    },
  ),
)
