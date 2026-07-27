import { Fragment, type ReactNode } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { SubjectNode } from '@/types'

const dataTypeMeta: Record<
  SubjectNode['dataType'],
  { label: string; variant: 'secondary' | 'default' | 'warning' }
> = {
  data: { label: '数据类', variant: 'secondary' },
  calc: { label: '计算类', variant: 'default' },
  display: { label: '展示类', variant: 'warning' },
}

interface SubjectTreeProps {
  nodes: SubjectNode[]
  /** 已展开的科目编码集合（受控） */
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  /** 高亮关键字（命中名称时高亮） */
  keyword?: string
  emptyText?: string
  /** 可选：每行操作列渲染器（传入时渲染「操作」列） */
  actions?: (node: SubjectNode) => ReactNode
}

/** 高亮命中的关键字片段 */
function highlight(text: string, keyword?: string) {
  const kw = keyword?.trim()
  if (!kw) return text
  const idx = text.toLowerCase().indexOf(kw.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-amber-100 px-0.5 text-amber-900">
        {text.slice(idx, idx + kw.length)}
      </mark>
      {text.slice(idx + kw.length)}
    </>
  )
}

function TreeRows({
  nodes,
  depth,
  expandedCodes,
  onToggle,
  keyword,
  actions,
}: {
  nodes: SubjectNode[]
  depth: number
  expandedCodes: Set<string>
  onToggle: (code: string) => void
  keyword?: string
  actions?: (node: SubjectNode) => ReactNode
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0
        const isExpanded = expandedCodes.has(node.code)
        const meta = dataTypeMeta[node.dataType]
        return (
          <Fragment key={node.code}>
            <tr className="border-b transition-colors hover:bg-muted/50">
              <td className="px-4 py-1.5 leading-[14px] align-middle">
                <div className="flex items-center" style={{ paddingLeft: depth * 20 }}>
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => onToggle(node.code)}
                      className="mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label={isExpanded ? '折叠' : '展开'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <span className="mr-1 inline-block h-5 w-5 shrink-0" />
                  )}
                  <span className={cn(depth === 0 && 'font-semibold', 'text-foreground')}>
                    {highlight(node.name, keyword)}
                  </span>
                </div>
              </td>
              <td className="px-4 py-1.5 leading-[14px] align-middle font-mono text-muted-foreground">{node.code}</td>
              <td className="px-4 py-1.5 leading-[14px] align-middle">
                <Badge variant="outline">level{node.level}</Badge>
              </td>
              <td className="px-4 py-1.5 leading-[14px] align-middle text-muted-foreground">{node.category}</td>
              <td className="px-4 py-1.5 leading-[14px] align-middle">
                <Badge variant={meta.variant}>{meta.label}</Badge>
              </td>
              {actions && (
                <td className="px-4 py-1.5 leading-[14px] align-middle">
                  <div className="flex items-center justify-end gap-1">{actions(node)}</div>
                </td>
              )}
            </tr>
            {hasChildren && isExpanded && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                expandedCodes={expandedCodes}
                onToggle={onToggle}
                keyword={keyword}
                actions={actions}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

/**
 * 经营分析科目树形表格。
 *
 * 纸质感样式对齐 data-table.tsx；支持按编码受控展开折叠、缩进表达层级、
 * 展示编码/层级/类别/数据类型徽标，并可高亮搜索命中。
 */
export function SubjectTree({
  nodes,
  expandedCodes,
  onToggle,
  keyword,
  emptyText = '暂无科目',
  actions,
}: SubjectTreeProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full caption-bottom text-[13px]">
        <thead className="[&_tr]:border-b">
          <tr className="border-b bg-muted/50">
            <th className="h-8 px-4 text-[13px] leading-[14px] text-center align-middle font-medium text-black">科目名称</th>
            <th className="h-8 px-4 text-[13px] leading-[14px] text-center align-middle font-medium text-black">科目编码</th>
            <th className="h-8 px-4 text-[13px] leading-[14px] text-center align-middle font-medium text-black">层级</th>
            <th className="h-8 px-4 text-[13px] leading-[14px] text-center align-middle font-medium text-black">类别</th>
            <th className="h-8 px-4 text-[13px] leading-[14px] text-center align-middle font-medium text-black">数据类型</th>
            {actions && (
              <th className="h-8 px-4 text-[13px] leading-[14px] text-center align-middle font-medium text-black">操作</th>
            )}
          </tr>
        </thead>
        <tbody>
          {nodes.length === 0 ? (
            <tr>
              <td colSpan={actions ? 6 : 5} className="p-8 text-center text-muted-foreground">
                {emptyText}
              </td>
            </tr>
          ) : (
            <TreeRows
              nodes={nodes}
              depth={0}
              expandedCodes={expandedCodes}
              onToggle={onToggle}
              keyword={keyword}
              actions={actions}
            />
          )}
        </tbody>
      </table>
    </div>
  )
}
