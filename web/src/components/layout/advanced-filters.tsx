import { useId, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ActiveFilter { key: string; label: string; onClear?: () => void }

/** 收起仅改变可见性，筛选控件保持挂载；生效条件始终可见并可单独清除。 */
export function AdvancedFilters({ active = [], children, className }: { active?: ActiveFilter[]; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <div className={cn('min-w-0', className)}>
      <div className="flex flex-wrap items-center gap-2">
        <Button ref={triggerRef} variant="ghost" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen((value) => !value)}>
          <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" aria-hidden />高级筛选<ChevronDown className={cn('ml-1.5 h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden />
        </Button>
        {active.map((filter) => filter.onClear ? <button key={filter.key} type="button" aria-label={`清除筛选：${filter.label}`} onClick={() => { filter.onClear?.(); triggerRef.current?.focus() }} className="inline-flex max-w-full items-center gap-1 rounded-md border border-subtle bg-muted px-2 py-1 text-xs text-foreground"><span className="truncate">{filter.label}</span><X className="h-3 w-3 shrink-0" aria-hidden /></button> : <span key={filter.key} className="rounded-md bg-muted px-2 py-1 text-xs text-foreground">{filter.label}</span>)}
      </div>
      <Collapsible open={open}><div id={id} role="region" aria-label="高级筛选" className="mt-3 flex flex-wrap items-center gap-3 border-t border-subtle pt-3">{children}</div></Collapsible>
    </div>
  )
}
