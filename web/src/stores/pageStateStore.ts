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
  /** 科目列关键字筛选（'' = 不过滤） */
  subjectKeyword: string
  /** 列排序键（null 不排序；受控，持久化） */
  sortKey: string | null
  /** 列排序方向 */
  sortDirection: 'asc' | 'desc' | null
  /** 表格密度三档（对齐 DataTable 命名） */
  density: 'default' | 'dense' | 'compact'
  /** 经营指标隐藏的值列 key 列表（默认全部显示；与静态/现金流分区独立） */
  hiddenOperatingColumns: string[]
  /** 静态指标隐藏的值列 key 列表（默认全部显示） */
  hiddenStaticColumns: string[]
  /** 现金流量隐藏的值列 key 列表（默认全部显示） */
  hiddenCashflowColumns: string[]
}

export interface DataBrowseState {
  /** 公司多选，空数组 = 全部公司 */
  companies: string[]
  /** '' = 最新期间 */
  period: string
  subjectType: 'operating' | 'static' | 'cashflow'
  /** 展开行编码（Set 序列化为数组） */
  expandedRows: string[]
  /** 筛选卡折叠（折叠后表格吸顶偏移自动归零） */
  filterCollapsed: boolean
}

export interface TransactionOverviewState {
  /** 公司多选（图表与卡片共享），空数组 = 全部公司；单体与汇总主体互斥，不可同时选中 */
  companies: string[]
  /** '' = 跟随最新期间（仅作用于卡片） */
  period: string
  /** 对象类型多选（external/related/internal），空数组 = 全部对象（仅作用于卡片，与账龄页同口径） */
  party: string[]
  /** 趋势卡筛选（往来变动趋势） */
  trend: { type: string; rangeMode: string; customFrom: string; customTo: string }
}

export interface TransactionAgingState {
  /** 公司多选，空数组 = 全部公司（单体与汇总主体互斥，与总览页同语义） */
  companies: string[]
  /** '' = 跟随最新期间 */
  period: string
  /** '' = 全部类型 */
  type: string
  /** 科目多选，空数组 = 全部科目 */
  accounts: string[]
  /** 对象类型多选（external/related/internal），空数组 = 全部对象 */
  party: string[]
  /** 'type' | 'counterparty' */
  groupBy: string
  /** 仅显示小计：隐藏明细数据行，仅保留各组小计与合计行 */
  subtotalOnly: boolean
  /** 往来对象关键词搜索（编码/名称模糊匹配） */
  keyword: string
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
  /** '' = 跟随最新期间 */
  period: string
}

export interface TransactionSalesmenState {
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
  aging: TransactionAgingState
  coverage: TransactionCoverageState
  'account-filter': TransactionAccountFilterState
  collections: TransactionCollectionsState
  salesmen: TransactionSalesmenState
}

export interface DashboardState {
  /** '' = 最新期间 */
  period: string
  /** '' = 自动模式；'all' | 'company:X' | 'summary:X' */
  dim: string
  trendMetric: string
  /** 趋势图金额口径：'month' = 月度，'ytd' = 累计 */
  trendMode: string
  /** 综合分析卡当前标签：'trend' | 'product' | 'subject' | 'expense' */
  analysisTab: string
}

export interface InventoryState {
  /** 公司多选，空数组 = 全部公司 */
  companies: string[]
  /** '' = 跟随最新期间 */
  period: string
  /** 品类钻取筛选（'' = 全部品类），由饼图/排名图点击联动 */
  categoryCode: string
  /** 明细表关键词（公司/品类模糊匹配） */
  keyword: string
  /** 明细表展示维度：'company' 按公司汇总（默认）| 'category' 按品类展开 | 'detail' 公司×品类明细 */
  detailDim: 'company' | 'category' | 'detail'
}

export interface FormulasState {
  subjectType: 'operating' | 'static' | 'cashflow'
  keyword: string
  category: string
  status: string
  page: number
  /** 筛选工具条折叠 */
  searchCollapsed: boolean
}

/** 导入页区块折叠状态（导入质量概览 / 往来导入覆盖） */
export interface DataImportState {
  qualityCollapsed: boolean
  coverageCollapsed: boolean
}

// ===== 默认值 =====

const DEFAULT_SUMMARY_CODE = 'ET0001'

const defaultIndicators: IndicatorsState = {
  dimFilter: 'all',
  periodFilter: '',
  excludeReclassify: false,
  expandedCodes: [],
  subjectKeyword: '',
  sortKey: null,
  sortDirection: null,
  density: 'default',
  hiddenOperatingColumns: [],
  hiddenStaticColumns: [],
  hiddenCashflowColumns: [],
}

const defaultDataBrowse: DataBrowseState = {
  companies: [],
  period: '',
  subjectType: 'operating',
  expandedRows: [],
  filterCollapsed: false,
}

const defaultOverview: TransactionOverviewState = {
  companies: [DEFAULT_SUMMARY_CODE],
  period: '',
  // 默认口径：外部+关联方（排除内部公司，内部往来通常已抵消；与账龄页默认一致）
  party: ['external', 'related'],
  trend: { type: '应收账款', rangeMode: 'fiscal', customFrom: '', customTo: '' },
}

const defaultAging: TransactionAgingState = {
  companies: [DEFAULT_SUMMARY_CODE],
  period: '',
  type: '应收账款',
  accounts: [],
  // 默认口径：外部+关联方（排除内部公司，内部往来通常已抵消）
  party: ['external', 'related'],
  groupBy: 'type',
  subtotalOnly: false,
  keyword: '',
}

const defaultCoverage: TransactionCoverageState = { months: 6 }

const defaultAccountFilter: TransactionAccountFilterState = { showAll: false }

const defaultCollections: TransactionCollectionsState = {
  page: 1,
  pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
  company: 'all',
  status: '',
  keyword: '',
  period: '',
}

const defaultSalesmen: TransactionSalesmenState = {
  page: 1,
  pageSize: PAGINATION.DEFAULT_PAGE_SIZE,
  company: 'all',
  status: '',
  keyword: '',
}

const defaultDashboard: DashboardState = { period: '', dim: '', trendMetric: 'revenue', trendMode: 'month', analysisTab: 'trend' }

// 默认主体：浙江省公司汇总（与往来总览 overview 默认口径一致；空数组=全部公司仍可显式选择）
const defaultInventory: InventoryState = { companies: [DEFAULT_SUMMARY_CODE], period: '', categoryCode: '', keyword: '', detailDim: 'company' }

const defaultFormulas: FormulasState = { subjectType: 'operating', keyword: '', category: 'all', status: 'all', page: 1, searchCollapsed: false }

const defaultDataImport: DataImportState = { qualityCollapsed: false, coverageCollapsed: false }

const defaultTransactions: TransactionsState = {
  overview: defaultOverview,
  aging: defaultAging,
  coverage: defaultCoverage,
  'account-filter': defaultAccountFilter,
  collections: defaultCollections,
  salesmen: defaultSalesmen,
}

// ===== Store =====

interface PageStateStore {
  indicators: IndicatorsState
  dataBrowse: DataBrowseState
  transactions: TransactionsState
  dashboard: DashboardState
  inventory: InventoryState
  formulas: FormulasState
  dataImport: DataImportState

  setIndicators: (patch: Partial<IndicatorsState>) => void
  setDataBrowse: (patch: Partial<DataBrowseState>) => void
  setTransactionsTab: <K extends keyof TransactionsState>(tab: K, patch: Partial<TransactionsState[K]>) => void
  setDashboard: (patch: Partial<DashboardState>) => void
  setInventory: (patch: Partial<InventoryState>) => void
  setFormulas: (patch: Partial<FormulasState>) => void
  setDataImport: (patch: Partial<DataImportState>) => void
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
      aging: { ...defaultAging, ...(t?.aging ?? {}) },
      coverage: { ...defaultCoverage, ...(t?.coverage ?? {}) },
      'account-filter': { ...defaultAccountFilter, ...(t?.['account-filter'] ?? {}) },
      collections: { ...defaultCollections, ...(t?.collections ?? {}) },
      salesmen: { ...defaultSalesmen, ...(t?.salesmen ?? {}) },
    },
    dashboard: { ...defaultDashboard, ...(p.dashboard ?? {}) },
    inventory: { ...defaultInventory, ...(p.inventory ?? {}) },
    formulas: { ...defaultFormulas, ...(p.formulas ?? {}) },
    dataImport: { ...defaultDataImport, ...(p.dataImport ?? {}) },
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
      dataImport: defaultDataImport,

      setIndicators: (patch) => set((s) => ({ indicators: { ...s.indicators, ...patch } })),
      setDataBrowse: (patch) => set((s) => ({ dataBrowse: { ...s.dataBrowse, ...patch } })),
      setTransactionsTab: (tab, patch) =>
        set((s) => ({ transactions: { ...s.transactions, [tab]: { ...s.transactions[tab], ...patch } } })),
      setDashboard: (patch) => set((s) => ({ dashboard: { ...s.dashboard, ...patch } })),
      setInventory: (patch) => set((s) => ({ inventory: { ...s.inventory, ...patch } })),
      setFormulas: (patch) => set((s) => ({ formulas: { ...s.formulas, ...patch } })),
      setDataImport: (patch) => set((s) => ({ dataImport: { ...s.dataImport, ...patch } })),
    }),
    {
      name: 'page-state-storage',
      version: 5,
      // v1→v2：旧默认「全部公司」[]（非用户显式多选）迁移为 ET0001，与新默认主体口径一致；
      // 注意：空数组同时是显式「全部公司」的语义，此迁移仅覆盖从未改过默认值的存量会话
      // v3→v4：账龄对象类型由单选字符串改为多选数组（默认外部+关联方），存量值统一转为数组
      migrate: (persistedState, version) => {
        let next = persistedState as Record<string, unknown> | null
        if (version < 2) {
          const p = next as { inventory?: { companies?: string[] } } | null
          const inv = p?.inventory
          if (inv && Array.isArray(inv.companies) && inv.companies.length === 0) {
            next = { ...p, inventory: { ...inv, companies: [DEFAULT_SUMMARY_CODE] } }
          }
        }
        if (version < 4) {
          const p = next as { transactions?: { aging?: { party?: unknown } } } | null
          const aging = p?.transactions?.aging
          if (aging && typeof aging.party === 'string') {
            const party = aging.party === '' || aging.party === 'all'
              ? []
              : aging.party.split(',').map((s) => s.trim()).filter((s) => s === 'internal' || s === 'related' || s === 'external')
            next = { ...p, transactions: { ...(p?.transactions ?? {}), aging: { ...aging, party } } }
          }
        }
        if (version < 5) {
          // v4→v5：账龄公司筛选由单选（company: string）改为多选（companies: string[]），存量值统一转数组
          const p = next as { transactions?: { aging?: { company?: unknown; companies?: string[] } } } | null
          const aging = p?.transactions?.aging
          if (aging && !Array.isArray(aging.companies)) {
            const cur = aging.company
            const companies =
              typeof cur === 'string' && cur !== '' && cur !== 'all'
                ? [cur]
                : typeof cur === 'string' && (cur === '' || cur === 'all')
                  ? []
                  : [DEFAULT_SUMMARY_CODE]
            const { company: _legacy, ...rest } = aging
            next = { ...p, transactions: { ...(p?.transactions ?? {}), aging: { ...rest, companies } } }
          }
        }
        return next ?? persistedState
      },
      partialize: (state) => ({
        indicators: state.indicators,
        dataBrowse: state.dataBrowse,
        transactions: state.transactions,
        dashboard: state.dashboard,
        inventory: state.inventory,
        formulas: state.formulas,
        dataImport: state.dataImport,
      }),
      merge: mergePersisted,
    },
  ),
)
