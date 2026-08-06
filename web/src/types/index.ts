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
  /** 首次登录强制改密：true 时业务接口被拦截，须先修改密码 */
  mustChangePassword?: boolean
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
  /** 值类型：金额（万元）/ 数量（整数）/ 比率（公式计算，不可直接调整） */
  valueType?: 'amount' | 'quantity' | 'ratio'
  /** 指标类型：data=数据 / calc=计算（公式驱动）/ display=展示（只读）；calc/display 不可直接调整 */
  dataType?: 'data' | 'calc' | 'display'
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
  templateType: 'operating' | 'static' | 'budget' | 'transaction' | 'inventory'
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

/** 批次差异对比行（值均为万元/原始单位数值，展示层格式化） */
export interface ImportDiffRow {
  companyCode: string
  accountCode: string
  subjectName: string
  /** operating: 期间（2026-04）；static: 快照月（2026-03）；budget: FY2026/期间 */
  period: string
  oldValue: number
  newValue: number
  delta: number
  /** 变化百分比（旧值为 0 时为 null） */
  deltaPercent: number | null
}

/** 批次差异对比结果（GET /data/imports/:aId/compare/:bId） */
export interface ImportDiff {
  a: { id: string; filename: string; templateType: string; status: string; createdAt: string }
  b: { id: string; filename: string; templateType: string; status: string; createdAt: string }
  changed: ImportDiffRow[]
  added: ImportDiffRow[]
  removed: ImportDiffRow[]
  summary: {
    changedCount: number
    addedCount: number
    removedCount: number
    totalDelta: number
    truncated: boolean
  }
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
  /** subject_adjust：调整方式与调减/调增及原因 */
  adjustMode?: 'both' | 'decrease' | 'increase'
  /** subject_adjust：调整口径值类型（金额/数量），历史记录缺省按金额展示 */
  valueType?: string
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
  /** 是否可撤销（含行级快照且未撤销且未因批次替换失效） */
  revertible: boolean
  /** 批次替换/归档/清除导致引用失效的时间（null = 未失效） */
  invalidatedAt: string | null
  /** 失效原因：rows_replaced（行被物理删除）| batch_inactive（批次不再生效） */
  invalidatedReason: string | null
  /** 失效详情（触发批次、替换期间） */
  invalidation: { reason: string; replacedByBatchId: string; replacedPeriods: string[] | null } | null
  detail?: ReclassifyLogDetail | null
  createdAt: string
}

/** 汇总抵消调整记录：在汇总主体（如 ET0001）聚合口径上按科目/期间叠加抵消金额，单体报表不受影响 */
export interface ConsolidationAdjustment {
  id: string
  templateType: 'operating'
  summaryCompanyCode: string
  summaryCompanyName: string
  accountCode: string
  accountName: string
  /** 调整期间（单月 YYYY-MM） */
  period: string
  /** 抵消金额（万元）：正=调增、负=调减 */
  amount: number
  reason: string
  operator: string
  createdAt: string
}

/** 核心 KPI 卡（收入/毛利/净利润/回款）：金额万元，达成率 0-100，null=无预算（显示 "–"） */
export interface KpiData {
  title: string
  icon: string
  /** 本月合计金额（万元） */
  monthActual: number
  /** 月度预算达成率（%，本月实际/月均预算） */
  monthRate: number | null
  /** 累计实际金额（YTD，万元） */
  ytdActual: number
  /** 同比变化率（小数，0.1=+10%） */
  yoy: number
  /** 累计预算达成率（%，YTD 实际/年预算） */
  ytdRate: number | null
  /** 财年内各月本月合计序列（迷你趋势图） */
  trend: number[]
}

/** 财年趋势行：三个可选指标的 本月合计/上年同期/月度预算/累计序列 + 回款；null=该月无数据 */
export interface TrendData {
  period: string
  revenueActual: number | null
  revenueSame: number | null
  revenueBudget: number | null
  revenueYtdActual: number | null
  revenueYtdSame: number | null
  revenueYtdBudget: number | null
  profitActual: number | null
  profitSame: number | null
  profitBudget: number | null
  profitYtdActual: number | null
  profitYtdSame: number | null
  profitYtdBudget: number | null
  netProfitActual: number | null
  netProfitSame: number | null
  netProfitBudget: number | null
  netProfitYtdActual: number | null
  netProfitYtdSame: number | null
  netProfitYtdBudget: number | null
  collectionActual: number | null
}

/** 品类预算达成的单指标组（收入/毛利各一组）：预算为年度总额（万元），月均口径由前端按 预算/12 折算 */
export interface ProductBudgetMetric {
  budget: number
  /** 当月预算金额（按月度占比拆分后的当月值；无预算为 null） */
  monthBudget: number | null
  monthActual: number
  /** 上年同月实际（供合计行同比按 Σ金额重算） */
  monthSame: number
  monthRate: number | null
  monthYoy: number
  ytdActual: number
  /** 上年同期累计（供合计行同比按 Σ金额重算） */
  ytdSame: number
  ytdRate: number | null
  ytdYoy: number
}

/** 品类预算达成行：品类名 + 收入/毛利镜像科目各一组口径值 */
export interface ProductBudgetRow {
  category: string
  income: ProductBudgetMetric
  profit: ProductBudgetMetric
}

/** 品类预算达成接口响应（companyCode/companyName/companyType/degraded 为看板实际生效主体，越权时自动降级） */
export interface ProductBudgetResponse {
  period: string
  rows: ProductBudgetRow[]
  companyCode: string | null
  companyName: string | null
  companyType: 'single' | 'summary' | null
  degraded: boolean
}

/** 主体预算达成行：主体（单体公司/汇总主体）+ 收入/毛利/净利润各一组口径值 */
export interface SubjectBudgetRow {
  code: string
  name: string
  income: ProductBudgetMetric
  profit: ProductBudgetMetric
  netProfit: ProductBudgetMetric
}

/** 主体预算达成接口响应 */
export interface SubjectBudgetResponse {
  period: string
  mode: 'single' | 'summary'
  rows: SubjectBudgetRow[]
}

/** 品类配置（品类预算达成分析：品类 ↔ 收入科目名关键词） */
export interface ProductCategory {
  id: string
  code: string
  name: string
  subjectKeyword: string
  sortOrder: number
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

/** 品类配置检测行：匹配到的收入科目与毛利镜像是否齐全 */
export type ProductCategoryCheckItem = ProductCategory & {
  matchedSubjects: string[]
  profitOk: boolean
}

/** 科目树变化检测结果 */
export interface ProductCategoryCheckResult {
  categories: ProductCategoryCheckItem[]
  uncoveredSubjects: string[]
  brokenKeywords: string[]
  missingProfitMirror: string[]
}

/** 运营费用映射（运营费用分析：展示指标 ↔ 经营科目编码集合） */
export interface ExpenseMapping {
  id: string
  code: string
  name: string
  subjectCodes: string[]
  sortOrder: number
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

/** 候选科目分组（运营费用映射 check 返回，供配置面板按组多选：付现/非付现/财务费用；hasData=false 表示无经营数据与预算，配置后看板不展示） */
export interface ExpenseCandidateGroup {
  group: string
  items: { code: string; name: string; hasData: boolean }[]
}

/** 运营费用映射检测结果：已配置列表 + 候选科目分组 + 未配置科目 + 失效编码（mappings.hasData=false 表示引用科目均无数据，看板不展示） */
export interface ExpenseMappingCheckResult {
  mappings: (ExpenseMapping & { matchedSubjects: string[]; hasData: boolean })[]
  candidates: ExpenseCandidateGroup[]
  uncoveredSubjects: string[]
  brokenCodes: string[]
}

/** 运营费用分析行：展示指标（映射配置）+ 单组口径值（字段平铺） */
export type ExpenseAnalysisRow = { code: string; name: string } & ProductBudgetMetric

/** 运营费用分析接口响应（companyCode/companyName/companyType/degraded 为看板实际生效主体，越权时自动降级） */
export interface ExpenseAnalysisResponse {
  period: string
  rows: ExpenseAnalysisRow[]
  companyCode: string | null
  companyName: string | null
  companyType: 'single' | 'summary' | null
  degraded: boolean
}

/** 预算月度占比配置（看板月度预算按占比拆分；ratios 按财年 4月起 12 个月顺序，和为 100） */
export interface BudgetRatio {
  fiscalYear: string
  ratios: number[]
  /** 该财年生效预算的年度总额（万元，全部公司全部科目合计） */
  annualTotal: number
  /** 按占比拆分后的各月预算金额（万元，末月余差保证 Σ=年度总额；无预算时全 null） */
  monthlyAmounts: (number | null)[]
}

/** 主体展示配置（主体预算达成分析：配置展示的主体/排序/启停） */
export interface SubjectBudgetConfig {
  id: string
  companyCode: string
  companyName: string
  entityType: 'single' | 'summary'
  sortOrder: number
  status: 'active' | 'inactive'
  createdAt: string
  updatedAt: string
}

/** 主体配置检测结果：已配置列表 + 公司表新增但未配置的主体 */
export interface SubjectBudgetConfigCheckResult {
  configs: SubjectBudgetConfig[]
  unconfiguredSubjects: { code: string; name: string; entityType: 'single' | 'summary' }[]
}

/** 应收账款主体分布行（横向柱状图） */
export interface ReceivableRow {
  code: string
  name: string
  balance: number
}

/** 首页看板预警（后端由 alert 表派生的展示结构） */
export interface DashboardAlert {
  id: string
  severity: 'info' | 'warning' | 'error'
  title: string
  message: string
  createdAt: string
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
  /** 科目编码（级联数字编码，前缀+每级 2 位：如 OP_02 / OP_0201 / ST_1201） */
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
  /** 明细查询合计（跨全部筛选数据，忽略分页） */
  totals?: { closingBalance: number }
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
  /** 去除跨公司重分类影响（indicators 接口，按日志快照回溯原始口径） */
  excludeReclassify?: boolean
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
  partyType: string
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
  partyType?: string
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
  period?: string
  /** 科目多选（逗号分隔编码串） */
  accountCodes?: string
  /** 关联方过滤：internal=内部公司 / related=关联方 / external=外部，不传=全部 */
  partyType?: 'internal' | 'related' | 'external'
}

// ===== 往来科目筛选 =====

/** 科目过滤管理项（含纳入/排除状态） */
export interface ManageAccountItem {
  code: string
  name: string
  transactionType: string
  direction: string
  status: string
  hasData: boolean
}

/** 科目筛选选项：hasData=false 表示该科目在科目体系中已定义但当前无交易数据 */
export interface TransactionAccountOption {
  accountCode: string
  accountDesc: string | null
  hasData: boolean
}

// ===== 往来变动趋势 =====
export interface TransactionTrendSeries {
  companyCode: string
  companyName: string | null
  points: (number | null)[]
}

export interface TransactionTrendResult {
  periods: string[]
  series: TransactionTrendSeries[]
}

// ===== 往来导入（账龄汇总表） =====

export interface TransactionImportIssue {
  sheet: string
  row: number
  column: string
  message: string
}

export interface TransactionActivationImpact {
  newKeys: { companyCode: string; period: string; transactionType: string }[]
  overlappingKeys: { companyCode: string; period: string; transactionType: string; existingCount: number }[]
}

export interface TransactionImportPreview {
  filename: string
  sheets: { sheetName: string; transactionType: string; direction: string; cutoffDate: string | null; recordCount: number }[]
  dataRowCount: number
  recordCount: number
  errorCount: number
  warningCount: number
  errors: TransactionImportIssue[]
  warnings: TransactionImportIssue[]
  summary: {
    typeCounts: Record<string, number>
    companies: string[]
    periods: string[]
    totalClosingBalance: number
    duplicateCount: number
    duplicateSamples: string[]
    counterpartyCount: number
    internalCount: number
  }
  activationImpact: TransactionActivationImpact
}

// ===== 导入覆盖矩阵 =====

export type CoverageCellStatus = 'active' | 'empty' | 'draft' | 'missing'

export interface TransactionCoverageCell {
  companyCode: string
  period: string
  transactionType: string
  status: CoverageCellStatus
  recordCount: number
  draftBatchIds: string[]
}

export interface TransactionCoverageResult {
  periods: string[]
  companies: { code: string; name: string }[]
  types: string[]
  cells: TransactionCoverageCell[]
  summary: { expected: number; active: number; empty: number; draft: number; missing: number; coverageRate: number }
  draftBatches: { id: string; filename: string; createdAt: string; detailCount: number }[]
}

export interface BatchCoverageRow {
  companyCode: string
  companyName: string | null
  period: string | null
  transactionType: string
  recordCount: number
}

export interface TransactionImportUploadResult {
  filename: string
  batch: ImportBatch | null
  error: string | null
}

// ===== 批量激活预检（激活冲突检测） =====

/** 激活冲突项：transaction 为 (公司, 期间, 往来类型) 三元组；operating/static 为期间；budget/inventory 为整体替换文案 */
export interface ActivateConflict {
  companyCode?: string
  period?: string
  transactionType?: string
  /** 已生效数据中的现有笔数（transaction 类型） */
  existingCount?: number
  /** 整体替换场景的展示文案（budget 财年 / inventory 存货数据） */
  label?: string
}

/** 批量激活预检结果：单批次激活后将替换的已生效组合 */
export interface BatchActivateCheckItem {
  id: string
  filename: string
  /** draft=可激活；active/archived/purged=不可激活；不存在时为空字符串 */
  status: string
  conflictCount: number
  conflicts: ActivateConflict[]
  /** 选中批次之间互相重叠的三元组数（激活顺序靠后的覆盖靠前的） */
  crossBatchConflictCount: number
}

export interface BatchActivateCheckResult {
  results: BatchActivateCheckItem[]
}

// ===== 催收管理 =====

export type CollectionStatus = 'pending' | 'collecting' | 'partial' | 'full' | 'bad_debt'

export interface CollectionPlanItem {
  id: string
  companyCode: string
  companyName: string | null
  counterpartyCode: string
  counterpartyName: string | null
  accountCode: string
  overdueAmount: number
  plannedDate: string
  collectorId: string | null
  method: string
  expectedAmount: number | null
  actualAmount: number | null
  status: CollectionStatus
  remark: string | null
  createdAt: string
}

export interface CollectionLogItem {
  id: string
  planId: string
  actionTime: string
  actionBy: string | null
  content: string
  attachmentUrl: string | null
}

// ============ 分析报告（Reports 模块） ============

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
  /** active=正常 / inactive=已删除（软删除） */
  status: string
  /** 被报告章节引用的来源（仅列表接口返回） */
  refs?: AnalysisRef[]
  createdBy: string | null
  updatedBy: string | null
  createdAt: string
  updatedAt: string
}

/** 引用某单项分析的报告来源 */
export interface AnalysisRef {
  reportId: string
  reportTitle: string
  reportStatus: string
}

export interface AnalysisInput {
  companyCode: string
  subjectCode: string
  subjectType?: 'operating' | 'static' | 'transaction'
  fiscalYear: string
  period: string
  title: string
  content: string
  metricContext?: Record<string, unknown> | null
}

export interface ReportCompanyScope {
  type: 'company' | 'summary'
  code: string
  name?: string | null
}

export interface ReportListItem {
  id: string
  title: string
  fiscalYear: string
  period: string
  companyScope: ReportCompanyScope
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

/** 版本快照详情（查看/回退用） */
export interface ReportVersionSnapshot {
  versionNo: number
  changeSummary: string | null
  changedBy: string | null
  changedAt: string
  snapshot: {
    title: string
    fiscalYear: string
    period: string
    companyScope: ReportCompanyScope
    sections: { title: string; content: string; analysisId: string | null; source: ReportSectionView['source']; missing: boolean }[]
  }
}

export interface ReportExportData {
  title: string
  fiscalYear: string
  period: string
  scopeName: string | null
  generatedAt: string
  sections: { title: string; content: string; plainText: string; missing: boolean }[]
}
