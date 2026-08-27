import * as React from "react"
import { Select as AntdSelect } from "antd"
import type { DefaultOptionType } from "antd/es/select"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { antdSizeFromClassName } from "./antd-size"

/**
 * antd Select 视觉本体是内部 .ant-select-selector（自带不透明白底 + 边框）；
 * 调用方为旧 shadcn 触发器设计的底色/hover/border 类挂在根节点上不生效（selector 覆盖）。
 * 解析后剥离（防误导），hover 底色与浅边框经组件级 styles.selector 以 CSS 变量转译，视觉与原 Tailwind 类完全一致。
 */
function extractSelectSurface(className: string | undefined): { cleaned: string; selectorStyle: Record<string, unknown> } {
  if (!className) return { cleaned: '', selectorStyle: {} }
  const style: Record<string, unknown> = {}
  let cleaned = className
  // hover 浅灰底（hover:bg-muted/N）→ selector 的 :hover 伪类（cssinjs 支持）
  const hoverM = /(?:^|\s)hover:bg-muted\/(\d+)(?=\s|$)/.exec(className)
  if (hoverM) {
    style['&:hover'] = { backgroundColor: `hsl(var(--muted) / ${Number(hoverM[1]) / 100})` }
    cleaned = cleaned.replace(hoverM[0], '').trim()
  }
  // 浅边框（border-input 或 border-input/N）→ selector 边框色
  const borderM = /(?:^|\s)border-input(?:\/(\d+))?(?=\s|$)/.exec(className)
  if (borderM) {
    const alpha = borderM[1] ? Number(borderM[1]) / 100 : 1
    style.borderColor = alpha < 1 ? `hsl(var(--input) / ${alpha})` : 'hsl(var(--input))'
    cleaned = cleaned.replace(borderM[0], '').trim()
  }
  // 白底类（bg-page/bg-background）在 selector 白底下多余，剥离避免误导
  cleaned = cleaned.replace(/(?:^|\s)(bg-page|bg-background)(?=\s|$)/g, ' ').replace(/\s{2,}/g, ' ').trim()
  return { cleaned, selectorStyle: style }
}

/**
 * Select 门面：antd Select。
 *
 * 保持 Radix Select 的组合 API（Select/SelectTrigger/SelectValue/SelectContent/
 * SelectItem/SelectGroup/SelectLabel/SelectSeparator），全站 40+ 调用点零改动。
 *
 * 实现方式（声明式子组件收集）：
 * - Select root 遍历 children：SelectTrigger 收集 className/id/title/disabled/aria-label，
 *   其子 SelectValue 收集 placeholder；非 SelectValue 的 trigger children 作为自定义回显
 *   （antd labelRender，用于 CompanySelect 等触发器文案与选项文案不同的场景）；
 * - SelectContent 下的 SelectItem → options；SelectGroup+SelectLabel → 分组 options；
 *   SelectSeparator → divider；
 * - 空值语义：Radix 以 '' 为未选 → antd undefined（placeholder 展示），onChange 回填 ''。
 * - 下拉宽度自适应内容（popupMatchSelectWidth=false），对齐 Radix popper 行为
 *   （窄触发器 + 长选项场景，如账龄页 94px 期间选择器）。
 */

interface SelectItemProps {
  value: string
  disabled?: boolean
  children?: React.ReactNode
  className?: string
}

interface SelectTriggerProps extends React.HTMLAttributes<HTMLButtonElement> {
  /** 门面扩展：空值占位文案（company-select 等自定义回显场景由 antd placeholder 承担空值态） */
  placeholder?: string
  children?: React.ReactNode
  disabled?: boolean
}

interface SelectValueProps {
  placeholder?: React.ReactNode
  children?: React.ReactNode
}

interface SelectGroupProps {
  children?: React.ReactNode
}

interface SelectLabelProps {
  children?: React.ReactNode
}

/** 提取 trigger children 中非 SelectValue 的部分作为自定义回显 */
function extractCustomDisplay(children: React.ReactNode): React.ReactNode | undefined {
  let display: React.ReactNode | undefined
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type !== SelectValue) display = child
  })
  return display
}

/** 提取 SelectValue 的 placeholder（prop 优先，children 兜底） */
function extractPlaceholder(children: React.ReactNode): string | undefined {
  let placeholder: string | undefined
  React.Children.forEach(children, (child) => {
    if (React.isValidElement(child) && child.type === SelectValue) {
      const p = child.props as SelectValueProps
      const raw = p.placeholder ?? p.children
      placeholder = typeof raw === 'string' ? raw : undefined
    }
  })
  return placeholder
}

/** SelectContent 子树 → antd options（支持 Item/Group+Label/Separator 与条件数组） */
function collectOptions(nodes: React.ReactNode, options: DefaultOptionType[]): void {
  React.Children.forEach(nodes, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectItem) {
      const p = child.props as SelectItemProps
      options.push({ value: p.value, label: p.children, disabled: p.disabled })
    } else if (child.type === SelectGroup) {
      const group: DefaultOptionType & { options: DefaultOptionType[] } = { label: '', options: [] }
      React.Children.forEach((child.props as SelectGroupProps).children, (c) => {
        if (!React.isValidElement(c)) return
        if (c.type === SelectLabel) {
          const lp = c.props as SelectLabelProps
          group.label = lp.children as string
        } else if (c.type === SelectItem) {
          const p = c.props as SelectItemProps
          group.options.push({ value: p.value, label: p.children, disabled: p.disabled })
        }
      })
      if (group.options.length > 0) options.push(group)
    } else if (child.type === SelectSeparator) {
      options.push({ type: 'divider' } as DefaultOptionType)
    }
  })
}

interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children?: React.ReactNode
  /** Radix 兼容：整组禁用 */
  disabled?: boolean
  /** 无障碍：传给 combobox 触发器 */
  'aria-label'?: string
}

const Select = ({ value, defaultValue, onValueChange, disabled, children, ...rest }: SelectProps) => {
  // ---- 声明式子组件收集 ----
  let triggerProps: SelectTriggerProps | null = null
  let customDisplay: React.ReactNode | undefined
  let placeholder: string | undefined
  const options: DefaultOptionType[] = []

  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return
    if (child.type === SelectTrigger) {
      const p = child.props as SelectTriggerProps
      triggerProps = p
      placeholder = p.placeholder ?? extractPlaceholder(p.children)
      customDisplay = extractCustomDisplay(p.children)
    } else if (child.type === SelectContent) {
      collectOptions((child.props as { children?: React.ReactNode }).children, options)
    }
  })

  const trigger = triggerProps as SelectTriggerProps | null

  // 清洗底色类（根节点对 antd 无效）并经组件级 styles.selector 转译为 selector 样式（恢复 hover 底色/浅边框）
  const { cleaned: cleanedClass, selectorStyle } = extractSelectSurface(trigger?.className)

  return (
    <AntdSelect
      // Radix 空串语义 ↔ antd undefined（placeholder 展示）
      value={value === '' || value === undefined ? undefined : value}
      defaultValue={defaultValue === '' || defaultValue === undefined ? undefined : defaultValue}
      onChange={(v) => onValueChange?.(v ?? '')}
      options={options}
      placeholder={placeholder}
      disabled={disabled || trigger?.disabled}
      id={trigger?.id}
      title={trigger?.title}
      aria-label={rest['aria-label'] ?? (trigger?.['aria-label'] as string | undefined)}
      size={antdSizeFromClassName(cleanedClass, 'middle')}
      className={cn('w-full', cleanedClass)}
      styles={Object.keys(selectorStyle).length > 0
        // antd Select 组件级样式仅暴露 root 命名空间；样式作用于内部 .ant-select-selector（视觉本体），
        // cssinjs 支持嵌套选择器与 & 伪类，类型上以断言放宽
        ? ({ root: { '& .ant-select-selector': selectorStyle } } as never)
        : undefined}
      // 自定义回显：CompanySelect 等"触发器文案 ≠ 选项文案"场景（antd ≥5.23 labelRender）
      labelRender={customDisplay ? () => <>{customDisplay}</> : undefined}
      // 对齐原 Radix 触发器的 lucide 折叠箭头
      suffixIcon={<ChevronDown className="h-4 w-4 opacity-50" />}
      // 下拉宽度自适应内容（Radix popper 行为；窄触发器+长选项不截断）
      popupMatchSelectWidth={false}
    />
  )
}
Select.displayName = "Select"

/** 声明式占位：由 Select root 收集 props，自身不渲染 DOM */
const SelectGroup = (_props: SelectGroupProps) => null
SelectGroup.displayName = "SelectGroup"

const SelectValue = (_props: SelectValueProps) => null
SelectValue.displayName = "SelectValue"

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  (_props, _ref) => null
)
SelectTrigger.displayName = "SelectTrigger"

const SelectContent = (_props: { children?: React.ReactNode; className?: string }) => null
SelectContent.displayName = "SelectContent"

const SelectLabel = (_props: SelectLabelProps) => null
SelectLabel.displayName = "SelectLabel"

const SelectItem = (_props: SelectItemProps) => null
SelectItem.displayName = "SelectItem"

const SelectSeparator = () => null
SelectSeparator.displayName = "SelectSeparator"

// Radix 兼容导出（滚动按钮在 antd 中无对应物，占位）
const SelectScrollUpButton = () => null
const SelectScrollDownButton = () => null

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
}
