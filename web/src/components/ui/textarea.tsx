import * as React from "react"
import { Input as AntdInput } from "antd"
import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * 多行文本门面：antd Input.TextArea，签名与原生 textarea 一致（value/onChange(event)/rows 等）。
 */
const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <AntdInput.TextArea
        ref={ref}
        className={cn("text-sm", className)}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
