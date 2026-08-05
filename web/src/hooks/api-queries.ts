import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AnalysisInput, AnalysisItem, AvailablePeriodsResult, ReportDetail, ReportListItem, ReportSectionInput, ReportVersionItem, ReportExportData } from '@/lib/api'
import type { FilterParams, BatchActivateCheckResult } from '@/types'

/**
 * React Query hook 层：集中封装对 @/lib/api 的调用与缓存键，
 * 写操作成功后失效相关查询。页面只依赖这些 hook，避免各处散落 api 调用。
 */

export const queryKeys = {
  dashboardOverview: (p?: unknown) => ['dashboard', 'overview', p ?? null] as const,
  indicatorsOperating: (p: unknown) => ['indicators', 'operating', p] as const,
  indicatorsStatic: (p: unknown) => ['indicators', 'static', p] as const,
  companies: ['data', 'companies'] as const,
  imports: (p: unknown) => ['data', 'imports', p] as const,
  metrics: (p: unknown) => ['data', 'metrics', p] as const,
  users: (p: unknown) => ['admin', 'users', p] as const,
  roles: ['admin', 'roles'] as const,
  permissions: ['admin', 'permissions'] as const,
  auditLogs: (p: unknown) => ['admin', 'audit-logs', p] as const,
}

// ---------------- Dashboard ----------------
export function useDashboardOverview(params: { period?: string; companyCode?: string } = {}) {
  return useQuery({
    queryKey: queryKeys.dashboardOverview(params),
    queryFn: () => api.getDashboardOverview({
      ...(params.period ? { period: params.period } : {}),
      ...(params.companyCode ? { companyCode: params.companyCode } : {}),
    }),
    placeholderData: keepPreviousData,
    // 看板数据随批次激活才变化，5 分钟内路由往返不重复请求
    staleTime: 5 * 60 * 1000,
  })
}

/** 应收账款按主体分布：期间跟随看板当前期间，主体口径跟随看板筛选（companyCode 展开由后端完成）；period 未定时不发请求 */
export function useDashboardReceivables(params: { period?: string; mode: 'single' | 'summary'; companyCode?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'receivables', params.period ?? '', params.mode, params.companyCode ?? ''] as const,
    queryFn: () => api.getDashboardReceivables({ period: params.period as string, mode: params.mode, ...(params.companyCode ? { companyCode: params.companyCode } : {}) }),
    enabled: !!params.period,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })
}

/** 品类预算达成表：单期间 + 主体口径（跟随看板筛选），period 未定时不发请求 */
export function useProductBudget(params: { period?: string; companyCode?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'product-budget', params.period ?? '', params.companyCode ?? ''] as const,
    queryFn: () => api.getProductBudget({
      ...(params.period ? { period: params.period } : {}),
      ...(params.companyCode ? { companyCode: params.companyCode } : {}),
    }),
    enabled: !!params.period,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })
}

/** 主体预算达成表：单期间 + 主体类型（单体/汇总）+ 可选指定主体（跟随看板顶部筛选），period 未定时不发请求 */
export function useSubjectBudget(params: { period?: string; mode: 'single' | 'summary'; companyCode?: string }) {
  return useQuery({
    queryKey: ['dashboard', 'subject-budget', params.period ?? '', params.mode, params.companyCode ?? ''] as const,
    queryFn: () => api.getSubjectBudget({
      period: params.period as string,
      mode: params.mode,
      ...(params.companyCode ? { companyCode: params.companyCode } : {}),
    }),
    enabled: !!params.period,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
  })
}

// ---------------- 品类配置（品类预算达成分析，数据维护） ----------------
export function useProductCategories() {
  return useQuery({
    queryKey: ['data', 'product-categories'] as const,
    queryFn: () => api.getProductCategories(),
    staleTime: 30 * 1000,
  })
}

export function useProductCategoryCheck() {
  return useQuery({
    queryKey: ['data', 'product-categories', 'check'] as const,
    queryFn: () => api.checkProductCategories(),
    staleTime: 30 * 1000,
  })
}

export function useProductCategoryMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['data', 'product-categories'] })
  }
  return {
    create: useMutation({
      mutationFn: (input: { code: string; name: string; subjectKeyword: string; sortOrder?: number; status?: string }) => api.createProductCategory(input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; name?: string; subjectKeyword?: string; sortOrder?: number; status?: string }) =>
        api.updateProductCategory(input.id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteProductCategory(id),
      onSuccess: invalidate,
    }),
  }
}

// ---------------- 主体展示配置（主体预算达成分析，数据维护） ----------------
export function useSubjectBudgetConfigs() {
  return useQuery({
    queryKey: ['data', 'subject-budget-configs'] as const,
    queryFn: () => api.getSubjectBudgetConfigs(),
    staleTime: 30 * 1000,
  })
}

export function useSubjectBudgetConfigCheck() {
  return useQuery({
    queryKey: ['data', 'subject-budget-configs', 'check'] as const,
    queryFn: () => api.checkSubjectBudgetConfigs(),
    staleTime: 30 * 1000,
  })
}

export function useSubjectBudgetConfigMutations() {
  const queryClient = useQueryClient()
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['data', 'subject-budget-configs'] })
  }
  return {
    create: useMutation({
      mutationFn: (input: { companyCode: string; sortOrder?: number; status?: string }) => api.createSubjectBudgetConfig(input),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: (input: { id: string; sortOrder?: number; status?: string }) => api.updateSubjectBudgetConfig(input.id, input),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api.deleteSubjectBudgetConfig(id),
      onSuccess: invalidate,
    }),
  }
}

// ---------------- Indicators ----------------
export interface OperatingResult {
  items: OperatingRow[]
  total: number
  period: string
  companyCount: number
  /** 本次结果是否已去除跨公司重分类影响（模拟口径） */
  reclassifyExcluded?: boolean
  /** 因批次替换/缺快照无法回溯的重分类记录数 */
  skippedReclassifyLogs?: number
}
export interface OperatingRow {
  code: string; name: string; level: number; category: string; dataType: string; valueType: 'amount' | 'quantity' | 'ratio'; isLeaf: boolean
  budget: number; actual: number; samePeriod: number; ytd: number; samePeriodYtd: number
  yoy: number; achievement: number; ytdYoy: number; children?: OperatingRow[]
}
export interface StaticResult {
  items: StaticRow[]
  total: number
  companyCount: number
  reclassifyExcluded?: boolean
  skippedReclassifyLogs?: number
}
export interface StaticRow {
  code: string; name: string; level: number; category: string; dataType: string; valueType: 'amount' | 'quantity' | 'ratio'; isLeaf: boolean
  current: number; yearStart: number; samePeriod: number; lastYearStart: number; yoy: number; children?: StaticRow[]
}

export function useOperatingIndicators(params: { companyCode?: string; period?: string; excludeReclassify?: boolean }) {
  return useQuery({
    queryKey: queryKeys.indicatorsOperating(params),
    queryFn: () => api.getOperatingIndicators(params as FilterParams) as unknown as Promise<OperatingResult>,
    // 筛选切换时保留上一次数据，避免内容区塌陷再撑回导致整页抖动
    placeholderData: keepPreviousData,
  })
}

export function useStaticIndicators(params: { companyCode?: string; period?: string; excludeReclassify?: boolean }) {
  return useQuery({
    queryKey: queryKeys.indicatorsStatic(params),
    queryFn: () => api.getStaticIndicators(params as FilterParams) as unknown as Promise<StaticResult>,
    placeholderData: keepPreviousData,
  })
}

export function useAvailablePeriods() {
  return useQuery<AvailablePeriodsResult>({
    queryKey: ['indicators', 'periods'],
    queryFn: () => api.getAvailablePeriods(),
    staleTime: 5 * 60 * 1000,
  })
}

// ---------------- Data: companies / imports / metrics ----------------
export function useCompanies(params?: { includeInactive?: string }) {
  return useQuery({ queryKey: [...queryKeys.companies, params ?? {}] as const, queryFn: () => api.getCompanies(params) })
}

export function useImports(params: FilterParams = {}) {
  return useQuery({ queryKey: queryKeys.imports(params), queryFn: () => api.getImports(params), placeholderData: keepPreviousData })
}

/** 单个导入批次详情（含解析错误明细 errors），仅在选中批次时拉取 */
export function useImport(id: string | null) {
  return useQuery({
    queryKey: ['data', 'imports', 'detail', id] as const,
    queryFn: () => api.getImportById(id as string),
    enabled: !!id,
  })
}

export function useMetrics(params: FilterParams = {}) {
  return useQuery({ queryKey: queryKeys.metrics(params), queryFn: () => api.getMetrics(params), placeholderData: keepPreviousData })
}

export function useSubjects(params: FilterParams = {}, options: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: ['data', 'subjects', params] as const, queryFn: () => api.getSubjects(params), placeholderData: keepPreviousData, enabled: options.enabled ?? true })
}

export interface SubjectTreeItem {
  id: string
  code: string
  name: string
  level: number
  parentCode: string | null
  category: string
  direction: string
  isLeaf: boolean
  dataType: 'data' | 'calc' | 'display'
  valueType?: 'amount' | 'quantity' | 'ratio'
}

export function useSubjectTree(type: 'operating' | 'static') {
  return useQuery({
    queryKey: ['data', 'subjects', 'tree', type] as const,
    queryFn: () => api.getSubjectTree(type),
  })
}

export function useCreateSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createSubject(data as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'subjects'] }),
  })
}

export function useUpdateSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => api.updateSubject(vars.id, vars.data as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'subjects'] }),
  })
}

export function useDeleteSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteSubject(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'subjects'] }),
  })
}

export interface CrossTable {
  period: string
  companies: string[]
  rows: { code: string; name: string; valueType?: 'amount' | 'quantity' | 'ratio'; level: number; parentCode: string | null; isLeaf: boolean; values: Record<string, number> }[]
}
export function useCrossTable(params: { period?: string; subjectType?: 'operating' | 'static' } = {}) {
  return useQuery({
    queryKey: ['data', 'cross-table', params] as const,
    queryFn: () => api.getCrossTable(params) as Promise<CrossTable>,
    placeholderData: keepPreviousData,
  })
}

export function useUploadImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { file: File; templateType: string; valueUnit: string; fiscalYear?: string }) => api.uploadImport(vars.file, vars.templateType, vars.valueUnit, vars.fiscalYear),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'imports'] }),
  })
}

export function useActivateImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.activateImport(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'imports'] })
      qc.invalidateQueries({ queryKey: ['data', 'cross-table'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      // 往来批次激活后同步刷新往来分析页（批次操作与分析消费跨页联动约定）
      qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

/** 批次差异对比查询（enabled 由对话框状态控制，两批次选定后才发起） */
export function useCompareImports(aId: string | null, bId: string | null) {
  return useQuery({
    queryKey: ['data', 'imports', 'compare', aId, bId],
    queryFn: () => api.compareImports(aId as string, bId as string),
    enabled: !!aId && !!bId,
    retry: 1,
  })
}

/** 回滚批次（US-03）：恢复快照数据并重新激活历史批次，成功后全量刷新数据相关缓存 */
export function useRollbackImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.rollbackImport(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'imports'] })
      qc.invalidateQueries({ queryKey: ['data', 'cross-table'] })
      qc.invalidateQueries({ queryKey: ['data', 'imports', 'compare'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      // 存货数据源为 fact_static，static 批次回滚直接改写，须一并失效（否则最长 5 分钟显示旧数据）
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
  })
}

/** 批量激活预检（只读）：返回各批次激活后将替换的已生效组合，供批量激活前确认覆盖风险 */
export function useBatchActivateCheck() {
  return useMutation({
    mutationFn: (ids: string[]) => api.batchActivateCheck(ids) as Promise<BatchActivateCheckResult>,
  })
}

/** 导入预览（dry-run）：不建批次不写库 */
export function usePreviewImport() {
  return useMutation({
    mutationFn: (vars: { file: File; templateType: string; valueUnit: string; fiscalYear?: string }) => api.previewImport(vars.file, vars.templateType, vars.valueUnit, vars.fiscalYear),
  })
}

/** 手动归档批次（高危，仅 superadmin） */
export function useArchiveImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.archiveImport(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'imports'] })
      qc.invalidateQueries({ queryKey: ['data', 'cross-table'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

/** 清除批次数据（高危，仅 superadmin）：物理删除事实明细 */
export function usePurgeImport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.purgeImport(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'imports'] })
      qc.invalidateQueries({ queryKey: ['data', 'cross-table'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
    },
  })
}

// ---------------- Data: 公司 CRUD ----------------
export function useCreateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createCompany(data as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.companies }),
  })
}

export function useUpdateCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => api.updateCompany(vars.id, vars.data as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.companies }),
  })
}

export function useDeleteCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCompany(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.companies }),
  })
}


// ---------------- Data: 汇总映射 CRUD ----------------
export function useAggregationMap(summaryCode: string | null) {
  return useQuery({
    queryKey: ['data', 'aggregation-map', summaryCode] as const,
    queryFn: () => api.getAggregationMap(summaryCode ?? undefined),
    enabled: !!summaryCode,
  })
}

export function useAddAggregationMap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { summaryCompanyCode: string; singleCompanyCode: string; isInternalElimination?: boolean }) => api.createAggregationMap(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'aggregation-map'] })
      qc.invalidateQueries({ queryKey: queryKeys.companies })
    },
  })
}

export function useRemoveAggregationMap() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteAggregationMap(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'aggregation-map'] }),
  })
}

// ---------------- 数据重分类 ----------------
export interface ReclassifyCompanyInput {
  templateType: string
  sourceCompanyCode: string
  targetCompanyCode: string
  accountCodes?: string[]
  period: string
  transferMode?: 'all' | 'ratio' | 'amount'
  ratio?: number
  amount?: number
}

export interface AdjustSubjectInput {
  templateType: string
  companyCode: string
  /** 调整方式：both=调减+调增；decrease=仅调减；increase=仅调增 */
  adjustMode?: 'both' | 'decrease' | 'increase'
  sourceAccountCode?: string
  targetAccountCode?: string
  decreaseAmount?: number
  increaseAmount?: number
  period: string
  reason: string
}

export function usePreviewReclassifyCompany() {
  return useMutation({
    mutationFn: (data: ReclassifyCompanyInput) => api.previewReclassifyCompany(data),
  })
}

export function useReclassifyCompany() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ReclassifyCompanyInput) => api.reclassifyCompany(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'cross-table'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['data', 'reclassify-logs'] })
    },
  })
}

export function useReclassifyLogs(params: FilterParams & { type?: string } = {}) {
  return useQuery({
    queryKey: ['data', 'reclassify-logs', params] as const,
    queryFn: () => api.getReclassifyLogs(params),
    placeholderData: keepPreviousData,
  })
}

export function useRevertReclassifyLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.revertReclassifyLog(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'cross-table'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['data', 'reclassify-logs'] })
    },
  })
}

export function usePreviewAdjustSubject() {
  return useMutation({
    mutationFn: (data: AdjustSubjectInput) => api.previewAdjustSubject(data),
  })
}

export function useAdjustSubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AdjustSubjectInput) => api.adjustSubject(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'cross-table'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['data', 'reclassify-logs'] })
    },
  })
}

// ---------------- 汇总抵消调整（汇总口径内部交易抵消，单体报表不受影响） ----------------
export interface ConsolidationAdjustInput {
  templateType: 'operating'
  summaryCompanyCode: string
  accountCode: string
  period: string
  amount: number
  reason: string
}

export function useConsolidationAdjustments(params: FilterParams = {}) {
  return useQuery({
    queryKey: ['data', 'consolidation-adjustments', params] as const,
    queryFn: () => api.getConsolidationAdjustments(params),
    placeholderData: keepPreviousData,
  })
}

export interface CommonSummaryItem { code: string; name: string; isInternalElimination: boolean }

/** 解析两个单体公司共同所属的汇总主体（匹配按钮触发） */
export function useCommonSummaries() {
  return useMutation({
    mutationFn: (data: { singleCompanyCodeA: string; singleCompanyCodeB: string }) => api.commonConsolidationSummaries(data),
  })
}

export function useCreateConsolidationAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ConsolidationAdjustInput) => api.createConsolidationAdjustment(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'consolidation-adjustments'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useDeleteConsolidationAdjustment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteConsolidationAdjustment(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'consolidation-adjustments'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
  })
}

export function useReclassifySubject() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; parentCode: string | null }) => api.reclassifySubject(vars.id, vars.parentCode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'subjects'] })
      qc.invalidateQueries({ queryKey: ['data', 'cross-table'] })
      qc.invalidateQueries({ queryKey: ['indicators'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['data', 'reclassify-logs'] })
    },
  })
}

export function useCreateMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createMetric(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'metrics'] }),
  })
}

export function useUpdateMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => api.updateMetric(vars.id, vars.data as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'metrics'] }),
  })
}

export function useDeleteMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteMetric(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'metrics'] }),
  })
}

/** 彻底删除指标（高危，仅 superadmin）：连同公式历史一并删除 */
export function usePurgeMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.purgeMetric(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'metrics'] }),
  })
}

/** 恢复启用已停用指标；clearFormula=true 时公式失效可清空后恢复 */
export function useRestoreMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; clearFormula?: boolean }) => api.restoreMetric(vars.id, { clearFormula: vars.clearFormula }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'metrics'] }),
  })
}

/** 指标类型转换（高危，仅 superadmin）：data ↔ calc、data/calc → display（display 只读不可转出） */
export function useConvertMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; dataType: 'data' | 'calc' | 'display'; formula?: string }) => api.convertMetric(vars.id, { dataType: vars.dataType, formula: vars.formula }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'metrics'] }),
  })
}

// ---------------- Admin: users / roles / audit ----------------
export function useUsers(params: FilterParams = {}) {
  return useQuery({ queryKey: queryKeys.users(params), queryFn: () => api.getUsers(params), placeholderData: keepPreviousData })
}

export function useRoles() {
  return useQuery({ queryKey: queryKeys.roles, queryFn: () => api.getRoles() })
}

/** 审计日志查询参数：在通用分页/时间范围之外支持角色/模块/用户关键字筛选 */
export interface AuditLogParams extends FilterParams {
  module?: string
  action?: string
  role?: string
  username?: string
}

export function useAuditLogs(params: AuditLogParams = {}) {
  return useQuery({ queryKey: queryKeys.auditLogs(params), queryFn: () => api.getAuditLogs(params), placeholderData: keepPreviousData })
}

export function useDisableUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

/** 彻底删除用户（高危，仅 superadmin）：需先停用 */
export function usePurgeUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.purgeUser(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

export function useUpdateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => api.updateUser(vars.id, vars.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

export function useResetPassword() {
  return useMutation({
    mutationFn: (vars: { id: string; newPassword: string }) => api.resetPassword(vars.id, vars.newPassword),
  })
}

export function useCreateUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createUser(data as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  })
}

// ---- 角色与权限 ----
export interface RoleItem {
  id: string; code: string; name: string; description: string | null; isSystem: boolean
  scopeValue?: string; permissions: { id: string; resource: string; action: string }[]
}

export function usePermissions() {
  return useQuery({ queryKey: queryKeys.permissions, queryFn: () => api.getPermissions() })
}

export function useCreateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createRole(data as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles'] }),
  })
}

export function useUpdateRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => api.updateRole(vars.id, vars.data as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles'] }),
  })
}

export function useDeleteRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteRole(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles'] }),
  })
}

export function useCloneRole() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; name: string }) => api.cloneRole(vars.id, vars.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles'] }),
  })
}

export function useUpdateRolePermissions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { roleId: string; permissions: { resource: string; action: string }[] }) =>
      api.updatePermissions(vars.roleId, vars.permissions as never),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'roles'] }),
  })
}

// ---------------- AI 公式生成 ----------------
export interface FormulaSuggestion {
  suggestedFormula: string | null
  dependsOn: string[]
  explanation: string
  valid: boolean
  warnings: string[]
}

export function useGenerateFormula() {
  return useMutation({
    mutationFn: (data: { userDescription: string; subjectType?: string }) => api.generateFormula(data),
  })
}

export function useMetricHistory(id: string | null) {
  return useQuery({
    queryKey: ['data', 'metric-history', id] as const,
    queryFn: () => api.getMetricHistory(id as string),
    enabled: !!id,
  })
}

export function useRollbackMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) => api.rollbackMetric(vars.id, vars.version),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'metrics'] })
      qc.invalidateQueries({ queryKey: ['data', 'metric-history'] })
    },
  })
}

export function useTrialCalc() {
  return useMutation({
    mutationFn: (data: { formula: string; companyCode?: string; period?: string }) => api.trialCalcFormula(data),
  })
}

export function useDependencies(id: string | null) {
  return useQuery({
    queryKey: ['data', 'metric-deps', id] as const,
    queryFn: () => api.analyzeDependencies(id as string),
    enabled: !!id,
  })
}

export function useApproveMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.approveMetric(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'metric-history'] }),
  })
}

export function useRejectMetric() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.rejectMetric(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['data', 'metrics'] })
      qc.invalidateQueries({ queryKey: ['data', 'metric-history'] })
    },
  })
}

// ---------------- 分析报告：单项分析 ----------------
export type { AnalysisItem, AnalysisInput, ReportDetail, ReportListItem, ReportSectionInput, ReportVersionItem, ReportExportData }

export function useAnalyses(params: { companyCode?: string; subjectCode?: string; period?: string; keyword?: string; includeInactive?: boolean; page?: number; pageSize?: number }) {
  return useQuery({
    queryKey: ['reports', 'analyses', params] as const,
    queryFn: () => api.listAnalyses(params),
  })
}

export function useCreateAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: AnalysisInput) => api.createAnalysis(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'analyses'] }),
  })
}

export function useUpdateAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: { title?: string; content?: string; metricContext?: Record<string, unknown> | null } }) =>
      api.updateAnalysis(vars.id, vars.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'analyses'] }),
  })
}

export function useDeleteAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteAnalysis(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'analyses'] }),
  })
}

export function useRestoreAnalysis() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.restoreAnalysis(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'analyses'] }),
  })
}

// ---------------- 分析报告：汇总报告 ----------------
export function useReports(params: { page?: number; pageSize?: number; status?: string; keyword?: string } = {}) {
  return useQuery({
    queryKey: ['reports', 'list', params] as const,
    queryFn: () => api.listReports(params),
  })
}

export function useReport(id: string | null) {
  return useQuery({
    queryKey: ['reports', 'detail', id] as const,
    queryFn: () => api.getReport(id as string),
    enabled: !!id,
  })
}

export function useCreateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { title: string; fiscalYear: string; period: string; companyScope: { type: 'company' | 'summary'; code: string } }) =>
      api.createReport(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'list'] }),
  })
}

export function useUpdateReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: { title?: string; status?: string } }) => api.updateReport(vars.id, vars.data),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['reports', 'list'] })
      qc.invalidateQueries({ queryKey: ['reports', 'detail', vars.id] })
    },
  })
}

export function useDeleteReport() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteReport(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports', 'list'] }),
  })
}

export function useGenerateReportSections() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.generateReportSections(id),
    onSuccess: (_d, id) => qc.invalidateQueries({ queryKey: ['reports', 'detail', id] }),
  })
}

export function useSetReportSections() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; items: ReportSectionInput[]; expectedUpdatedAt?: string }) =>
      api.setReportSections(vars.id, vars.items, vars.expectedUpdatedAt),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['reports', 'detail', vars.id] }),
  })
}

export function useSaveReportVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; changeSummary?: string; expectedUpdatedAt?: string }) =>
      api.saveReportVersion(vars.id, vars.changeSummary, vars.expectedUpdatedAt),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['reports', 'detail', vars.id] })
      qc.invalidateQueries({ queryKey: ['reports', 'versions', vars.id] })
    },
  })
}

export function useReportVersions(id: string | null) {
  return useQuery({
    queryKey: ['reports', 'versions', id] as const,
    queryFn: () => api.listReportVersions(id as string),
    enabled: !!id,
  })
}

/** 版本快照内容（按需加载：versionNo 为 null 时不请求） */
export function useReportVersionSnapshot(id: string | null, versionNo: number | null) {
  return useQuery({
    queryKey: ['reports', 'version-snapshot', id, versionNo] as const,
    queryFn: () => api.getReportVersion(id as string, versionNo as number),
    enabled: !!id && !!versionNo,
  })
}

export function useRollbackReportVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; versionNo: number }) => api.rollbackReportVersion(vars.id, vars.versionNo),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['reports', 'detail', vars.id] })
      qc.invalidateQueries({ queryKey: ['reports', 'versions', vars.id] })
    },
  })
}

// ---------------- 往来分析 ----------------
import type { TransactionOverviewItem, TransactionDetailItem, AgingAnalysisRow, InternalSummaryRow, InternalMirrorRow, TransactionFilterParams, PaginatedResponse } from '@/types'
import type { TransactionImportPreview, TransactionImportUploadResult, CollectionPlanItem, CollectionLogItem } from '@/types'
import type { TransactionTrendResult } from '@/types'
import type { TransactionCoverageResult, BatchCoverageRow } from '@/types'
import type { TransactionAccountOption, ManageAccountItem } from '@/types'

/** 往来总览：公司多选 + 单期间（inactive 科目后端强制剔除）；period 未定（期间列表加载中）时不发请求，避免跨期重复累加的首次查询 */
export function useTransactionOverview(params: { companyCodes?: string[]; period?: string }) {
  return useQuery({
    queryKey: ['transactions', 'overview', params.companyCodes ?? [], params.period] as const,
    queryFn: () => api.getTransactionOverview(params) as Promise<TransactionOverviewItem[]>,
    enabled: !!params.period,
    placeholderData: keepPreviousData,
  })
}

export function useTransactionDetails(params: TransactionFilterParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['transactions', 'details', params] as const,
    queryFn: () => api.getTransactionDetails(params as Record<string, unknown>) as Promise<PaginatedResponse<TransactionDetailItem>>,
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

export function useTransactionAging(params: { companyCode?: string; transactionType?: string; groupBy?: string; period?: string; accountCodes?: string; partyType?: string }, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['transactions', 'aging', params] as const,
    queryFn: () => api.getTransactionAging(params) as Promise<AgingAnalysisRow[]>,
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

/** 会计科目列表（主数据全集 + 实际数据合并，hasData 标识是否有交易数据）；按往来类型联动收窄 */
export function useTransactionAccounts(transactionType?: string) {
  return useQuery({
    queryKey: ['transactions', 'accounts', transactionType ?? 'all'] as const,
    queryFn: () => api.getTransactionAccounts(transactionType) as Promise<TransactionAccountOption[]>,
  })
}

/** 科目过滤管理：全部科目（含排除项） */
export function useManageAccounts() {
  return useQuery({
    queryKey: ['transactions', 'accounts-manage'] as const,
    queryFn: () => api.getManageAccounts() as Promise<ManageAccountItem[]>,
  })
}

/** 科目过滤管理：切换纳入/排除分析状态 */
export function useUpdateAccountStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ code, status }: { code: string; status: 'active' | 'inactive' }) => api.updateAccountStatus(code, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions', 'accounts-manage'] })
      qc.invalidateQueries({ queryKey: ['transactions', 'accounts'] })
      qc.invalidateQueries({ queryKey: ['transactions', 'details'] })
      qc.invalidateQueries({ queryKey: ['transactions', 'aging'] })
    },
  })
}

export function useInternalSummary(companyCode?: string) {
  return useQuery({
    queryKey: ['transactions', 'internal', 'summary', companyCode] as const,
    queryFn: () => api.getInternalSummary(companyCode) as Promise<InternalSummaryRow[]>,
  })
}

export function useInternalMirrorCheck(companyCode?: string) {
  return useQuery({
    queryKey: ['transactions', 'internal', 'mirror', companyCode] as const,
    queryFn: () => api.getInternalMirrorCheck(companyCode) as Promise<InternalMirrorRow[]>,
  })
}

export function useTransactionCounterparties(companyCode?: string) {
  return useQuery({
    queryKey: ['transactions', 'counterparties', companyCode] as const,
    queryFn: () => api.getTransactionCounterparties(companyCode) as Promise<{ counterpartyCode: string; counterpartyName: string | null }[]>,
  })
}

export function useTransactionLatestCutoff() {
  return useQuery({
    queryKey: ['transactions', 'latest-cutoff'] as const,
    queryFn: () => api.getTransactionLatestCutoff() as Promise<{ cutoffDate: string | null }>,
  })
}

/** 已导入数据的期间列表（倒序），供明细筛选 */
export function useTransactionPeriods() {
  return useQuery({
    queryKey: ['transactions', 'periods'] as const,
    queryFn: () => api.getTransactionPeriods() as Promise<string[]>,
  })
}

/** 往来余额变动趋势（单类型，按 公司×月份 聚合；支持财年轴与自定义期间范围，未选完自定义期间时 enabled 禁用） */
export function useTransactionTrend(params: { transactionType: string; companyCodes?: string[]; months?: number; fiscalYear?: string; periodFrom?: string; periodTo?: string }, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['transactions', 'trend', params.transactionType, params.companyCodes ?? [], params.months ?? 12, params.fiscalYear ?? '', params.periodFrom ?? '', params.periodTo ?? ''] as const,
    queryFn: () => api.getTransactionTrend(params) as Promise<TransactionTrendResult>,
    enabled: options.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

/** 往来数据涉及的财年列表（倒序），供趋势图财年筛选 */
export function useTransactionFiscalYears() {
  return useQuery({
    queryKey: ['transactions', 'fiscal-years'] as const,
    queryFn: () => api.getTransactionFiscalYears() as Promise<string[]>,
  })
}

// ---------------- Inventory（存货管理） ----------------

export interface InventoryCategoryRow {
  code: string
  name: string
  current: number
  yearStart: number
  samePeriod: number
  lastYearStart: number
  /** 占存货总额比例（%） */
  share: number
  /** 同比增减率（%） */
  yoy: number
  /** 金额降序排名（1 起） */
  rank: number
}

export interface InventoryOverviewResult {
  period: string
  companyCount: number
  total: { current: number; yearStart: number; samePeriod: number; lastYearStart: number }
  /** 存货周转天数（年初类时点列无口径，仅本期/同期） */
  turnoverDays: { current: number; samePeriod: number }
  categories: InventoryCategoryRow[]
}

export interface InventoryDetailRow {
  companyCode: string
  companyName: string
  companyShortName: string | null
  categoryCode: string
  categoryName: string
  current: number
  yearStart: number
  samePeriod: number
  lastYearStart: number
  yoy: number
}

export interface InventoryTrendResult {
  fiscalYear: string
  months: string[]
  total: number[]
  /** 各单体公司财年内逐月存货总额（汇总主体已展开为成员） */
  byCompany: { code: string; name: string; values: number[] }[]
}

/** 存货总览：总额 + 品类占比/排名 + 周转天数 */
export function useInventoryOverview(params: { period?: string; companyCodes?: string[] }) {
  return useQuery({
    queryKey: ['inventory', 'overview', params.period ?? '', params.companyCodes ?? []] as const,
    queryFn: () => api.getInventoryOverview({ period: params.period as string, companyCodes: params.companyCodes }) as Promise<InventoryOverviewResult>,
    enabled: !!params.period,
    placeholderData: keepPreviousData,
  })
}

/** 存货明细：公司 × 品类 */
export function useInventoryDetails(params: { period?: string; companyCodes?: string[] }) {
  return useQuery({
    queryKey: ['inventory', 'details', params.period ?? '', params.companyCodes ?? []] as const,
    queryFn: () => api.getInventoryDetails({ period: params.period as string, companyCodes: params.companyCodes }) as Promise<{ period: string; rows: InventoryDetailRow[] }>,
    enabled: !!params.period,
    placeholderData: keepPreviousData,
  })
}

/** 存货趋势：财年内各月总额与品类值 */
export function useInventoryTrend(params: { fiscalYear?: string | null; companyCodes?: string[] }) {
  return useQuery({
    queryKey: ['inventory', 'trend', params.fiscalYear ?? '', params.companyCodes ?? []] as const,
    queryFn: () => api.getInventoryTrend({ fiscalYear: params.fiscalYear as string, companyCodes: params.companyCodes }) as Promise<InventoryTrendResult>,
    enabled: !!params.fiscalYear,
    placeholderData: keepPreviousData,
  })
}

// ===== 往来导入（账龄汇总表） =====

export function usePreviewTransactionImport() {
  return useMutation({
    mutationFn: (vars: { files: File[]; valueUnit: string }) => api.previewTransactionImport(vars.files, vars.valueUnit) as Promise<TransactionImportPreview[]>,
  })
}

export function useImportTransactions() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { files: File[]; valueUnit: string }) => api.importTransactions(vars.files, vars.valueUnit) as Promise<TransactionImportUploadResult[]>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'imports'] }),
  })
}

/** 导入覆盖矩阵（公司×期间×六大类型） */
export function useTransactionImportCoverage(months?: number) {
  return useQuery({
    queryKey: ['transactions', 'import-coverage', months ?? 6] as const,
    queryFn: () => api.getTransactionImportCoverage(months) as Promise<TransactionCoverageResult>,
    placeholderData: keepPreviousData,
  })
}

/** 批次覆盖明细 */
export function useTransactionBatchCoverage(batchId: string | null) {
  return useQuery({
    queryKey: ['transactions', 'batch-coverage', batchId] as const,
    queryFn: () => api.getTransactionBatchCoverage(batchId as string) as Promise<BatchCoverageRow[]>,
    enabled: !!batchId,
  })
}

// ===== 催收管理 =====

export function useCollections(params: { page?: number; pageSize?: number; companyCode?: string; status?: string; counterpartyKeyword?: string }) {
  return useQuery({
    queryKey: ['transactions', 'collections', params] as const,
    queryFn: () => api.getCollections(params as Record<string, unknown>) as Promise<PaginatedResponse<CollectionPlanItem>>,
    placeholderData: keepPreviousData,
  })
}

export function useCreateCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.createCollection(data) as Promise<CollectionPlanItem>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', 'collections'] }),
  })
}

export function useGenerateCollections() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { companyCode?: string; minAgingBucket?: string }) => api.generateCollections(data) as Promise<{ created: number; skipped: number }>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', 'collections'] }),
  })
}

export function useUpdateCollection() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: Record<string, unknown> }) => api.updateCollection(vars.id, vars.data) as Promise<CollectionPlanItem>,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transactions', 'collections'] }),
  })
}

export function useCollectionLogs(planId: string | null) {
  return useQuery({
    queryKey: ['transactions', 'collections', 'logs', planId] as const,
    queryFn: () => api.getCollectionLogs(planId as string) as Promise<CollectionLogItem[]>,
    enabled: !!planId,
  })
}

export function useAddCollectionLog() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; content: string; attachmentUrl?: string }) => api.addCollectionLog(vars.id, { content: vars.content, attachmentUrl: vars.attachmentUrl }) as Promise<CollectionLogItem>,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ['transactions', 'collections', 'logs', vars.id] })
    },
  })
}
