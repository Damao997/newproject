import { useLocation } from 'react-router-dom'

/**
 * 当前激活路径（仅 pathname，忽略 search）。
 * 筛选/翻页等 query 参数不应影响菜单展开跟随与高亮，故统一以 pathname 为准。
 */
export function useActivePath() {
  const location = useLocation()
  return location.pathname
}
