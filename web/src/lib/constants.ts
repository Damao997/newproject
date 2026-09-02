export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1'

export const TOKEN_KEY = 'access_token'
export const REFRESH_TOKEN_KEY = 'refresh_token'

export const ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  FINANCE_MANAGER: 'finance_manager',
  DEPARTMENT_MANAGER: 'department_manager',
  VIEWER: 'viewer',
  FINANCE_ANALYST_IT: 'finance_analyst_it',
} as const

export const ROLE_NAMES: Record<string, string> = {
  superadmin: '超级管理员',
  admin: '管理员',
  finance_manager: '财务主管',
  department_manager: '部门经理',
  viewer: '查看者',
  finance_analyst_it: '财务分析师(兼IT)',
}

export const TEMPLATE_TYPES = {
  OPERATING: 'operating',
  STATIC: 'static',
  CASHFLOW: 'cashflow',
  BUDGET: 'budget',
} as const

export const TEMPLATE_TYPE_NAMES: Record<string, string> = {
  operating: '经营数据',
  static: '静态数据',
  cashflow: '现金流量数据',
  budget: '年度预算',
}

export const BATCH_STATUS = {
  DRAFT: 'draft',
  ACTIVE: 'active',
  ARCHIVED: 'archived',
  PURGED: 'purged',
} as const

export const BATCH_STATUS_NAMES: Record<string, string> = {
  draft: '草稿',
  active: '生效',
  archived: '归档',
  purged: '清除',
}

/** 分析报告状态 → 中文标签（报告列表/编辑页共享，避免跨页文案漂移） */
export const REPORT_STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
}

/** 分析报告状态 → Badge 语义变体（跨页面统一：草稿灰/已发布橙/已归档描边） */
export const REPORT_STATUS_BADGE_VARIANT: Record<string, 'secondary' | 'default' | 'outline'> = {
  draft: 'secondary',
  published: 'default',
  archived: 'outline',
}

export const FINANCIAL_COLORS = {
  RED_UP: '#FF3B30',
  GREEN_DOWN: '#34C759',
  // 与 globals.css 的 --success / --warning / --destructive 保持一致
  BUDGET_ACHIEVED: '#10B981',
  BUDGET_WARNING: '#FFD700',
  BUDGET_DEVIATION: '#EF4444',
} as const

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  PAGE_SIZE_OPTIONS: [20, 50, 100, 200],
} as const

/** 权限码模块段→中文名（权限配置弹窗分组标题） */
export const PERMISSION_MODULE_LABELS: Record<string, string> = {
  dashboard: '首页',
  indicators: '财务指标',
  transactions: '往来分析',
  inventory: '存货管理',
  reports: '分析报告',
  data: '数据管理',
  tools: '其他工具',
  admin: '权限管理',
}

/** 权限码→中文名（与 server/prisma/seed.ts 权限主清单对齐，未收录码回退显示原文） */
export const PERMISSION_LABELS: Record<string, string> = {
  'dashboard:view': '查看看板',
  'dashboard:export': '导出看板',
  'indicators:view': '查看财务指标',
  'indicators:export': '导出财务指标',
  'transactions:view': '查看往来数据',
  'transactions:create': '新增往来数据',
  'transactions:update': '编辑往来数据',
  'transactions:delete': '删除往来数据',
  'transactions:import': '导入往来数据',
  'transactions:export': '导出往来数据',
  'inventory:view': '查看存货数据',
  'inventory:create': '新增存货数据',
  'inventory:update': '编辑存货数据',
  'inventory:delete': '删除存货数据',
  'inventory:import': '导入存货数据',
  'inventory:export': '导出存货数据',
  'reports:view': '查看分析报告',
  'reports:create': '新建分析报告',
  'reports:update': '编辑分析报告',
  'reports:delete': '删除分析报告',
  'reports:export': '导出分析报告',
  'data:browse:view': '浏览数据',
  'data:import:upload': '上传导入文件',
  'data:metric:create': '新建指标',
  'data:metric:update': '编辑指标',
  'data:metric:delete': '删除指标',
  'data:company:create': '新建公司',
  'data:company:update': '编辑公司',
  'data:company:delete': '删除公司',
  'data:subject:create': '新建科目',
  'data:subject:update': '编辑科目',
  'data:subject:delete': '删除科目',
  'data:reclassify:company': '公司重分类',
  'data:reclassify:subject': '科目重分类',
  'data:export': '导出数据',
  'data:metric:approve': '指标审批',
  'data:import:archive': '归档导入批次',
  'data:import:rollback': '回滚导入批次',
  'data:import:purge': '清除导入批次',
  'data:company:purge': '彻底删除公司',
  'data:subject:purge': '彻底删除科目',
  'data:metric:purge': '彻底删除指标',
  'data:metric:convert': '指标类型转换',
  'tools:view': '查看其他工具',
  'admin:users:view': '查看用户',
  'admin:users:create': '新增用户',
  'admin:users:update': '编辑用户',
  'admin:users:delete': '停用用户',
  'admin:users:reset-password': '重置用户密码',
  'admin:users:export': '导出用户',
  'admin:users:purge': '彻底删除用户',
  'admin:roles:view': '查看角色',
  'admin:roles:create': '新增角色',
  'admin:roles:update': '编辑角色',
  'admin:roles:delete': '删除角色',
  'admin:permissions:view': '查看权限配置',
  'admin:permissions:update': '编辑权限配置',
}

/** 审计日志模块→中文名（与后端 recordAudit 的 module 取值对齐） */
export const AUDIT_MODULE_LABELS: Record<string, string> = {
  auth: '认证',
  admin: '权限管理',
  permission: '越权拦截',
  data: '数据管理',
  ai: 'AI 模块',
  indicators: '财务指标',
  reports: '分析报告',
  transactions: '往来分析',
  tools: '其他工具',
}

/** 审计日志操作类型→中文名（未收录码回退显示原文） */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  login: '登录',
  login_failed: '登录失败',
  logout: '登出',
  auto_login: '自动登录（刷新续期）',
  create: '新增',
  update: '更新',
  delete: '删除',
  export: '导出',
  import: '导入',
  reclassify: '科目重分类',
  metric_change: '指标公式变更',
  consolidation: '合并重分类',
  user_create: '创建用户',
  user_disable: '停用用户',
  user_purge: '彻底删除用户',
  role_change: '角色变更',
  permission_change: '权限变更',
  denied: '越权拦截',
  rule_change: '公式规则变更',
  import_rollback: '批次回滚',
  analysis_create: '新增汇总分析',
  analysis_update: '更新汇总分析',
  analysis_delete: '删除汇总分析',
  analysis_restore: '恢复汇总分析',
  report_create: '新建报告',
  report_update: '更新报告',
  report_archive: '归档报告',
  report_export: '导出报告',
  report_generate_sections: '生成报告章节',
  report_set_sections: '保存报告章节',
  report_save_version: '保存报告版本',
  report_rollback_version: '回滚报告版本',
  enterprise_search: '工商信息查询',
  polish: 'AI 润色',
  analyze: 'AI 分析',
  overview: 'AI 概述',
  formula_gen: 'AI 公式生成',
  report_summary: 'AI 报告摘要',
  prompt_injection_blocked: '提示词注入拦截',
}

/** 审计资源码→中文（与后端 requirePermission 资源码对齐，denied/permission_change 翻译用） */
export const AUDIT_RESOURCE_LABELS: Record<string, string> = {
  dashboard: '首页看板',
  indicators: '财务指标',
  transactions: '往来分析',
  inventory: '存货管理',
  reports: '分析报告',
  tools: '其他工具',
  data: '数据管理',
  admin: '权限管理',
}

/** 审计权限操作码→中文（denied 记录中 resource:action 翻译用） */
export const AUDIT_PERM_ACTION_LABELS: Record<string, string> = {
  view: '查看',
  create: '新增',
  update: '更新',
  delete: '删除',
  export: '导出',
  import: '导入',
}

/** 审计 detail 实体码→中文（data 模块 entity 字段） */
export const AUDIT_ENTITY_LABELS: Record<string, string> = {
  company: '公司',
  subject: '科目',
  aggregation_map: '汇总主体映射',
  expense_subject_mapping: '运营费用映射',
  product_category: '产品品类',
  key_metrics_product: '关键指标产品',
  subject_budget_config: '科目预算配置',
  budget_ratio_config: '月度预算比例',
}

/** 审计导入模板类型→中文 */
export const AUDIT_TEMPLATE_LABELS: Record<string, string> = {
  operating: '经营数据',
  static: '静态数据',
  cashflow: '现金流',
  budget: '年度预算',
  transaction: '往来数据',
  inventory: '存货数据',
}

/** 审计 detail 通用键→中文（未识别结构回退为键值对展示时使用） */
export const AUDIT_DETAIL_KEY_LABELS: Record<string, string> = {
  username: '用户',
  role: '角色',
  roles: '角色',
  before: '变更前',
  after: '变更后',
  added: '新增',
  removed: '移除',
  rowCount: '数据行数',
  errorCount: '错误行数',
  detailCount: '明细行数',
  templateType: '模板类型',
  valueUnit: '数值单位',
  entity: '对象',
  status: '状态',
  fields: '字段',
  keyword: '关键词',
  version: '版本',
  versionNo: '版本号',
  toVersion: '回滚至版本',
  from: '来源',
  style: '润色风格',
  pipeline: 'AI 管道',
  reason: '原因',
  leaks: '脱敏拦截',
  statusTo: '目标状态',
  resource: '资源',
  action: '操作',
  anyOf: '所需权限之一',
}

/** 达成率红绿灯阈值（与 kpi-card 分级语义联动；后端口径变更时先改此处） */
export const ACHIEVEMENT_RATE_THRESHOLDS = {
  /** ≥ 达标线：绿色（持续关注） */
  PASS: 75,
  /** ≥ 预警线且 < 达标线：黄色（需改善计划） */
  WARN: 60,
} as const
