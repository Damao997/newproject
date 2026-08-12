/**
 * 表格共享样式常量（《统一表格设计标准》v1.0）。
 *
 * DataTable 与 metric-tree 等自研表格共同引用，保证表头/冻结列视觉一致；
 * 通过 cn（tailwind-merge）合并时可被局部类覆盖（如 px-3 覆盖 px-4）。
 */

/** 表头基础样式：13px/500 黑字居中（对齐规范 §4.4：所有标题行单元格一律居中） */
export const TABLE_HEAD_BASE =
  'whitespace-nowrap px-4 text-[13px] text-center align-middle font-medium text-black'

/** 冻结列（sticky 左列）单元格基础：白底 + 右侧分隔线，hover 时跟随行高亮 */
export const TABLE_STICKY_CELL_BASE =
  'sticky left-0 z-[1] border-r bg-background group-hover:bg-muted/50'

/** 限高滚动容器内 sticky 表头：不透明背景防止内容透出（配合 bg-muted 使用） */
export const TABLE_HEADER_STICKY = 'sticky top-0 z-20'
