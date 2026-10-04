import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

const Tabs = TabsPrimitive.Root
type TabsVariant = 'default' | 'line' | 'outlined' | 'segmented'
/** 四个兼容变体共用圆润切换样式，segmented 用于卡片内的紧凑口径切换。 */
const TabsVariantContext = React.createContext<TabsVariant>('default')

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & { variant?: TabsVariant }
>(({ className, variant = 'default', ...props }, ref) => (
  <TabsVariantContext.Provider value={variant}>
    <TabsPrimitive.List ref={ref} data-tabs-variant={variant}
      className={cn('app-tabs-list inline-flex max-w-full items-center text-muted-foreground', className)} {...props} />
  </TabsVariantContext.Provider>
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & { variant?: TabsVariant }
>(({ className, variant: variantProp, ...props }, ref) => {
  const contextVariant = React.useContext(TabsVariantContext)
  return <TabsPrimitive.Trigger ref={ref} data-tabs-variant={variantProp ?? contextVariant}
    className={cn('app-tab-trigger inline-flex shrink-0 items-center justify-center whitespace-nowrap text-sm font-medium disabled:pointer-events-none disabled:opacity-50', className)} {...props} />
})
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', className)} {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
