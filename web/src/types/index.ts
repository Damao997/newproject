export interface User {
  id: string
  username: string
  name: string
  role: UserRole
  dataScope: string
  status: 'active' | 'inactive'
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

export type UserRole = 'admin' | 'finance_manager' | 'department_manager' | 'viewer' | 'finance_analyst_it'

export interface Role {
  id: string
  code: UserRole
  name: string
  description: string
  isSystem: boolean
  permissions: Permission[]
}

export interface Permission {
  id: string
  resource: string
  action: 'view' | 'create' | 'update' | 'delete' | 'export' | 'import'
}

export interface Company {
  id: string
  code: string
  name: string
  type: 'entity' | 'summary'
  entityType?: 'single' | 'summary'
  businessUnit?: string | null
  parentCode?: string | null
  legalEntity?: string | null
  managementEntity?: string | null
  orderNo?: number
  status: 'active' | 'inactive'
}

export interface AggregationMap {
  id: string
  summaryCompanyCode: string
  summaryCompanyName: string
  singleCompanyCode: string
  singleCompanyName: string
  isInternalElimination: boolean
}

export interface AccountSubject {
  id: string
  code: string
  name: string
  type: 'operating' | 'static'
  level: number
  parentId?: string
  status: 'active' | 'inactive'
}

export interface Metric {
  id: string
  code: string
  name: string
  dataType: 'data' | 'calc' | 'display'
  formula?: string
  sourceAccountCodes?: string[]
  dependsOn?: string[]
  status: 'active' | 'inactive'
}

export interface PeriodDimension {
  id: string
  code: string
  name: string
  type: 'operating' | 'static'
  periods: string[]
}

export interface FactOperating {
  id: string
  companyCode: string
  accountCode: string
  period: string
  periodDimCode: string
  batchId: string
  value: number
  createdAt: string
}

export interface FactStatic {
  id: string
  companyCode: string
  accountCode: string
  snapshotDate: string
  periodDimCode: string
  batchId: string
  value: number
  createdAt: string
}

export interface FactBudget {
  id: string
  companyCode: string
  accountCode: string
  fiscalYear: string
  period: string
  batchId: string
  value: number
  createdAt: string
}

export interface ImportBatch {
  id: string
  filename: string
  templateType: 'operating' | 'static' | 'budget'
  status: 'draft' | 'active' | 'archived' | 'purged'
  rowCount?: number
  successCount: number
  errorCount: number
  errors?: ImportError[]
  createdBy: string
  createdAt: string
  activatedAt?: string
}

export interface ImportError {
  row: number
  column: string
  message: string
}

export interface KpiData {
  title: string
  value: number
  unit: string
  change: number
  trend: number[]
  icon: string
}

export interface TrendData {
  period: string
  revenue: number
  cost: number
  profit: number
  budget?: number
}

export interface BusinessUnitData {
  name: string
  revenue: number
  percentage: number
}

export interface Alert {
  id: string
  type: 'budget_exceeded' | 'overdue_payment' | 'inventory堆积' | 'anomaly'
  title: string
  message: string
  severity: 'info' | 'warning' | 'error'
  createdAt: string
  acknowledgedAt?: string
}

export interface AuditLog {
  id: string
  createdAt: string
  username: string
  module: string
  action: string
  detail: string
}

/** 科目树节点（经营分析 level0-level4 / 静态指标 level0-level1 通用） */
export interface SubjectNode {
  /** 前端生成的科目编码，如 OP_001 / ST_001 */
  code: string
  /** 科目名称 */
  name: string
  /** 层级 0-4，等于树深度 */
  level: number
  /** 所属 level0 类别名（回款/收入/成本/毛利/费用/经营指标/财务指标/现金流指标；静态为 level0 科目名） */
  category: string
  /** 数据类型：数据类/计算类/展示类 */
  dataType: 'data' | 'calc' | 'display'
  children: SubjectNode[]
}

/** @deprecated 兼容别名，等价于 SubjectNode */
export type OperatingSubjectNode = SubjectNode

export interface ApiResponse<T> {
  code: number
  data: T
  message: string
}

export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface LoginRequest {
  username: string
  password: string
}

export interface LoginResponse {
  accessToken: string
  refreshToken: string
  user: User
}

export interface FilterParams {
  companyCode?: string
  period?: string
  accountCode?: string
  startDate?: string
  endDate?: string
  page?: number
  pageSize?: number
}
