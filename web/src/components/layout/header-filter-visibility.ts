/**
 * 顶栏全局筛选胶囊（CompanyPill / PeriodPill）可见性配置：
 * 按路径前缀声明不需要全局公司/期间筛选的页面（与 App.tsx 路由对齐）。
 * 命中前缀 → 两胶囊均隐藏（条件卸载，不占布局）；未命中 → 全部显示。
 * 前缀须含「/」边界（如 '/data/reclassify' 不得误伤 '/data/reclassify-xxx'）。
 */
const HIDE_GLOBAL_FILTERS_PREFIXES = [
  '/admin', // 系统管理：用户/角色/审计日志（无公司/期间维度）
  '/tools', // 企业工商信息查询
  '/reports', // 分析报告：列表/汇总/编辑器（页内自带期间选择）
  '/data/reclassify', // 数据重分类（含合并重分类子页）
  '/data/board', // 预算看板（含 category 等子路由）
  '/no-access', // 无权限兜底页
] as const

export interface HeaderFilterVisibility {
  showCompany: boolean
  showPeriod: boolean
}

export function getHeaderFilterVisibility(pathname: string): HeaderFilterVisibility {
  const hidden = HIDE_GLOBAL_FILTERS_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
  return { showCompany: !hidden, showPeriod: !hidden }
}
