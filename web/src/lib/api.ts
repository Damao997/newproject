import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios'
import { useAuthStore } from '@/stores/authStore'
import type { ApiResponse, LoginRequest, LoginResponse, User, PaginatedResponse, FilterParams, KpiData, TrendData, BusinessUnitData, Alert, ImportBatch, Company, AccountSubject, Metric, Role, Permission } from '@/types'

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
    const response: AxiosResponse<ApiResponse<T>> = await this.client(config)
    if (response.data.code !== 0) {
      throw new Error(response.data.message || '请求失败')
    }
    return response.data.data
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
    businessUnitData: BusinessUnitData[]
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

  async getSubjects(params?: FilterParams): Promise<PaginatedResponse<AccountSubject>> {
    return this.request({
      method: 'GET',
      url: '/data/subjects',
      params,
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
}

export const api = new ApiClient()
