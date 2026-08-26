import * as React from "react"
import { Input as AntdInput } from "antd"
import { cn } from "@/lib/utils"
import { antdSizeFromClassName } from "./antd-size"

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix' | 'suffix'> {
  /** antd 前缀图标/文本（覆盖原生 input 的 string prefix 语义） */
  prefix?: React.ReactNode
  /** antd 后缀图标/文本 */
  suffix?: React.ReactNode
}

/**
 * 输入框门面：antd Input，保持 shadcn className 透传。
 * 高度：缺省 middle（36px，FilterBar h-9 标准）；className 含 h-8 → small、h-11 → large。
 * 受控/非受控、onChange(event) 签名与原生 input 一致，调用方零改动。
 */
const Input = React.forwardRef<React.ComponentRef<typeof AntdInput>, InputProps>(
  ({ className, type, prefix, suffix, ...props }, ref) => {
    return (
      <AntdInput
        ref={ref}
        type={type}
        prefix={prefix}
        suffix={suffix}
        size={antdSizeFromClassName(className, 'middle')}
        className={cn("text-sm", className)}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
