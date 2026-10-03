import { type ReactNode } from 'react'
import { ArrowLeft, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogPresentationProvider } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export function WorkflowPage({ children, onBack }: { children: ReactNode; onBack: () => void }) {
  return <div className="mx-auto w-full max-w-[1120px] space-y-4 p-4 sm:p-6">
    <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-2 h-4 w-4" />返回</Button>
    <DialogPresentationProvider presentation="page">{children}</DialogPresentationProvider>
  </div>
}

export function WorkflowProgress({ steps, current }: { steps: string[]; current: number }) {
  return <ol aria-label="操作阶段" className="workflow-progress flex flex-wrap gap-3 rounded-2xl bg-muted/50 p-3">
    {steps.map((step, index) => <li key={step} aria-current={index === current ? 'step' : undefined}
      className={cn('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', index === current ? 'bg-background font-medium text-primary shadow-sm' : 'text-muted-foreground')}>
      <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-xs', index === current ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
        {index < current ? <Check className="h-3.5 w-3.5" /> : index + 1}
      </span>{step}
    </li>)}
  </ol>
}

export function WorkflowSummary({ items }: { items: { label: string; value: ReactNode }[] }) {
  return <dl className="workflow-summary flex flex-wrap gap-x-8 gap-y-3 rounded-2xl border border-border bg-primary/5 p-4">
    {items.map((item) => <div key={item.label}><dt className="text-xs text-muted-foreground">{item.label}</dt>
      <dd className="mt-1 text-sm font-medium">{item.value || '待选择'}</dd></div>)}
  </dl>
}
