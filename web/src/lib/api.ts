import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import type { ApiResponse, LoginRequest, LoginResponse, User, PaginatedResponse, FilterParams, KpiData, TrendData, DashboardAlert, ReceivableRow, ProductBudgetResponse, SubjectBudgetResponse, ProductCategory, ProductCategoryCheckResult, SubjectBudgetConfig, SubjectBudgetConfigCheckResult, ImportBatch, Company, AggregationMap, AccountSubject, Metric, Role, Permission, ReclassifyLog, AnalysisItem, AnalysisInput, ReportListItem, ReportDetail, ReportSectionInput, ReportVersionItem, ReportVersionSnapshot, ReportExportData } from '@/types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

/**
 * 单飞刷新：并发 401 请求共享同一个 refresh 流程。
 * 后端 refresh token 为轮转制——同一 token 只可成功使用一次（重复使用返回 401），
 * 若多个 401 各自独立 refresh，竞态中除首个外全部失败并触发登出跳转。
 * 该 Promise 在成功后置空，保证下次 401 可重新发起刷新。
 */
let refreshPromise: Promise<string> | null = null

async function refreshAccessTokenOnce(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const { refreshToken, setTokens } = useAuthStore.getState()
      if (!refreshToken) throw new Error('无刷新令牌')
      const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
        refreshToken,
      })
      const { accessToken, refreshToken: newRefreshToken } = response.data.data
      setTokens(accessToken, newRefreshToken)
      return accessToken
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

/** 导入预览（dry-run）返回结构：计数 + 错误明细 + 覆盖摘要 + 激活影响预告 + 看板 KPI 覆盖检查 */
export interface ImportPreviewResult {
  dataRowCount: number
  errorCount: number
  operatingCount: number
  staticCount: number
  budgetCount: number
  errors: { row: number; column: string; message: string }[]
  sampleRows?: { headers: string[]; rows: (string | number)[][] }
  summary?: {
    companyCount: number
    subjectCount: number
    periodRange: { min: string | null; max: string | null }
    totalValue: number
    zeroValueCount: number
    duplicateCount: number
    duplicateSamples: string[]
  }
  activationImpact?: {
    activeBatch: { id: string; filename: string } | null
    newPeriods: string[]
    overlappingPeriods: string[]
    /** 生效批次有而文件无（按期间合并：激活后继续保留生效） */
    retainedPeriods: string[]
  } | null
  kpiCoverage?: { covered: string[]; missing: string[] } | null
}

/** 可用期间与财年列表（财年降序，由 active 批次期间派生） */
export interface AvailablePeriodsResult {
  periods: string[]
  fiscalYears: string[]
  fiscalStartMonth: number
}

class ApiClient {
  private client: AxiosInstance

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    })

    this.client.interceptors.request.use(
      (config) => {
        const { accessToken } = useAuthStore.getState()
        if (accessToken) {
          config.headers.Authorization = `Bearer ${accessToken}`
        }
        return config
      },
      (error) => Promise.reject(error)
    )

    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const originalRequest = error.config
        
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true
          
          try {
            const accessToken = await refreshAccessTokenOnce()
            originalRequest.headers.Authorization = `Bearer ${accessToken}`
            return this.client(originalRequest)
          } catch (refreshError) {
            useAuthStore.getState().logout()
            window.location.href = '/login'
            return Promise.reject(refreshError)
          }
        }
        
        return Promise.reject(error)
      }
    )
  }

  private async request<T>(config: AxiosRequestConfig): Promise<T> {
    try {
      const response: AxiosResponse<ApiResponse<T>> = await this.client(config)
      if (response.data.code !== 0) {
        throw new Error(response.data.message || '请求失败')
      }
      return response.data.data
    } catch (err) {
      // 优先提取后端统一响应中的业务错误信息（HTTP 非 2xx 时）
      const message = (err as { response?: { data?: { message?: string } } }).response?.data?.message
      if (message) {
        throw new Error(message)
      }
      throw err
    }
  }

  // Auth API
  async login(data: LoginRequest): Promise<LoginResponse> {
    return this.request<LoginResponse>({
      method: 'POST',
      url: '/auth/login',
      data,
    })
  }

  async logout(): Promise<void> {
    return this.request<void>({
      method: 'POST',
      url: '/auth/logout',
    })
  }

  async getProfile(): Promise<User> {
    return this.request<User>({
      method: 'GET',
      url: '/auth/profile',
    })
  }

  async updatePassword(data: { oldPassword: string; newPassword: string }): Promise<void> {
    return this.request<void>({
      method: 'PUT',
      url: '/auth/password',
      data,
    })
  }

  // Dashboard API
  async getDashboardOverview(params?: { period?: string; companyCode?: string }): Promise<{
    kpiData: KpiData[]
    trendData: TrendData[]
    alerts: DashboardAlert[]
    lastUpdatedAt: string
    period: string
    availablePeriods: string[]
  }> {
    return this.request({
      method: 'GET',
      url: '/dashboard/overview',
      params,
    })
  }

  /** 应收账款按主体分布（单体/汇总口径） */
  async getDashboardReceivables(params: { period: string; mode: 'single' | 'summary' }): Promise<{
    period: string | null
    rows: ReceivableRow[]
  }> {
    return this.request({
      method: 'GET',
      url: '/dashboard/receivables',
      params,
    })
  }

  async getDashboardDrill(params: {
    companyCode?: string
    period?: string
  }): Promise<{
    kpiData: KpiData[]
    trendData: TrendData[]
  }> {
    return this.request({
      method: 'GET',
      url: '/dashboard/drill',
      params,
    })
  }

  async getDashboardTrend(params: {
    months?: number
    compareType?: 'yoy' | 'mom'
  }): Promise<TrendData[]> {
    return this.request({
      method: 'GET',
      url: '/dashboard/trend',
      params,
    })
  }

  /** 品类预算达成表（单期间）：收入/毛利品类的预算、本月/累计金额、达成率与同比 */
  async getProductBudget(params?: { period?: string; companyCode?: string }): Promise<ProductBudgetResponse> {
    return this.request({
      method: 'GET',
      url: '/dashboard/product-budget',
      params,
    })
  }

  /** 主体预算达成表（单期间）：全部单体公司或汇总主体的收入/毛利/净利润预算达成；companyCode 传入时仅返回该主体一行 */
  async getSubjectBudget(params: { period?: string; mode: 'single' | 'summary'; companyCode?: string }): Promise<SubjectBudgetResponse> {
    return this.request({
      method: 'GET',
      url: '/dashboard/subject-budget',
      params,
    })
  }

  // ---- 品类配置（品类预算达成分析，数据维护）----
  async getProductCategories(): Promise<ProductCategory[]> {
    return this.request({
      method: 'GET',
      url: '/data/product-categories',
    })
  }

  /** 科目树变化检测：品类覆盖状态 / 未覆盖科目 / 失效关键词 / 毛利镜像缺失 */
  async checkProductCategories(): Promise<ProductCategoryCheckResult> {
    return this.request({
      method: 'GET',
      url: '/data/product-categories/check',
    })
  }

  async createProductCategory(input: { code: string; name: string; subjectKeyword: string; sortOrder?: number; status?: string }): Promise<ProductCategory> {
    return this.request({
      method: 'POST',
      url: '/data/product-categories',
      data: input,
    })
  }

  async updateProductCategory(id: string, input: { name?: string; subjectKeyword?: string; sortOrder?: number; status?: string }): Promise<ProductCategory> {
    return this.request({
      method: 'PUT',
      url: `/data/product-categories/${id}`,
      data: input,
    })
  }

  async deleteProductCategory(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/data/product-categories/${id}`,
    })
  }

  // ---- 主体展示配置（主体预算达成分析，数据维护）----
  async getSubjectBudgetConfigs(): Promise<SubjectBudgetConfig[]> {
    return this.request({
      method: 'GET',
      url: '/data/subject-budget-configs',
    })
  }

  /** 主体变化检测：配置状态 + 公司表新增但未配置的主体 */
  async checkSubjectBudgetConfigs(): Promise<SubjectBudgetConfigCheckResult> {
    return this.request({
      method: 'GET',
      url: '/data/subject-budget-configs/check',
    })
  }

  async createSubjectBudgetConfig(input: { companyCode: string; sortOrder?: number; status?: string }): Promise<SubjectBudgetConfig> {
    return this.request({
      method: 'POST',
      url: '/data/subject-budget-configs',
      data: input,
    })
  }

  async updateSubjectBudgetConfig(id: string, input: { sortOrder?: number; status?: string }): Promise<SubjectBudgetConfig> {
    return this.request({
      method: 'PUT',
      url: `/data/subject-budget-configs/${id}`,
      data: input,
    })
  }

  async deleteSubjectBudgetConfig(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/data/subject-budget-configs/${id}`,
    })
  }

  async getDashboardAlerts(): Promise<DashboardAlert[]> {
    return this.request({
      method: 'GET',
      url: '/dashboard/alerts',
    })
  }

  // Indicators API
  async getOperatingIndicators(params: FilterParams): Promise<PaginatedResponse<any>> {
    return this.request({
      method: 'GET',
      url: '/indicators/operating',
      params,
    })
  }

  async getStaticIndicators(params: FilterParams): Promise<PaginatedResponse<any>> {
    return this.request({
      method: 'GET',
      url: '/indicators/static',
      params,
    })
  }

  async getIndicatorTree(): Promise<any> {
    return this.request({
      method: 'GET',
      url: '/indicators/tree',
    })
  }

  async getAvailablePeriods(): Promise<AvailablePeriodsResult> {
    return this.request({
      method: 'GET',
      url: '/indicators/periods',
    })
  }

  async getIndicatorByCode(code: string): Promise<any> {
    return this.request({
      method: 'GET',
      url: `/indicators/${code}`,
    })
  }

  async createCrossTable(data: any): Promise<any> {
    return this.request({
      method: 'POST',
      url: '/indicators/cross',
      data,
    })
  }

  async exportIndicators(params: FilterParams & { format: 'excel' | 'pdf' }): Promise<Blob> {
    const response = await this.client.get('/indicators/export', {
      params,
      responseType: 'blob',
    })
    return response.data as any
  }

  // Data Management API
  async uploadImport(file: File, templateType: string): Promise<ImportBatch> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('templateType', templateType)
    
    return this.request({
      method: 'POST',
      url: '/data/imports',
      data: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    })
  }

  async getImports(params?: FilterParams): Promise<PaginatedResponse<ImportBatch>> {
    return this.request({
      method: 'GET',
      url: '/data/imports',
      params,
    })
  }

  async getImportById(id: string): Promise<ImportBatch> {
    return this.request({
      method: 'GET',
      url: `/data/imports/${id}`,
    })
  }

  async activateImport(id: string): Promise<void> {
    return this.request({
      method: 'POST',
      url: `/data/imports/${id}/activate`,
    })
  }

  /** 手动归档批次（高危，仅 superadmin） */
  async archiveImport(id: string): Promise<void> {
    return this.request({
      method: 'POST',
      url: `/data/imports/${id}/archive`,
    })
  }

  /** 清除批次数据（高危，仅 superadmin）：物理删除事实明细，批次置 purged */
  async purgeImport(id: string): Promise<void> {
    return this.request({
      method: 'POST',
      url: `/data/imports/${id}/purge`,
    })
  }

  async getCrossTable(params: any): Promise<any> {
    return this.request({
      method: 'GET',
      url: '/data/cross-table',
      params,
    })
  }

  async getMetrics(params?: FilterParams): Promise<PaginatedResponse<Metric>> {
    return this.request({
      method: 'GET',
      url: '/data/metrics',
      params,
    })
  }

  async createMetric(data: Partial<Metric>): Promise<Metric> {
    return this.request({
      method: 'POST',
      url: '/data/metrics',
      data,
    })
  }

  async updateMetric(id: string, data: Partial<Metric>): Promise<Metric> {
    return this.request({
      method: 'PUT',
      url: `/data/metrics/${id}`,
      data,
    })
  }

  async deleteMetric(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/data/metrics/${id}`,
    })
  }

  /** 彻底删除指标（高危，仅 superadmin）：需先停用 */
  async purgeMetric(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/data/metrics/${id}/purge`,
    })
  }

  /** 恢复启用已停用指标；clearFormula=true 时公式失效可清空后恢复 */
  async restoreMetric(id: string, data?: { clearFormula?: boolean }): Promise<Metric> {
    return this.request({
      method: 'POST',
      url: `/data/metrics/${id}/restore`,
      data,
    })
  }

  /** 指标类型转换（高危，仅 superadmin）：data ↔ calc，data→calc 可携带初始公式 */
  async convertMetric(id: string, data: { dataType: 'data' | 'calc'; formula?: string }): Promise<Metric> {
    return this.request({
      method: 'POST',
      url: `/data/metrics/${id}/convert`,
      data,
    })
  }

  async getCompanies(params?: { includeInactive?: string }): Promise<Company[]> {
    return this.request({
      method: 'GET',
      url: '/data/companies',
      params,
    })
  }

  async createCompany(data: Partial<Company>): Promise<Company> {
    return this.request({ method: 'POST', url: '/data/companies', data })
  }

  async updateCompany(id: string, data: Partial<Company>): Promise<Company> {
    return this.request({ method: 'PUT', url: `/data/companies/${id}`, data })
  }

  async deleteCompany(id: string): Promise<void> {
    return this.request({ method: 'DELETE', url: `/data/companies/${id}` })
  }

  async getAggregationMap(summaryCode?: string): Promise<AggregationMap[]> {
    return this.request({ method: 'GET', url: '/data/aggregation-map', params: summaryCode ? { summaryCode } : undefined })
  }

  async createAggregationMap(data: { summaryCompanyCode: string; singleCompanyCode: string; isInternalElimination?: boolean }): Promise<AggregationMap> {
    return this.request({ method: 'POST', url: '/data/aggregation-map', data })
  }

  async deleteAggregationMap(id: string): Promise<void> {
    return this.request({ method: 'DELETE', url: `/data/aggregation-map/${id}` })
  }

  // ---------------- 数据重分类 ----------------
  async previewReclassifyCompany(data: {
    templateType: string; sourceCompanyCode: string; targetCompanyCode: string
    accountCodes?: string[]; period: string
    transferMode?: 'all' | 'ratio' | 'amount'; ratio?: number; amount?: number
  }): Promise<{ affectedRows: number; totalValue: number; transferValue: number; conflictRows: number; createRows: number }> {
    return this.request({ method: 'POST', url: '/data/reclassify/company/preview', data })
  }

  async reclassifyCompany(data: {
    templateType: string; sourceCompanyCode: string; targetCompanyCode: string
    accountCodes?: string[]; period: string
    transferMode?: 'all' | 'ratio' | 'amount'; ratio?: number; amount?: number
  }): Promise<{ affectedRows: number; mergedRows: number; createdRows: number; transferValue: number }> {
    return this.request({ method: 'POST', url: '/data/reclassify/company', data })
  }

  async previewAdjustSubject(data: {
    templateType: string; companyCode: string
    adjustMode?: 'both' | 'decrease' | 'increase'
    sourceAccountCode?: string; targetAccountCode?: string
    decreaseAmount?: number; increaseAmount?: number; period: string
  }): Promise<{ affectedRows: number; sourceTotal: number; targetTotal?: number; decreaseAmount: number; increaseAmount: number; netChange: number; valueType?: 'amount' | 'quantity' | 'ratio' }> {
    return this.request({ method: 'POST', url: '/data/reclassify/subject/preview', data })
  }

  async adjustSubject(data: {
    templateType: string; companyCode: string
    adjustMode?: 'both' | 'decrease' | 'increase'
    sourceAccountCode?: string; targetAccountCode?: string
    decreaseAmount?: number; increaseAmount?: number; period: string; reason: string
  }): Promise<{ affectedRows: number; decreaseAmount: number; increaseAmount: number; netChange: number; mergedRows: number; createdRows: number }> {
    return this.request({ method: 'POST', url: '/data/reclassify/subject', data })
  }

  async getReclassifyLogs(params?: FilterParams & { type?: string }): Promise<PaginatedResponse<ReclassifyLog>> {
    return this.request({ method: 'GET', url: '/data/reclassify/logs', params })
  }

  async revertReclassifyLog(id: string): Promise<{ restoredRows: number }> {
    return this.request({ method: 'POST', url: `/data/reclassify/logs/${id}/revert` })
  }

  async reclassifySubject(id: string, parentCode: string | null): Promise<AccountSubject> {
    return this.request({ method: 'POST', url: `/data/subjects/${id}/reclassify`, data: { parentCode } })
  }

  async previewImport(file: File, templateType: string): Promise<ImportPreviewResult> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('templateType', templateType)
    return this.request({
      method: 'POST',
      url: '/data/imports/preview',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  }

  async getSubjects(params?: FilterParams): Promise<PaginatedResponse<AccountSubject>> {
    return this.request({
      method: 'GET',
      url: '/data/subjects',
      params,
    })
  }

  async getSubjectTree(type: 'operating' | 'static'): Promise<{
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
  }[]> {
    return this.request({
      method: 'GET',
      url: '/data/subjects/tree',
      params: { type },
    })
  }

  async createSubject(data: Partial<AccountSubject>): Promise<AccountSubject> {
    return this.request({
      method: 'POST',
      url: '/data/subjects',
      data,
    })
  }

  async updateSubject(id: string, data: Partial<AccountSubject>): Promise<AccountSubject> {
    return this.request({
      method: 'PUT',
      url: `/data/subjects/${id}`,
      data,
    })
  }

  async deleteSubject(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/data/subjects/${id}`,
    })
  }



  async exportData(params: FilterParams & { format: 'excel' | 'pdf' }): Promise<Blob> {
    const response = await this.client.get('/data/export', {
      params,
      responseType: 'blob',
    })
    return response.data as any
  }

  // Admin API
  async getUsers(params?: FilterParams): Promise<PaginatedResponse<User>> {
    return this.request({
      method: 'GET',
      url: '/admin/users',
      params,
    })
  }

  async createUser(data: Partial<User> & { password: string }): Promise<User> {
    return this.request({
      method: 'POST',
      url: '/admin/users',
      data,
    })
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    return this.request({
      method: 'PUT',
      url: `/admin/users/${id}`,
      data,
    })
  }

  async deleteUser(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/admin/users/${id}`,
    })
  }

  /** 彻底删除用户（高危，仅 superadmin）：需先停用 */
  async purgeUser(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/admin/users/${id}/purge`,
    })
  }

  async resetPassword(id: string, newPassword: string): Promise<void> {
    return this.request({
      method: 'POST',
      url: `/admin/users/${id}/reset-password`,
      data: { newPassword },
    })
  }

  async exportUsers(params?: FilterParams): Promise<Blob> {
    const response = await this.client.get('/admin/users/export', {
      params,
      responseType: 'blob',
    })
    return response.data as any
  }

  async getRoles(): Promise<Role[]> {
    return this.request({
      method: 'GET',
      url: '/admin/roles',
    })
  }

  async createRole(data: Partial<Role>): Promise<Role> {
    return this.request({
      method: 'POST',
      url: '/admin/roles',
      data,
    })
  }

  async updateRole(id: string, data: Partial<Role>): Promise<Role> {
    return this.request({
      method: 'PUT',
      url: `/admin/roles/${id}`,
      data,
    })
  }

  async deleteRole(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/admin/roles/${id}`,
    })
  }

  async cloneRole(id: string, newName: string): Promise<Role> {
    return this.request({
      method: 'POST',
      url: `/admin/roles/${id}/clone`,
      data: { name: newName },
    })
  }

  async getPermissions(): Promise<Permission[]> {
    return this.request({
      method: 'GET',
      url: '/admin/permissions',
    })
  }

  async updatePermissions(roleId: string, permissions: Permission[]): Promise<void> {
    return this.request({
      method: 'PUT',
      url: `/admin/roles/${roleId}/permissions`,
      data: { permissions },
    })
  }

  async getAuditLogs(params?: FilterParams): Promise<PaginatedResponse<any>> {
    return this.request({
      method: 'GET',
      url: '/admin/audit-logs',
      params,
    })
  }

  // AI API
  async generateFormula(data: { userDescription: string; subjectType?: string }): Promise<{
    suggestedFormula: string | null
    dependsOn: string[]
    explanation: string
    valid: boolean
    warnings: string[]
  }> {
    return this.request({
      method: 'POST',
      url: '/ai/formula',
      data,
    })
  }

  // 指标公式版本历史 / 回滚 / 试算 / 依赖分析 / 审批
  async getMetricHistory(id: string): Promise<{ version: number; formula: string; description: string | null; changedByName: string; changedAt: string; approvedBy: string | null }[]> {
    return this.request({ method: 'GET', url: `/data/metrics/${id}/history` })
  }

  async rollbackMetric(id: string, version: number): Promise<Metric> {
    return this.request({ method: 'POST', url: `/data/metrics/${id}/rollback`, data: { version } })
  }

  async trialCalcFormula(data: { formula: string; companyCode?: string; period?: string }): Promise<{ value: number | null; period: string | null; operands: { code: string; name: string; value: number }[] }> {
    return this.request({ method: 'POST', url: '/data/metrics/trial-calc', data })
  }

  async analyzeDependencies(id: string): Promise<{ code: string; dependsOn: { code: string; name: string }[]; usedBy: { code: string; name: string }[] }> {
    return this.request({ method: 'GET', url: `/data/metrics/${id}/dependencies` })
  }

  async approveMetric(id: string): Promise<{ approved: boolean }> {
    return this.request({ method: 'POST', url: `/data/metrics/${id}/approve` })
  }

  async rejectMetric(id: string): Promise<Metric> {
    return this.request({ method: 'POST', url: `/data/metrics/${id}/reject` })
  }

  // ============ 分析报告：单项分析（公司 × 科目 × 期间） ============
  async listAnalyses(params: { companyCode?: string; subjectCode?: string; period?: string; keyword?: string; includeInactive?: boolean; page?: number; pageSize?: number }): Promise<{ items: AnalysisItem[]; total: number; page: number; pageSize: number }> {
    return this.request({ method: 'GET', url: '/reports/analyses', params: { ...params, includeInactive: params.includeInactive ? '1' : undefined } })
  }

  async getAnalysis(id: string): Promise<AnalysisItem> {
    return this.request({ method: 'GET', url: `/reports/analyses/${id}` })
  }

  async createAnalysis(data: AnalysisInput): Promise<AnalysisItem> {
    return this.request({ method: 'POST', url: '/reports/analyses', data })
  }

  async updateAnalysis(id: string, data: { title?: string; content?: string; metricContext?: Record<string, unknown> | null }): Promise<AnalysisItem> {
    return this.request({ method: 'PUT', url: `/reports/analyses/${id}`, data })
  }

  async deleteAnalysis(id: string): Promise<void> {
    return this.request({ method: 'DELETE', url: `/reports/analyses/${id}` })
  }

  async restoreAnalysis(id: string): Promise<AnalysisItem> {
    return this.request({ method: 'PUT', url: `/reports/analyses/${id}/restore` })
  }

  async batchAnalyses(params: { companyCodes: string[]; period?: string }): Promise<{ items: AnalysisItem[]; resolvedCompanyCodes: string[] }> {
    return this.request({ method: 'GET', url: '/reports/analyses/batch', params: { companyCodes: params.companyCodes.join(','), period: params.period } })
  }

  // ============ 分析报告：汇总报告 ============
  async listReports(params: { page?: number; pageSize?: number; status?: string; keyword?: string }): Promise<{ items: ReportListItem[]; total: number; page: number; pageSize: number }> {
    return this.request({ method: 'GET', url: '/reports', params })
  }

  async getReport(id: string): Promise<ReportDetail> {
    return this.request({ method: 'GET', url: `/reports/${id}` })
  }

  async createReport(data: { title: string; fiscalYear: string; period: string; companyScope: { type: 'company' | 'summary'; code: string } }): Promise<ReportDetail> {
    return this.request({ method: 'POST', url: '/reports', data })
  }

  async updateReport(id: string, data: { title?: string; status?: string }): Promise<ReportDetail> {
    return this.request({ method: 'PUT', url: `/reports/${id}`, data })
  }

  async deleteReport(id: string): Promise<void> {
    return this.request({ method: 'DELETE', url: `/reports/${id}` })
  }

  async generateReportSections(id: string): Promise<ReportDetail> {
    return this.request({ method: 'POST', url: `/reports/${id}/sections/generate` })
  }

  async setReportSections(id: string, items: ReportSectionInput[], expectedUpdatedAt?: string): Promise<ReportDetail> {
    return this.request({ method: 'PUT', url: `/reports/${id}/sections`, data: { items, expectedUpdatedAt } })
  }

  async saveReportVersion(id: string, changeSummary?: string, expectedUpdatedAt?: string): Promise<{ versionNo: number }> {
    return this.request({ method: 'POST', url: `/reports/${id}/versions`, data: { changeSummary, expectedUpdatedAt } })
  }

  async listReportVersions(id: string): Promise<{ items: ReportVersionItem[] }> {
    return this.request({ method: 'GET', url: `/reports/${id}/versions` })
  }

  async getReportVersion(id: string, versionNo: number): Promise<ReportVersionSnapshot> {
    return this.request({ method: 'GET', url: `/reports/${id}/versions/${versionNo}` })
  }

  async rollbackReportVersion(id: string, versionNo: number): Promise<ReportDetail> {
    return this.request({ method: 'POST', url: `/reports/${id}/versions/${versionNo}/rollback` })
  }

  async exportReport(id: string, format: 'docx' | 'pdf'): Promise<ReportExportData> {
    return this.request({ method: 'GET', url: `/reports/${id}/export`, params: { format } })
  }

  // ============ 往来分析 ============
  // 总览：公司多选（逗号分隔，空=全部）+ 单期间过滤（期末余额为时点数）
  async getTransactionOverview(params: { companyCodes?: string[]; period?: string } = {}) {
    return this.request({
      method: 'GET',
      url: '/transactions/overview',
      params: {
        companyCodes: params.companyCodes?.length ? params.companyCodes.join(',') : undefined,
        period: params.period,
      },
    })
  }

  async getTransactionDetails(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/details', params })
  }

  // 账龄分析：支持单期间与科目多选（逗号分隔）
  async getTransactionAging(params: { companyCode?: string; transactionType?: string; groupBy?: string; period?: string; accountCodes?: string; partyType?: string }) {
    return this.request({ method: 'GET', url: '/transactions/aging', params })
  }

  // 会计科目列表（去重，供科目多选筛选；可按往来类型过滤）
  async getTransactionAccounts(transactionType?: string) {
    return this.request({ method: 'GET', url: '/transactions/accounts', params: { transactionType } })
  }

  // 科目过滤管理：全部科目（含排除项）
  async getManageAccounts() {
    return this.request({ method: 'GET', url: '/transactions/accounts/manage' })
  }

  // 科目过滤管理：切换纳入/排除分析状态
  async updateAccountStatus(code: string, status: 'active' | 'inactive') {
    return this.request({ method: 'PATCH', url: `/transactions/accounts/${code}/status`, data: { status } })
  }

  async getInternalSummary(companyCode?: string) {
    return this.request({ method: 'GET', url: '/transactions/internal/summary', params: { companyCode } })
  }

  async getInternalMirrorCheck(companyCode?: string) {
    return this.request({ method: 'GET', url: '/transactions/internal/mirror-check', params: { companyCode } })
  }

  async getTransactionCounterparties(companyCode?: string) {
    return this.request({ method: 'GET', url: '/transactions/counterparties', params: { companyCode } })
  }

  async getTransactionLatestCutoff() {
    return this.request({ method: 'GET', url: '/transactions/latest-cutoff' })
  }

  // 已导入数据的期间列表（明细筛选用）
  async getTransactionPeriods() {
    return this.request({ method: 'GET', url: '/transactions/periods' })
  }

  // 往来余额变动趋势（单类型，按 公司×月份 聚合；支持财年轴）
  async getTransactionTrend(params: { transactionType: string; companyCodes?: string[]; months?: number; fiscalYear?: string }) {
    return this.request({
      method: 'GET',
      url: '/transactions/trend',
      params: {
        transactionType: params.transactionType,
        companyCodes: params.companyCodes?.length ? params.companyCodes.join(',') : undefined,
        months: params.months,
        fiscalYear: params.fiscalYear,
      },
    })
  }

  // 往来数据涉及的财年列表（倒序）
  async getTransactionFiscalYears() {
    return this.request({ method: 'GET', url: '/transactions/fiscal-years' })
  }

  // ==================== 存货管理 ====================

  // 存货总览：总额四维值 + 品类占比/排名 + 存货周转天数
  async getInventoryOverview(params: { period: string; companyCodes?: string[] }) {
    return this.request({
      method: 'GET',
      url: '/inventory/overview',
      params: {
        period: params.period,
        companyCodes: params.companyCodes?.length ? params.companyCodes.join(',') : undefined,
      },
    })
  }

  // 存货明细：公司 × 品类（本期/年初/同期）
  async getInventoryDetails(params: { period: string; companyCodes?: string[] }) {
    return this.request({
      method: 'GET',
      url: '/inventory/details',
      params: {
        period: params.period,
        companyCodes: params.companyCodes?.length ? params.companyCodes.join(',') : undefined,
      },
    })
  }

  // 存货趋势：财年内各月总额与品类值
  async getInventoryTrend(params: { fiscalYear: string; companyCodes?: string[] }) {
    return this.request({
      method: 'GET',
      url: '/inventory/trend',
      params: {
        fiscalYear: params.fiscalYear,
        companyCodes: params.companyCodes?.length ? params.companyCodes.join(',') : undefined,
      },
    })
  }

  // 往来导入（六大往来账龄汇总表，多文件）
  async previewTransactionImport(files: File[]) {
    const formData = new FormData()
    for (const f of files) formData.append('files', f)
    return this.request({
      method: 'POST',
      url: '/transactions/import/preview',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  }

  async importTransactions(files: File[]) {
    const formData = new FormData()
    for (const f of files) formData.append('files', f)
    return this.request({
      method: 'POST',
      url: '/transactions/import',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  }

  // 导入覆盖矩阵（公司×期间×六大类型 的 已生效/草稿/缺失 状态）
  async getTransactionImportCoverage(months?: number) {
    return this.request({ method: 'GET', url: '/transactions/import/coverage', params: { months } })
  }

  async getTransactionBatchCoverage(id: string) {
    return this.request({ method: 'GET', url: `/transactions/import/batches/${id}/coverage` })
  }

  // 催收管理
  async getCollections(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/collections', params })
  }

  async createCollection(data: Record<string, unknown>) {
    return this.request({ method: 'POST', url: '/transactions/collections', data })
  }

  async generateCollections(data: { companyCode?: string; minAgingBucket?: string }) {
    return this.request({ method: 'POST', url: '/transactions/collections/generate', data })
  }

  async updateCollection(id: string, data: Record<string, unknown>) {
    return this.request({ method: 'PATCH', url: `/transactions/collections/${id}`, data })
  }

  async getCollectionLogs(id: string) {
    return this.request({ method: 'GET', url: `/transactions/collections/${id}/logs` })
  }

  async addCollectionLog(id: string, data: { content: string; attachmentUrl?: string }) {
    return this.request({ method: 'POST', url: `/transactions/collections/${id}/logs`, data })
  }

  // ============ 其他工具 ============
  async toolsEnterpriseSearch(keyword: string): Promise<EnterpriseSearchResult | null> {
    return this.request({ method: 'GET', url: '/tools/enterprise/search', params: { keyword } })
  }

  async toolsEnterpriseHistory(params: { page?: number; pageSize?: number }): Promise<{ items: EnterpriseHistoryItem[]; total: number }> {
    return this.request({ method: 'GET', url: '/tools/enterprise/history', params })
  }
}

// ============ 分析报告类型（定义已集中至 @/types，此处 re-export 保持兼容） ============
export type {
  AnalysisItem,
  AnalysisInput,
  ReportListItem,
  ReportSectionView,
  ReportDetail,
  ReportSectionInput,
  ReportVersionItem,
  ReportVersionSnapshot,
  ReportExportData,
} from '@/types'
export type { ReportCompanyScope as CompanyScope } from '@/types'

// ============ 其他工具类型 ============
export interface EnterpriseSearchResult {
  name: string
  creditCode: string
  legalPerson: string | null
  registeredCapital: string | null
  establishDate: string | null
  status: string | null
  companyType: string | null
  industry: string | null
  registeredAddress: string | null
  businessScope: string | null
  fromCache: boolean
  provider: string
  fetchedAt: string
}

export interface EnterpriseHistoryItem {
  id: string
  keyword: string
  matchedName: string | null
  fromCache: boolean
  createdAt: string
}

export const api = new ApiClient()
