/**
 * antd 门面共享工具：从调用方 className 中的 Tailwind 高度类推断 antd size。
 *
 * antd 控件高度由 size token 决定（small/middle/large 对应 controlHeightSM/controlHeight/controlHeightLG），
 * 调用方沿用 shadcn 习惯传 h-8/h-9/h-11 类；门面解析后映射到 antd size，
 * 高度类本身保留（与 token 数值一致，视觉无冲突）。
 */

/** h-8→small(32) / h-9,h-10→middle(36) / h-11→large(44)；无匹配返回 fallback */
export function antdSizeFromClassName(
  className?: string,
  fallback: 'small' | 'middle' | 'large' = 'middle',
): 'small' | 'middle' | 'large' {
  if (!className) return fallback
  if (/(^|\s|\])h-8(?=\s|$)/.test(className)) return 'small'
  if (/(^|\s|\])h-11(?=\s|$)/.test(className)) return 'large'
  if (/(^|\s|\])h-(9|10)(?=\s|$)/.test(className)) return 'middle'
  return fallback
}
