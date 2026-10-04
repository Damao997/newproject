import * as React from "react"
import { Input as AntdInput } from "antd"
import { useModelAdapter } from '@/components/forms/form-model'
import { cn } from "@/lib/utils"

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}

/**
 * 多行文本门面：antd Input.TextArea，签名与原生 textarea 一致（value/onChange(event)/rows 等）。
 */
const Textarea = React.forwardRef<React.ComponentRef<typeof AntdInput.TextArea>, TextareaProps>(
  ({ className, style, ...props }, ref) => {
    const adapter = useModelAdapter()
    if (adapter && props.name) return adapter.render(props.name, (field) => <><AntdInput.TextArea {...props} id={props.id ?? props.name} disabled={props.disabled || field.disabled}
      ref={(instance) => { field.ref(instance); if (typeof ref === 'function') ref(instance); else if (ref) ref.current = instance }}
      className={cn('resize-none text-sm', className)} style={{ ...style, resize: 'none' }}
      aria-invalid={field.invalid} status={field.invalid ? 'error' : undefined}
      aria-describedby={field.message ? (props.id ?? props.name) + '-error' : props['aria-describedby']}
      onBlur={(event) => { field.onBlur(); props.onBlur?.(event) }} />
      {field.message && <p id={(props.id ?? props.name) + '-error'} className="mt-1 text-xs text-danger">{field.message}</p>}</>)
    return (
      <AntdInput.TextArea
        ref={ref}
        className={cn("resize-none text-sm", className)}
        style={{ ...style, resize: 'none' }}
        {...props}
      />
    )
  }
)
Textarea.displayName = "Textarea"

export { Textarea }
