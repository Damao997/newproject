import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

type TabsVariant = 'default' | 'line' | 'outlined'
/** TabsList 的 variant 自动传播给内部 TabsTrigger（TabsTrigger 可显式覆盖） */
const TabsVariantContext = React.createContext<TabsVariant>('default')

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = 'default', ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List
      ref={ref}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
        variant === 'line' && "h-auto gap-x-5 rounded-none border-b border-border bg-transparent p-0",
        variant === 'outlined' && "h-auto gap-1.5 rounded-none border-0 bg-transparent p-0",
        className
      )}
      {...props}
    />
  </TabsVariantContext.Provider>
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { variant?: TabsVariant }
>(({ className, variant: variantProp, ...props }, ref) => {
  const ctxVariant = React.useContext(TabsVariantContext)
  const variant = variantProp ?? ctxVariant
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        variant === 'line' &&
          "relative rounded-none bg-transparent px-1 py-2 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:font-medium after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:h-0.5 after:w-8 after:-translate-x-1/2 after:rounded-full after:bg-primary after:content-[''] after:opacity-0 after:transition-opacity data-[state=active]:after:opacity-100",
        variant === 'outlined' &&
          "rounded-md border border-transparent bg-transparent px-3 py-1.5 text-muted-foreground shadow-none hover:bg-transparent hover:text-foreground data-[state=active]:border-primary/30 data-[state=active]:bg-primary/5 data-[state=active]:text-primary data-[state=active]:font-medium data-[state=active]:shadow-none",
        className
      )}
      {...props}
    />
  )
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
