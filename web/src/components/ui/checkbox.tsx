import * as React from "react"
import { Checkbox as AntdCheckbox } from "antd"
import { cn } from "@/lib/utils"

export interface CheckboxProps
  extends Omit<
    React.ComponentPropsWithoutRef<typeof AntdCheckbox>,
    'onChange' | 'checked' | 'indeterminate'
  > {
  /** Radix 兼容：true/false/'indeterminate'（半选态） */
  checked?: boolean | 'indeterminate'
  /** Radix 兼容：勾选回调 */
  onCheckedChange?: (checked: boolean | 'indeterminate') => void
  /** 两档尺寸：default（16px）/ sm（14px，紧凑表格） */
  size?: 'default' | 'sm'
}

/**
 * 复选框门面：antd Checkbox。
 * 保留 Radix 的 checked('indeterminate' 半选) 与 onCheckedChange 签名（全站统一用法）。
 */
const Checkbox = React.forwardRef<React.ComponentRef<typeof AntdCheckbox>, CheckboxProps>(
  ({ className, size = 'default', checked, onCheckedChange, ...props }, ref) => {
    const isIndeterminate = checked === 'indeterminate'
    return (
      <AntdCheckbox
        ref={ref}
        checked={checked === true}
        indeterminate={isIndeterminate}
        className={cn(size === 'sm' && 'scale-[0.875]', className)}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
        {...props}
      />
    )
  }
)
Checkbox.displayName = "Checkbox"

export { Checkbox }
