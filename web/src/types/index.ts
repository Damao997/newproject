export interface User {
  id: string
  username: string
  name: string
  role: UserRole
  /** 后端下发的角色权限码列表（`resource:action`），旧会话可能缺失 */
  permissions?: string[]
  dataScope: string
  /** 多选数据范围编码数组（可混合单体与汇总主体），管理列表接口下发 */
  dataScopeCodes?: string[]
  status: 'active' | 'inactive'
  lastLoginAt?: string
  createdAt: string
  updatedAt: string
}

export type UserRole = 'superadmin' | 'admin' | 'finance_manager' | 'department_manager' | 'viewer' | 'finance_analyst_it'

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
  shortName?: string | null
  type: 'entity' | 'summary'
  entityType?: 'single' | 'summary'
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
  /** 入库明细数（unpivot 后的事实记录数） */
  detailCount?: number
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

/** 重分类操作日志明细（detail JSON，按 type 部分字段可用） */
export interface ReclassifyLogDetail {
  /** company：转移方式与金额 */
  transferMode?: 'all' | 'ratio' | 'amount'
  ratio?: number | null
  amount?: number | null
  transferValue?: number
  mergedRows?: number
  createdRows?: number
  accountCodes?: string[] | null
  /** subject_adjust：调减/调增与原因 */
  decreaseAmount?: number
  increaseAmount?: number
  netChange?: number
  reason?: string
}

export interface ReclassifyLog {
  id: string
  type: 'company' | 'subject' | 'subject_adjust'
  templateType: string | null
  sourceCompany: string | null
  targetCompany: string | null
  sourceSubject: string | null
  targetSubject: string | null
  /** 调整期间（单月；历史记录回退 periodFrom） */
  period: string | null
  periodFrom: string | null
  periodTo: string | null
  affectedRows: number
  operator: string
  /** 撤销时间（null = 未撤销） */
  revertedAt: string | null
  revertedBy: string | null
  /** 是否可撤销（含行级快照且未撤销） */
  revertible: boolean
  detail?: ReclassifyLogDetail | null
  createdAt: string
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
  /** 值类型：金额/数量/比率，决定数值格式化与同比语义（缺省按金额） */
  valueType?: 'amount' | 'quantity' | 'ratio'
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
  /** 科目类型筛选（data/subjects 接口） */
  type?: string
  /** 是否包含已停用科目（data/subjects 接口，query 串传 'true'） */
  includeInactive?: string
}

// ===== 往来分析模块 =====

export interface TransactionOverviewItem {
  transactionType: string
  direction: string
  totalClosingBalance: number
  totalOpeningBalance: number
  totalDebit: number
  totalCredit: number
  recordCount: number
  internalCount: number
  externalCount: number
  aging: Record<string, number>
}

export interface TransactionDetailItem {
  id: string
  companyCode: string
  companyName: string | null
  transactionType: string
  direction: string
  cutoffDate: string | null
  counterpartyCode: string
  counterpartyName: string | null
  accountCode: string
  accountDesc: string | null
  documentNo: string | null
  bookingDate: string | null
  dueDate: string | null
  agingDays: number | null
  openingBalance: number
  debitAmount: number
  creditAmount: number
  closingBalance: number
  aging: Record<string, number>
  isInternal: boolean
  internalType: string | null
  internalPeerCode: string | null
  isEliminated: boolean
  isSettled: boolean
  sourceFile: string | null
}

export interface AgingAnalysisRow {
  companyCode: string
  companyName: string | null
  transactionType: string
  counterpartyCode?: string
  counterpartyName?: string | null
  accountCode?: string
  accountDesc?: string | null
  closingBalance: number
  aging: Record<string, number>
}

export interface InternalSummaryRow {
  companyCode: string
  internalPeerCode: string
  direction: string
  transactionType: string
  closingBalance: number
  recordCount: number
}

export interface InternalMirrorRow {
  companyA: string
  companyB: string
  arAmount: number
  apAmount: number
  difference: number
}

export interface TransactionFilterParams {
  page?: number
  pageSize?: number
  companyCode?: string
  transactionType?: string
  direction?: string
  counterpartyKeyword?: string
  isInternal?: boolean
  internalType?: string
  isSettled?: boolean
  minAmount?: number
  maxAmount?: number
}
