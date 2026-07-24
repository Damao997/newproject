import type { User, Company, AccountSubject, Metric, Role, KpiData, TrendData, Alert, ImportBatch, AuditLog } from '@/types'

export const mockUsers: User[] = [
  {
    id: '1',
    username: 'admin',
    name: '管理员',
    role: 'admin',
    dataScope: '*',
    status: 'active',
    lastLoginAt: '2025-07-15T09:30:00Z',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-07-15T09:30:00Z',
  },
  {
    id: '2',
    username: 'zhangsan',
    name: '张三',
    role: 'finance_analyst_it',
    dataScope: 'EN330059',
    status: 'active',
    lastLoginAt: '2025-07-14T14:20:00Z',
    createdAt: '2025-01-15T00:00:00Z',
    updatedAt: '2025-07-14T14:20:00Z',
  },
  {
    id: '3',
    username: 'lisi',
    name: '李四',
    role: 'department_manager',
    dataScope: 'BU_EAST',
    status: 'active',
    lastLoginAt: '2025-07-13T10:15:00Z',
    createdAt: '2025-02-01T00:00:00Z',
    updatedAt: '2025-07-13T10:15:00Z',
  },
  {
    id: '4',
    username: 'wangwu',
    name: '王五',
    role: 'viewer',
    dataScope: 'EN330060',
    status: 'inactive',
    createdAt: '2025-03-01T00:00:00Z',
    updatedAt: '2025-06-01T00:00:00Z',
  },
]

export const mockCompanies: Company[] = [
  { id: '1', code: 'ET0001', name: '浙江省公司汇总', type: 'summary', status: 'active' },
  { id: '2', code: 'EN330059', name: '杭州分公司', type: 'entity', status: 'active' },
  { id: '3', code: 'EN330060', name: '宁波分公司', type: 'entity', status: 'active' },
  { id: '4', code: 'EN330061', name: '温州分公司', type: 'entity', status: 'active' },
  { id: '5', code: 'EN330062', name: '广州分公司', type: 'entity', status: 'active' },
  { id: '6', code: 'EN330063', name: '深圳分公司', type: 'entity', status: 'active' },
  { id: '7', code: 'EN330064', name: '北京分公司', type: 'entity', status: 'active' },
  { id: '8', code: 'EN330065', name: '天津分公司', type: 'entity', status: 'active' },
  { id: '9', code: 'EN330066', name: '成都分公司', type: 'entity', status: 'active' },
  { id: '10', code: 'EN330067', name: '武汉分公司', type: 'entity', status: 'active' },
]

export const mockAccountSubjects: AccountSubject[] = [
  { id: '1', code: 'OP_001', name: '主营业务收入', type: 'operating', level: 0, status: 'active' },
  { id: '2', code: 'OP_025', name: '灶具收入', type: 'operating', level: 1, parentId: '1', status: 'active' },
  { id: '3', code: 'OP_026', name: '热水器收入', type: 'operating', level: 1, parentId: '1', status: 'active' },
  { id: '4', code: 'OP_030', name: '主营业务成本', type: 'operating', level: 0, status: 'active' },
  { id: '5', code: 'OP_031', name: '灶具成本', type: 'operating', level: 1, parentId: '4', status: 'active' },
  { id: '6', code: 'OP_040', name: '毛利', type: 'operating', level: 0, status: 'active' },
  { id: '7', code: 'OP_050', name: '销售费用', type: 'operating', level: 0, status: 'active' },
  { id: '8', code: 'OP_060', name: '管理费用', type: 'operating', level: 0, status: 'active' },
  { id: '9', code: 'ST_001', name: '总资产', type: 'static', level: 0, status: 'active' },
  { id: '10', code: 'ST_002', name: '净资产', type: 'static', level: 0, status: 'active' },
]

export const mockMetrics: Metric[] = [
  { id: '1', code: 'OP_025', name: '灶具收入', dataType: 'data', status: 'active' },
  { id: '2', code: 'OP_026', name: '热水器收入', dataType: 'data', status: 'active' },
  { id: '3', code: 'OP_030', name: '主营业务成本', dataType: 'data', status: 'active' },
  { id: '4', code: 'OP_040', name: '毛利', dataType: 'calc', formula: 'OP_001 - OP_030', sourceAccountCodes: ['OP_001', 'OP_030'], status: 'active' },
  { id: '5', code: 'CALC_毛利率', name: '毛利率', dataType: 'calc', formula: 'OP_040 / OP_001', sourceAccountCodes: ['OP_040', 'OP_001'], dependsOn: ['OP_040'], status: 'active' },
]

export const mockRoles: Role[] = [
  { id: '1', code: 'admin', name: '管理员', description: '系统全权管理员', isSystem: true, permissions: [] },
  { id: '2', code: 'finance_manager', name: '财务主管', description: '财务数据管理+分析', isSystem: true, permissions: [] },
  { id: '3', code: 'department_manager', name: '部门经理', description: '事业部经营监控', isSystem: true, permissions: [] },
  { id: '4', code: 'viewer', name: '查看者', description: '只读查看', isSystem: true, permissions: [] },
  { id: '5', code: 'finance_analyst_it', name: '财务分析师(兼IT)', description: '财务分析全权限 + IT 限定权限', isSystem: true, permissions: [] },
]

export const mockKpiData: KpiData[] = [
  {
    title: '总收入',
    value: 1234.56,
    unit: '万',
    change: 0.123,
    trend: [1100, 1150, 1200, 1180, 1220, 1234.56],
    icon: 'TrendingUp',
  },
  {
    title: '总成本',
    value: 876.54,
    unit: '万',
    change: 0.081,
    trend: [800, 820, 850, 860, 870, 876.54],
    icon: 'DollarSign',
  },
  {
    title: '毛利',
    value: 358.02,
    unit: '万',
    change: 0.225,
    trend: [300, 320, 340, 350, 355, 358.02],
    icon: 'TrendingUp',
  },
  {
    title: '费用',
    value: 156.78,
    unit: '万',
    change: 0.052,
    trend: [140, 145, 150, 152, 155, 156.78],
    icon: 'Receipt',
  },
  {
    title: '预算执行率',
    value: 92.3,
    unit: '%',
    change: -0.077,
    trend: [88, 89, 90, 91, 92, 92.3],
    icon: 'Target',
  },
]

export const mockTrendData: TrendData[] = [
  { period: '2025-01', revenue: 1100, cost: 800, profit: 300, budget: 1050 },
  { period: '2025-02', revenue: 1150, cost: 820, profit: 330, budget: 1100 },
  { period: '2025-03', revenue: 1200, cost: 850, profit: 350, budget: 1150 },
  { period: '2025-04', revenue: 1180, cost: 860, profit: 320, budget: 1180 },
  { period: '2025-05', revenue: 1220, cost: 870, profit: 350, budget: 1200 },
  { period: '2025-06', revenue: 1234.56, cost: 876.54, profit: 358.02, budget: 1250 },
  { period: '2024-07', revenue: 1050, cost: 750, profit: 300, budget: 1000 },
  { period: '2024-08', revenue: 1080, cost: 770, profit: 310, budget: 1050 },
  { period: '2024-09', revenue: 1100, cost: 780, profit: 320, budget: 1100 },
  { period: '2024-10', revenue: 1120, cost: 790, profit: 330, budget: 1120 },
  { period: '2024-11', revenue: 1150, cost: 800, profit: 350, budget: 1150 },
  { period: '2024-12', revenue: 1180, cost: 820, profit: 360, budget: 1180 },
]

export const mockAlerts: Alert[] = [
  {
    id: '1',
    type: 'overdue_payment',
    title: '应收账款逾期预警',
    message: '杭州壹品慧-应收账款 逾期超 90 天 156.78 万',
    severity: 'warning',
    createdAt: '2025-07-15T09:30:00Z',
  },
  {
    id: '2',
    type: 'budget_exceeded',
    title: '预算超支预警',
    message: '广州分公司-销售费用 超预算 15%',
    severity: 'error',
    createdAt: '2025-07-14T14:20:00Z',
  },
]

export const mockImportBatches: ImportBatch[] = [
  {
    id: '1',
    filename: '经营数据_202506.xlsx',
    templateType: 'operating',
    status: 'active',
    successCount: 140,
    errorCount: 0,
    createdBy: 'admin',
    createdAt: '2025-07-10T10:00:00Z',
    activatedAt: '2025-07-10T10:05:00Z',
  },
  {
    id: '2',
    filename: '静态数据_202506.xlsx',
    templateType: 'static',
    status: 'active',
    successCount: 70,
    errorCount: 0,
    createdBy: 'admin',
    createdAt: '2025-07-10T11:00:00Z',
    activatedAt: '2025-07-10T11:05:00Z',
  },
  {
    id: '3',
    filename: '年度预算_2025.xlsx',
    templateType: 'budget',
    status: 'archived',
    successCount: 78,
    errorCount: 0,
    createdBy: 'admin',
    createdAt: '2025-07-01T09:00:00Z',
    activatedAt: '2025-07-01T09:05:00Z',
  },
]

export const mockAuditLogs: AuditLog[] = [
  { id: '1', createdAt: '2025-07-15T09:30:12Z', username: 'admin', module: '用户管理', action: '新增用户', detail: '创建用户 zhangsan（财务分析师兼IT）' },
  { id: '2', createdAt: '2025-07-15T09:15:03Z', username: 'admin', module: '数据管理', action: '导入数据', detail: '导入《经营数据_202506.xlsx》，成功 140 行' },
  { id: '3', createdAt: '2025-07-14T18:42:55Z', username: 'zhangsan', module: '财务指标', action: '导出 Excel', detail: '导出经营指标（杭州分公司 / 2025-06）' },
  { id: '4', createdAt: '2025-07-14T14:20:31Z', username: 'zhangsan', module: '登录', action: '登录成功', detail: '从IP 10.12.3.45 登录' },
  { id: '5', createdAt: '2025-07-14T11:05:18Z', username: 'lisi', module: '数据管理', action: '查看数据', detail: '浏览华东区 2025-06 明细' },
  { id: '6', createdAt: '2025-07-13T16:33:47Z', username: 'admin', module: '权限管理', action: '重置密码', detail: '重置用户 wangwu 密码' },
  { id: '7', createdAt: '2025-07-13T10:15:09Z', username: 'lisi', module: '登录', action: '登录成功', detail: '从IP 10.12.4.88 登录' },
  { id: '8', createdAt: '2025-07-12T09:02:24Z', username: 'admin', module: '用户管理', action: '停用用户', detail: '停用用户 wangwu（查看者）' },
]

// Mock API延迟
export const mockDelay = (ms: number = 500) => new Promise(resolve => setTimeout(resolve, ms))

// Mock登录
export const mockLogin = async (username: string, _password: string) => {
  await mockDelay(1000)
  const user = mockUsers.find(u => u.username === username)
  if (!user) {
    throw new Error('用户名或密码错误')
  }
  return {
    accessToken: 'mock_access_token_' + Date.now(),
    refreshToken: 'mock_refresh_token_' + Date.now(),
    user,
  }
}
