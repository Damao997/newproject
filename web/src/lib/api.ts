import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import type { ApiResponse, LoginRequest, LoginResponse, User, PaginatedResponse, FilterParams, BatchActivateCheckResult, KpiData, TrendData, DashboardAlert, ReceivableRow, ProductBudgetResponse, SubjectBudgetResponse, ExpenseAnalysisResponse, KeyMetricsResponse, ProductCategory, ProductCategoryCheckResult, KeyMetricsProduct, KeyMetricsProductCheckResult, ExpenseMapping, ExpenseMappingCheckResult, SubjectBudgetConfig, SubjectBudgetConfigCheckResult, BudgetRatio, ImportBatch, ImportDiff, Company, AggregationMap, AccountSubject, Metric, Role, Permission, ReclassifyLog, ConsolidationAdjustment, AnalysisItem, AnalysisInput, ReportListItem, ReportDetail, ReportSectionInput, ReportVersionItem, ReportVersionSnapshot, ReportExportData } from '@/types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

/**
 * 单飞刷新：并发 401 请求共享同一个 refresh 流程（单标签页内）。
 * 后端 refresh token 为轮转制——同一 token 只可成功使用一次（重复使用返回 401），
 * 若多个 401 各自独立 refresh，竞态中除首个外全部失败并触发登出跳转。
 * 该 Promise 在成功后置空，保证下次 401 可重新发起刷新。
 */
let refreshPromise: Promise<string> | null = null

const REFRESH_TIMEOUT_MS = 10000
const REFRESH_RETRY_DELAY_MS = 1000
/** 跨标签页竞态兜底等待窗口：其他标签页轮转成功后广播几乎必然在 400ms 内到达 */
const REFRESH_RACE_WAIT_MS = 400

/**
 * 跨标签页令牌协调：任一标签页刷新成功后广播新令牌，其他标签页 401 时直接复用，
 * 避免各标签页用同一旧 refresh token 并发刷新导致轮转竞态互踢。
 * store 为唯一权威：onmessage 直接写入 store，刷新失败兜底只依赖 store 变化，不另设缓存。
 */
const refreshChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('auth-refresh') : null

if (refreshChannel) {
  refreshChannel.onmessage = (e) => {
    const data = e.data as { accessToken?: string; refreshToken?: string } | null
    if (!data?.accessToken || !data?.refreshToken) return
    const { refreshToken, setTokens } = useAuthStore.getState()
    // 仅当本地令牌与广播不一致时更新（广播按发送顺序到达，后者恒新）
    if (refreshToken !== data.refreshToken) {
      setTokens(data.accessToken, data.refreshToken)
    }
  }
}

/** 提取刷新失败的业务消息（与拦截器一致：有响应取 message，无响应区分超时与网络层错误） */
function toRefreshError(e: unknown): Error {
  const axiosErr = e as { response?: { data?: { message?: string } }; code?: string }
  const message = axiosErr.response?.data?.message
  if (message) return new Error(message)
  if (axiosErr.code === 'ECONNABORTED') return new Error('刷新令牌请求超时，请重新登录')
  return new Error('网络连接异常，请检查网络后重试')
}

/**
 * 刷新请求：10s 超时；超时/网络层错误重试一次（请求可能未达服务端；
 * 有响应如 401/500 不重试，避免对已轮转的旧令牌做无意义重放）。
 */
async function postRefreshWithRetry(refreshToken: string): Promise<AxiosResponse> {
  const attempt = (): Promise<AxiosResponse> =>
    axios.post(`${API_BASE_URL}/auth/refresh`, { refreshToken }, { timeout: REFRESH_TIMEOUT_MS })
  try {
    return await attempt()
  } catch (e) {
    const axiosErr = e as { code?: string; response?: unknown }
    const retryable = axiosErr.code === 'ECONNABORTED' || (!axiosErr.response && !axiosErr.code)
    if (!retryable) throw e
    await new Promise((r) => setTimeout(r, REFRESH_RETRY_DELAY_MS))
    return attempt()
  }
}

/** 等待本地 refresh token 发生变化（其他标签页广播写入），超时返回 */
function waitForStoreTokenChange(previousRefreshToken: string, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms
    const check = () => {
      if (Date.now() >= deadline) return resolve()
      if (useAuthStore.getState().refreshToken !== previousRefreshToken) return resolve()
      setTimeout(check, 40)
    }
    check()
  })
}

async function refreshAccessTokenOnce(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const { refreshToken, setTokens } = useAuthStore.getState()
      if (!refreshToken) throw new Error('登录状态已失效，请重新登录')
      try {
        const response = await postRefreshWithRetry(refreshToken)
        const { accessToken, refreshToken: newRefreshToken } = response.data.data
        setTokens(accessToken, newRefreshToken)
        refreshChannel?.postMessage({ accessToken, refreshToken: newRefreshToken })
        return accessToken
      } catch (e) {
        // 跨标签页轮转竞态兜底：本标签页刷新失败时，其他标签页可能已成功轮转并广播
        await waitForStoreTokenChange(refreshToken, REFRESH_RACE_WAIT_MS)
        const latest = useAuthStore.getState()
        if (latest.refreshToken && latest.refreshToken !== refreshToken) {
          return latest.accessToken as string
        }
        throw toRefreshError(e)
      }
    })().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

/** 会话失效提示：并发 401 只提示一次，避免连环弹窗 */
let sessionExpiredNotified = false

/**
 * 会话失效降级处理：本地登出 → 跳转登录页（携带 expired 提示参数）。
 * 提示由登录页展示（/login?expired=1 → "登录已过期，请重新登录"提示条），请求层不再弹窗。
 * _reason 保留参数位：后续如需按失败原因差异化提示可在此扩展。
 */
export function handleSessionExpired(_reason: unknown): void {
  useAuthStore.getState().logout()
  if (sessionExpiredNotified) return
  sessionExpiredNotified = true
  window.location.href = '/login?expired=1'
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
  /** 预算模板口径告警：计算类/父级科目行将被重算或忽略、毛利直导叶子缺行将为 0 */
  budgetWarnings?: {
    recalcSubjects: string[]
    parentSubjects: string[]
    missingProfitLeaves: string[]
    /** 毛利叶子类型与公式不一致（data 类残留公式，多为历史种子回写）：须先恢复计算类 */
    typeFormulaMismatch: string[]
  } | null
}

/** 多表合并预览：单个类型的解析统计（行数/错误/摘要/激活影响） */
export interface MergedPreviewType {
  dataRowCount: number
  errorCount: number
  detailCount: number
  errors: { row: number; column: string; message: string }[]
  sampleRows: { headers: string[]; rows: (string | number)[][] }
  summary: {
    companyCount: number
    subjectCount: number
    periodRange: { min: string | null; max: string | null }
    totalValue: number
    zeroValueCount: number
    duplicateCount: number
    duplicateSamples: string[]
  }
  activationImpact: {
    activeBatch: { id: string; filename: string } | null
    newPeriods: string[]
    overlappingPeriods: string[]
    retainedPeriods: string[]
  }
  kpiCoverage: { covered: string[]; missing: string[] } | null
}

/** 多表合并预览结果：按类型分桶 + 未识别 Sheet 清单 */
export interface MergedPreviewResult {
  perType: Partial<Record<'operating' | 'static' | 'cashflow', MergedPreviewType>>
  ignoredSheets: string[]
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
      timeout: 60000,
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

        // 认证接口自身的 401 直接透传：/auth/login 密码错误、/auth/refresh 令牌失效、
        // /auth/logout 主动登出时不应触发刷新流程（未登录态 refreshToken 为空会走 logout+跳转，吞掉登录错误提示）
        const isAuthEndpoint =
          originalRequest.url?.includes('/auth/login') ||
          originalRequest.url?.includes('/auth/refresh') ||
          originalRequest.url?.includes('/auth/logout')

        if (error.response?.status === 401 && !originalRequest._retry && !isAuthEndpoint) {
          originalRequest._retry = true

          try {
            const accessToken = await refreshAccessTokenOnce()
            originalRequest.headers.Authorization = `Bearer ${accessToken}`
            return this.client(originalRequest)
          } catch (refreshError) {
            // 降级处理：本地登出后跳转登录页（仅一次），过期原因由登录页 ?expired=1 提示条展示
            handleSessionExpired(refreshError)
            // refreshAccessTokenOnce 已统一抛中文 Error；兜底非 Error 值
            return Promise.reject(refreshError instanceof Error ? refreshError : new Error('登录状态已失效，请重新登录'))
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
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } }; code?: string }
      // 优先提取后端统一响应中的业务错误信息（HTTP 非 2xx 且响应为 JSON 时）
      const message = axiosErr.response?.data?.message
      if (message) {
        throw new Error(message)
      }
      // 有响应但无 message（如 nginx 413 HTML 错误页）：按状态码给出友好提示
      const status = axiosErr.response?.status
      if (status) {
        if (status === 413) throw new Error('文件过大，超过 50MB 上限')
        throw new Error(`请求失败（HTTP ${status}）`)
      }
      // 无响应：区分超时与网络层错误，避免暴露 axios 裸文案 "Network Error"
      if (axiosErr.code === 'ECONNABORTED') throw new Error('请求超时，请重试')
      throw new Error('网络连接异常，请检查网络后重试')
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

  /** 修改密码：成功返回新令牌对，前端据此静默续期（不再强制登出） */
  async updatePassword(data: { oldPassword: string; newPassword: string }): Promise<{ accessToken: string; refreshToken: string }> {
    return this.request<{ accessToken: string; refreshToken: string }>({
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
    companyCode: string | null
    companyName: string | null
    companyType: 'single' | 'summary' | null
    degraded: boolean
  }> {
    return this.request({
      method: 'GET',
      url: '/dashboard/overview',
      params,
    })
  }

  /** 应收账款按主体分布（跟随看板主体筛选：单体=自身一行，汇总主体=成员公司各行） */
  async getDashboardReceivables(params: { period: string; mode: 'single' | 'summary'; companyCode?: string }): Promise<{
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
    companyCode: string | null
    companyName: string | null
    companyType: 'single' | 'summary' | null
    degraded: boolean
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

  /** 运营费用分析表（单期间）：按映射配置聚合的运营费用科目预算达成与同比（含月度/累计两组口径） */
  async getExpenseAnalysis(params?: { period?: string; companyCode?: string }): Promise<ExpenseAnalysisResponse> {
    return this.request({
      method: 'GET',
      url: '/dashboard/expense-analysis',
      params,
    })
  }

  /** 壹品慧关键指标表（单期间）：损益板块（收入/毛利+产品明细、运营费用、财务费用、净利润）+ 现金流板块（自由现金流/经营/投资/筹资）13 列口径 */
  async getKeyMetrics(params?: { period?: string; companyCode?: string }): Promise<KeyMetricsResponse> {
    return this.request({
      method: 'GET',
      url: '/dashboard/analysis/key-metrics',
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

  // ---- 关键指标产品配置（壹品慧关键指标表「按产品分」明细，数据维护）----
  async getKeyMetricsProducts(): Promise<KeyMetricsProduct[]> {
    return this.request({
      method: 'GET',
      url: '/data/key-metrics-products',
    })
  }

  /** 科目树变化检测：产品覆盖状态 / 未覆盖科目 / 失效关键词 / 毛利镜像缺失 */
  async checkKeyMetricsProducts(): Promise<KeyMetricsProductCheckResult> {
    return this.request({
      method: 'GET',
      url: '/data/key-metrics-products/check',
    })
  }

  async createKeyMetricsProduct(input: { code: string; name: string; subjectKeyword: string; sortOrder?: number; status?: string }): Promise<KeyMetricsProduct> {
    return this.request({
      method: 'POST',
      url: '/data/key-metrics-products',
      data: input,
    })
  }

  async updateKeyMetricsProduct(id: string, input: { name?: string; subjectKeyword?: string; sortOrder?: number; status?: string }): Promise<KeyMetricsProduct> {
    return this.request({
      method: 'PUT',
      url: `/data/key-metrics-products/${id}`,
      data: input,
    })
  }

  async deleteKeyMetricsProduct(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/data/key-metrics-products/${id}`,
    })
  }

  // ---- 运营费用映射（运营费用分析，数据维护）----
  async getExpenseMappings(): Promise<ExpenseMapping[]> {
    return this.request({
      method: 'GET',
      url: '/data/expense-mappings',
    })
  }

  /** 科目树变化检测：映射匹配状态 / 候选科目分组 / 未配置科目 / 失效编码 */
  async checkExpenseMappings(): Promise<ExpenseMappingCheckResult> {
    return this.request({
      method: 'GET',
      url: '/data/expense-mappings/check',
    })
  }

  /** 下一个统一映射编码（新增映射对话框预取展示，EXP_ 数字序号） */
  async getNextExpenseMappingCode(): Promise<{ code: string }> {
    return this.request({
      method: 'GET',
      url: '/data/expense-mappings/next-code',
    })
  }

  async createExpenseMapping(input: { code?: string; name: string; subjectCodes: string[]; sortOrder?: number; status?: string }): Promise<ExpenseMapping> {
    return this.request({
      method: 'POST',
      url: '/data/expense-mappings',
      data: input,
    })
  }

  async updateExpenseMapping(id: string, input: { name?: string; subjectCodes?: string[]; sortOrder?: number; status?: string }): Promise<ExpenseMapping> {
    return this.request({
      method: 'PUT',
      url: `/data/expense-mappings/${id}`,
      data: input,
    })
  }

  async deleteExpenseMapping(id: string): Promise<void> {
    return this.request({
      method: 'DELETE',
      url: `/data/expense-mappings/${id}`,
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

  // ---- 预算月度占比（看板月度预算按占比拆分，数据维护）----
  async getBudgetRatio(fiscalYear: string): Promise<BudgetRatio> {
    return this.request({
      method: 'GET',
      url: '/data/budget-ratios',
      params: { fiscalYear },
    })
  }

  async updateBudgetRatio(fiscalYear: string, ratios: number[]): Promise<{ fiscalYear: string; ratios: number[] }> {
    return this.request({
      method: 'PUT',
      url: `/data/budget-ratios/${fiscalYear}`,
      data: { ratios },
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

  async getCashflowIndicators(params: FilterParams): Promise<PaginatedResponse<any>> {
    return this.request({
      method: 'GET',
      url: '/indicators/cashflow',
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
  async uploadImport(file: File, templateType: string, valueUnit: string, fiscalYear?: string): Promise<ImportBatch> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('templateType', templateType)
    formData.append('valueUnit', valueUnit)
    // 目标财年（仅 budget 需要：预算按财年归属入库与激活隔离；缺省时后端回退当前财年）
    if (fiscalYear) formData.append('fiscalYear', fiscalYear)
    
    return this.request({
      method: 'POST',
      url: '/data/imports',
      data: formData,
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      // 大文件上传 + 后端解析耗时长，放宽至 120s
      timeout: 120000,
    })
  }

  /** 下载导入模板（后端按科目体系数据类指标生成） */
  async downloadImportTemplate(type: 'operating' | 'static' | 'cashflow' | 'budget'): Promise<Blob> {
    const response = await this.client.get('/data/imports/template', {
      params: { type },
      responseType: 'blob',
    })
    return response.data as Blob
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

  /** 批次差异对比（US-03）：按 (公司, 科目, 期间) 键对比两批次事实值（operating/static/budget） */
  async compareImports(aId: string, bId: string): Promise<ImportDiff> {
    return this.request({
      method: 'GET',
      url: `/data/imports/${aId}/compare/${bId}`,
    })
  }

  /** 回滚批次（US-03）：恢复快照数据并重新激活历史批次 */
  async rollbackImport(id: string): Promise<void> {
    return this.request({
      method: 'POST',
      url: `/data/imports/${id}/rollback`,
    })
  }

  /** 批量激活预检（只读）：返回各批次激活后将替换的已生效组合，供批量激活前确认覆盖风险 */
  async batchActivateCheck(ids: string[]): Promise<BatchActivateCheckResult> {
    return this.request({
      method: 'POST',
      url: '/data/imports/batch-activate-check',
      data: { ids },
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

  /** 指标类型转换（高危，仅 superadmin）：data ↔ calc、data/calc → display（display 只读不可转出），data→calc 可携带初始公式 */
  async convertMetric(id: string, data: { dataType: 'data' | 'calc' | 'display'; formula?: string }): Promise<Metric> {
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

  async getConsolidationAdjustments(params?: FilterParams): Promise<PaginatedResponse<ConsolidationAdjustment>> {
    return this.request({ method: 'GET', url: '/data/consolidation/adjustments', params })
  }

  /** 解析两个单体公司共同所属的汇总主体（company_aggregation_map 交集 + 权限过滤） */
  async commonConsolidationSummaries(data: { singleCompanyCodeA: string; singleCompanyCodeB: string }): Promise<{
    summaries: { code: string; name: string; isInternalElimination: boolean }[]
  }> {
    return this.request({ method: 'POST', url: '/data/consolidation/common-summaries', data })
  }

  async createConsolidationAdjustment(data: {
    templateType: 'operating' | 'static'
    summaryCompanyCode: string
    accountCode: string
    period: string
    amount: number
    reason: string
  }): Promise<{ id: string }> {
    return this.request({ method: 'POST', url: '/data/consolidation/adjustments', data })
  }

  async deleteConsolidationAdjustment(id: string): Promise<{ deleted: boolean }> {
    return this.request({ method: 'DELETE', url: `/data/consolidation/adjustments/${id}` })
  }

  async reclassifySubject(id: string, parentCode: string | null): Promise<AccountSubject> {
    return this.request({ method: 'POST', url: `/data/subjects/${id}/reclassify`, data: { parentCode } })
  }

  async previewImport(file: File, templateType: string, valueUnit: string, fiscalYear?: string): Promise<ImportPreviewResult> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('templateType', templateType)
    formData.append('valueUnit', valueUnit)
    if (fiscalYear) formData.append('fiscalYear', fiscalYear)
    return this.request({
      method: 'POST',
      url: '/data/imports/preview',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
      // 大文件解析耗时长，放宽至 120s
      timeout: 120000,
    })
  }

  /** 多表合并导入预览（一个 xlsx 含 经营/静态/现金流 多 Sheet，按名识别逐类型解析） */
  async previewMergedImport(file: File, valueUnit: string, fiscalYear?: string): Promise<MergedPreviewResult> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('valueUnit', valueUnit)
    if (fiscalYear) formData.append('fiscalYear', fiscalYear)
    return this.request({
      method: 'POST',
      url: '/data/imports/preview-merged',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  }

  /** 多表合并导入（按 Sheet 类型各建 draft 批次，激活沿用 /imports/:id/activate） */
  async uploadMergedImport(file: File, valueUnit: string, fiscalYear?: string): Promise<{ items: ImportBatch[] }> {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('valueUnit', valueUnit)
    if (fiscalYear) formData.append('fiscalYear', fiscalYear)
    return this.request({
      method: 'POST',
      url: '/data/imports/merged',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    })
  }

  async getSubjects(params?: FilterParams): Promise<PaginatedResponse<AccountSubject>> {
    return this.request({
      method: 'GET',
      url: '/data/subjects',
      params,
    })
  }

  async getSubjectTree(type: 'operating' | 'static' | 'cashflow'): Promise<{
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

  async updatePermissionsBatch(roleIds: string[], permissions: Permission[]): Promise<void> {
    return this.request({
      method: 'PUT',
      url: '/admin/roles/batch-permissions',
      data: { roleIds, permissions },
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
  async listAnalyses(params: { companyCode?: string; subjectCode?: string; period?: string; subjectType?: 'overview' | 'normal'; keyword?: string; includeInactive?: boolean; page?: number; pageSize?: number }): Promise<{ items: AnalysisItem[]; total: number; page: number; pageSize: number }> {
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
  // 总览：公司多选（逗号分隔，空=全部）+ 单期间过滤（期末余额为时点数）+ 对象类型多选（默认 external+related）；inactive 科目由后端强制剔除
  async getTransactionOverview(params: { companyCodes?: string[]; period?: string; partyType?: string[] } = {}) {
    return this.request({
      method: 'GET',
      url: '/transactions/overview',
      params: {
        companyCodes: params.companyCodes?.length ? params.companyCodes.join(',') : undefined,
        period: params.period,
        partyType: params.partyType?.length ? params.partyType.join(',') : undefined,
      },
    })
  }

  // 账龄分析：支持单期间、科目多选（逗号分隔）与往来对象关键词搜索
  async getTransactionAging(params: { companyCode?: string; transactionType?: string; groupBy?: string; period?: string; accountCodes?: string; partyType?: string; counterpartyKeyword?: string }) {
    return this.request({ method: 'GET', url: '/transactions/aging', params })
  }

  // 账龄分析 Excel 导出（Blob 下载；onProgress 回调下载进度 0-100，与 indicators/data 导出同款权限与审计）
  async exportTransactionAging(params: Record<string, unknown>, onProgress?: (p: number) => void): Promise<Blob> {
    const response = await this.client.get('/transactions/aging/export', {
      params,
      responseType: 'blob',
      onDownloadProgress: (e) => {
        if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
      },
    })
    return response.data
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

  // 往来余额变动趋势（单类型，按 公司×月份 聚合；支持财年轴与自定义期间范围）
  async getTransactionTrend(params: { transactionType: string; companyCodes?: string[]; months?: number; fiscalYear?: string; periodFrom?: string; periodTo?: string }) {
    return this.request({
      method: 'GET',
      url: '/transactions/trend',
      params: {
        transactionType: params.transactionType,
        companyCodes: params.companyCodes?.length ? params.companyCodes.join(',') : undefined,
        months: params.months,
        fiscalYear: params.fiscalYear,
        periodFrom: params.periodFrom,
        periodTo: params.periodTo,
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

  // 往来导入（六大往来账龄汇总表，多文件）；valueUnit：文件金额单位（yuan/wan），后端归一为元存储
  async previewTransactionImport(files: File[], valueUnit: string) {
    const formData = new FormData()
    for (const f of files) formData.append('files', f)
    formData.append('valueUnit', valueUnit)
    return this.request({
      method: 'POST',
      url: '/transactions/import/preview',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
      // 多文件批量上传 + 解析耗时长，放宽至 120s
      timeout: 120000,
    })
  }

  async importTransactions(files: File[], valueUnit: string) {
    const formData = new FormData()
    for (const f of files) formData.append('files', f)
    formData.append('valueUnit', valueUnit)
    return this.request({
      method: 'POST',
      url: '/transactions/import',
      data: formData,
      headers: { 'Content-Type': 'multipart/form-data' },
      // 多文件批量上传 + 解析耗时长，放宽至 120s
      timeout: 120000,
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
  // 业务员管理（独立管理页面）
  async getSalesmenManage(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/salesmen/manage', params })
  }

  async updateSalesman(id: string, data: Record<string, unknown>) {
    return this.request({ method: 'PATCH', url: `/transactions/salesmen/${id}`, data })
  }

  async setSalesmanStatus(id: string, status: string) {
    return this.request({ method: 'PATCH', url: `/transactions/salesmen/${id}/status`, data: { status } })
  }

  // 业务员与客商选项
  async getSalesmen(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/salesmen', params })
  }

  async createSalesman(data: Record<string, unknown>) {
    return this.request({ method: 'POST', url: '/transactions/salesmen', data })
  }

  async getCounterparties(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/collections/counterparties', params })
  }

  // 应收款客商台账（催收计划页默认视图）
  async getCustomerLedger(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/collections/customers', params })
  }

  async updateCustomerExt(companyCode: string, counterpartyCode: string, data: Record<string, unknown>) {
    return this.request({ method: 'PATCH', url: `/transactions/collections/customers/${companyCode}/${counterpartyCode}`, data })
  }

  async getCollections(params: Record<string, unknown>) {
    return this.request({ method: 'GET', url: '/transactions/collections', params })
  }

  async createCollection(data: Record<string, unknown>) {
    return this.request({ method: 'POST', url: '/transactions/collections', data })
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
