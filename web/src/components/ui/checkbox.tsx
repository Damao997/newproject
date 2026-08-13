import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * 复选框：基于 Radix Checkbox，选中态品牌橙（对齐 Switch/Select 交互色）。
 * 两档尺寸：默认 h-4 w-4（表单/表格行内），size="sm" 为 h-3.5 w-3.5（紧凑表格对比选择等）。
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & { size?: 'default' | 'sm' }
>(({ className, size = 'default', ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer shrink-0 rounded-sm border border-input ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      size === 'default' ? 'h-4 w-4' : 'h-3.5 w-3.5',
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className={size === 'default' ? 'h-3.5 w-3.5' : 'h-3 w-3'} strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
