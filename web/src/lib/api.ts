import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import type { ApiResponse, LoginRequest, LoginResponse, User, PaginatedResponse, FilterParams, KpiData, TrendData, Alert, ImportBatch, Company, AggregationMap, AccountSubject, Metric, Role, Permission } from '@/types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

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
            const { refreshToken, setTokens } = useAuthStore.getState()
            if (refreshToken) {
              const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {
                refreshToken,
              })
              
              const { accessToken, refreshToken: newRefreshToken } = response.data.data
              setTokens(accessToken, newRefreshToken)
              
              originalRequest.headers.Authorization = `Bearer ${accessToken}`
              return this.client(originalRequest)
            }
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
  async getDashboardOverview(): Promise<{
    kpiData: KpiData[]
    trendData: TrendData[]
    alerts: Alert[]
    lastUpdatedAt: string
  }> {
    return this.request({
      method: 'GET',
      url: '/dashboard/overview',
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

  async getDashboardAlerts(): Promise<Alert[]> {
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

  async getCompanies(): Promise<Company[]> {
    return this.request({
      method: 'GET',
      url: '/data/companies',
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

  async previewImport(file: File, templateType: string): Promise<{ dataRowCount: number; errorCount: number; operatingCount: number; staticCount: number; budgetCount: number; errors: { row: number; column: string; message: string }[] }> {
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

  async getFormulaRules(): Promise<{ id: string; name: string; formulaTemplate: string; refCodes: string[]; description: string | null }[]> {
    return this.request({
      method: 'GET',
      url: '/ai/formula-rules',
    })
  }

  async batchPreviewFormulas(data: { subjectType?: string }): Promise<{
    code: string
    name: string
    formula: string | null
    dependsOn: string[]
    explanation: string
    valid: boolean
    warnings: string[]
    ruleName: string | null
  }[]> {
    return this.request({
      method: 'POST',
      url: '/ai/formula/batch-preview',
      data,
    })
  }

  async batchApplyFormulas(items: { code: string; formula: string; dependsOn: string[] }[]): Promise<{ applied: number }> {
    return this.request({
      method: 'POST',
      url: '/ai/formula/batch-apply',
      data: { items },
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

  // 公式规则库管理
  async createFormulaRule(data: { name: string; formulaTemplate: string; description?: string }): Promise<unknown> {
    return this.request({ method: 'POST', url: '/ai/formula-rules', data })
  }

  async updateFormulaRule(id: string, data: { name?: string; formulaTemplate?: string; description?: string }): Promise<unknown> {
    return this.request({ method: 'PUT', url: `/ai/formula-rules/${id}`, data })
  }

  async toggleFormulaRule(id: string, enabled: boolean): Promise<unknown> {
    return this.request({ method: 'POST', url: `/ai/formula-rules/${id}/toggle`, data: { enabled } })
  }

  async deleteFormulaRule(id: string): Promise<void> {
    return this.request({ method: 'DELETE', url: `/ai/formula-rules/${id}` })
  }

  // ============ 分析报告：单项分析（公司 × 科目 × 期间） ============
  async listAnalyses(params: { companyCode?: string; subjectCode?: string; period?: string }): Promise<{ items: AnalysisItem[]; total: number }> {
    return this.request({ method: 'GET', url: '/reports/analyses', params })
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

  async batchAnalyses(params: { companyCodes: string[]; period?: string }): Promise<{ items: AnalysisItem[]; resolvedCompanyCodes: string[] }> {
    return this.request({ method: 'GET', url: '/reports/analyses/batch', params: { companyCodes: params.companyCodes.join(','), period: params.period } })
  }

  // ============ 分析报告：汇总报告 ============
  async listReports(params: { page?: number; pageSize?: number; status?: string }): Promise<{ items: ReportListItem[]; total: number; page: number; pageSize: number }> {
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

  async setReportSections(id: string, items: ReportSectionInput[]): Promise<ReportDetail> {
    return this.request({ method: 'PUT', url: `/reports/${id}/sections`, data: { items } })
  }

  async saveReportVersion(id: string, changeSummary?: string): Promise<{ versionNo: number }> {
    return this.request({ method: 'POST', url: `/reports/${id}/versions`, data: { changeSummary } })
  }

  async listReportVersions(id: string): Promise<{ items: ReportVersionItem[] }> {
    return this.request({ method: 'GET', url: `/reports/${id}/versions` })
  }

  async exportReport(id: string, format: 'docx' | 'pdf'): Promise<ReportExportData> {
    return this.request({ method: 'GET', url: `/reports/${id}/export`, params: { format } })
  }
}

// ============ 分析报告类型 ============
export interface AnalysisItem {
  id: string
  companyCode: string
  companyName: string | null
  subjectCode: string
  subjectName: string | null
  subjectType: string
  fiscalYear: string
  period: string
  title: string
  content: string
  metricContext: Record<string, unknown> | null
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

export interface AnalysisInput {
  companyCode: string
  subjectCode: string
  subjectType?: 'operating' | 'static'
  fiscalYear: string
  period: string
  title: string
  content: string
  metricContext?: Record<string, unknown> | null
}

export interface CompanyScope {
  type: 'company' | 'summary'
  code: string
  name?: string | null
}

export interface ReportListItem {
  id: string
  title: string
  fiscalYear: string
  period: string
  companyScope: CompanyScope
  status: string
  currentVersion: number
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export interface ReportSectionView {
  id: string
  orderNo: number
  title: string
  content: string
  analysisId: string | null
  source: { companyCode: string; companyName: string | null; subjectCode: string; subjectName: string | null; period: string } | null
  missing: boolean
}

export interface ReportDetail extends ReportListItem {
  sections: ReportSectionView[]
}

export interface ReportSectionInput {
  id?: string
  analysisId?: string | null
  title?: string
  content?: string
}

export interface ReportVersionItem {
  id: string
  versionNo: number
  changeSummary: string | null
  changedBy: string | null
  changedAt: string
}

export interface ReportExportData {
  title: string
  fiscalYear: string
  period: string
  scopeName: string | null
  generatedAt: string
  sections: { title: string; content: string; plainText: string; missing: boolean }[]
}

export const api = new ApiClient()
