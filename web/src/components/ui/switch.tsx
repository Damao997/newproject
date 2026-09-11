import * as React from "react"
import { Switch as AntdSwitch } from "antd"
import { cn } from "@/lib/utils"

export interface SwitchProps
  extends Omit<React.ComponentPropsWithoutRef<typeof AntdSwitch>, 'onChange'> {
  /** Radix 兼容：勾选回调（antd onChange 的布尔首参），全站统一用法 */
  onCheckedChange?: (checked: boolean) => void
  /** 原生 change 事件（透传给 antd） */
  onChange?: (
    checked: boolean,
    event: React.MouseEvent<HTMLButtonElement> | React.KeyboardEvent<HTMLButtonElement>,
  ) => void
}

/**
 * 开关门面：antd Switch。
 * 保留 Radix 的 onCheckedChange(checked) 签名，映射到 antd onChange；checked/disabled/id 等直接透传。
 */
const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, onCheckedChange, onChange, ...props }, ref) => {
    return (
      <AntdSwitch
        ref={ref}
        className={cn(className)}
        onChange={(checked, event) => {
          onCheckedChange?.(checked)
          onChange?.(checked, event)
        }}
        {...props}
      />
    )
  }
)
Switch.displayName = "Switch"

export { Switch }
