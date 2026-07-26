import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AnalysisInput, AnalysisItem, ReportDetail, ReportListItem, ReportSectionInput, ReportVersionItem, ReportExportData } from '@/lib/api'
import type { FilterParams } from '@/types'

/**
 * React Query hook 层：集中封装对 @/lib/api 的调用与缓存键，
 * 写操作成功后失效相关查询。页面只依赖这些 hook，避免各处散落 api 调用。
 */

export const queryKeys = {
  dashboardOverview: ['dashboard', 'overview'] as const,
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
export function useDashboardOverview() {
  return useQuery({ queryKey: queryKeys.dashboardOverview, queryFn: () => api.getDashboardOverview() })
}

// ---------------- Indicators ----------------
export interface OperatingResult {
  items: OperatingRow[]
  total: number
  period: string
  companyCount: number
}
export interface OperatingRow {
  code: string; name: string; level: number; category: string; dataType: string; isLeaf: boolean
  budget: number; actual: number; samePeriod: number; ytd: number; samePeriodYtd: number
  yoy: number; achievement: number; ytdYoy: number; children?: OperatingRow[]
}
export interface StaticResult {
  items: StaticRow[]
  total: number
  companyCount: number
}
export interface StaticRow {
  code: string; name: string; level: number; category: string; dataType: string; isLeaf: boolean
  current: number; yearStart: number; samePeriod: number; lastYearStart: number; yoy: number; children?: StaticRow[]
}

export function useOperatingIndicators(params: { companyCode?: string; period?: string }) {
  return useQuery({
    queryKey: queryKeys.indicatorsOperating(params),
    queryFn: () => api.getOperatingIndicators(params as FilterParams) as unknown as Promise<OperatingResult>,
    // 筛选切换时保留上一次数据，避免内容区塌陷再撑回导致整页抖动
    placeholderData: keepPreviousData,
  })
}

export function useStaticIndicators(params: { companyCode?: string }) {
  return useQuery({
    queryKey: queryKeys.indicatorsStatic(params),
    queryFn: () => api.getStaticIndicators(params as FilterParams) as unknown as Promise<StaticResult>,
    placeholderData: keepPreviousData,
  })
}

export function useAvailablePeriods() {
  return useQuery<string[]>({
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
  rows: { code: string; name: string; values: Record<string, number> }[]
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
    mutationFn: (vars: { file: File; templateType: string }) => api.uploadImport(vars.file, vars.templateType),
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
    },
  })
}

/** 导入预览（dry-run）：不建批次不写库 */
export function usePreviewImport() {
  return useMutation({
    mutationFn: (vars: { file: File; templateType: string }) => api.previewImport(vars.file, vars.templateType),
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
  periodFrom?: string
  periodTo?: string
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

// ---------------- Admin: users / roles / audit ----------------
export function useUsers(params: FilterParams = {}) {
  return useQuery({ queryKey: queryKeys.users(params), queryFn: () => api.getUsers(params), placeholderData: keepPreviousData })
}

export function useRoles() {
  return useQuery({ queryKey: queryKeys.roles, queryFn: () => api.getRoles() })
}

export function useAuditLogs(params: FilterParams = {}) {
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
export interface FormulaGenItem {
  code: string
  name: string
  formula: string | null
  dependsOn: string[]
  explanation: string
  valid: boolean
  warnings: string[]
  ruleName: string | null
}

export function useGenerateFormula() {
  return useMutation({
    mutationFn: (data: { userDescription: string; subjectType?: string }) => api.generateFormula(data),
  })
}

// ---------------- AI 公式检测 ----------------
export interface FormulaCheckItem {
  code: string
  riskLevel: 'low' | 'medium' | 'high' | 'unknown'
  issues: string[]
  suggestion: string | null
  ruleWarnings: string[]
}

export function useCheckFormulas() {
  return useMutation({
    mutationFn: (data: { items: { code: string; name: string; formula: string }[]; subjectType?: string }) => api.checkFormulas(data),
  })
}

export function useFormulaRules() {
  return useQuery({ queryKey: ['ai', 'formula-rules'] as const, queryFn: () => api.getFormulaRules() })
}

export function useBatchPreviewFormulas() {
  return useMutation({
    mutationFn: (data: { subjectType?: string }) => api.batchPreviewFormulas(data),
  })
}

export function useBatchApplyFormulas() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (items: { code: string; formula: string; dependsOn: string[] }[]) => api.batchApplyFormulas(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['data', 'metrics'] }),
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

export function useCreateFormulaRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { name: string; formulaTemplate: string; description?: string }) => api.createFormulaRule(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'formula-rules'] }),
  })
}

export function useUpdateFormulaRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; data: { name?: string; formulaTemplate?: string; description?: string } }) => api.updateFormulaRule(vars.id, vars.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'formula-rules'] }),
  })
}

export function useToggleFormulaRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; enabled: boolean }) => api.toggleFormulaRule(vars.id, vars.enabled),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'formula-rules'] }),
  })
}

export function useDeleteFormulaRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteFormulaRule(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai', 'formula-rules'] }),
  })
}

// ---------------- 分析报告：单项分析 ----------------
export type { AnalysisItem, AnalysisInput, ReportDetail, ReportListItem, ReportSectionInput, ReportVersionItem, ReportExportData }

export function useAnalyses(params: { companyCode?: string; subjectCode?: string; period?: string }) {
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

// ---------------- 分析报告：汇总报告 ----------------
export function useReports(params: { page?: number; pageSize?: number; status?: string } = {}) {
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
    mutationFn: (vars: { id: string; items: ReportSectionInput[] }) => api.setReportSections(vars.id, vars.items),
    onSuccess: (_d, vars) => qc.invalidateQueries({ queryKey: ['reports', 'detail', vars.id] }),
  })
}

export function useSaveReportVersion() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vars: { id: string; changeSummary?: string }) => api.saveReportVersion(vars.id, vars.changeSummary),
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

// ---------------- 往来分析 ----------------
import type { TransactionOverviewItem, TransactionDetailItem, AgingAnalysisRow, InternalSummaryRow, InternalMirrorRow, TransactionFilterParams, PaginatedResponse } from '@/types'

export function useTransactionOverview(companyCode?: string) {
  return useQuery({
    queryKey: ['transactions', 'overview', companyCode] as const,
    queryFn: () => api.getTransactionOverview(companyCode) as Promise<TransactionOverviewItem[]>,
  })
}

export function useTransactionDetails(params: TransactionFilterParams) {
  return useQuery({
    queryKey: ['transactions', 'details', params] as const,
    queryFn: () => api.getTransactionDetails(params as Record<string, unknown>) as Promise<PaginatedResponse<TransactionDetailItem>>,
    placeholderData: keepPreviousData,
  })
}

export function useTransactionAging(params: { companyCode?: string; transactionType?: string; groupBy?: string }) {
  return useQuery({
    queryKey: ['transactions', 'aging', params] as const,
    queryFn: () => api.getTransactionAging(params) as Promise<AgingAnalysisRow[]>,
    placeholderData: keepPreviousData,
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
