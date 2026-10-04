import { cloneElement, type ReactElement, useEffect, useRef, useState, type ReactNode } from 'react'
import { Drawer } from 'antd'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
/** 顶栏选择器共用桌面浮层与手机底部面板，触发器关闭后恢复焦点。 */
export function HeaderFilterPanel({ open, onOpenChange, title, trigger, children, footer }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; trigger: ReactNode; children: ReactNode; footer?: ReactNode
}) {
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches)
  const anchor = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    const change = () => setMobile(query.matches)
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented) { onOpenChange(false); anchor.current?.querySelector('button')?.focus() } }
    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [open, onOpenChange])
  const content = <div className="header-filter-content"><div className="header-filter-heading"><h2>{title}</h2></div><div className="header-filter-body">{children}</div>{footer && <div className="header-filter-footer">{footer}</div>}</div>
  if (mobile) return <><span ref={anchor} className="header-filter-anchor">{cloneElement(trigger as ReactElement<{ onClick: () => void }>, { onClick: () => onOpenChange(!open) })}</span>
    <Drawer open={open} onClose={() => onOpenChange(false)} placement="bottom" height="min(78dvh, 640px)" title={title}
      rootClassName="header-filter-drawer" styles={{ body: { padding: 0 } }} destroyOnHidden>{content}</Drawer></>
  return <span ref={anchor} className="header-filter-anchor"><Popover open={open} onOpenChange={onOpenChange}><PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent align="end" className="header-filter-popover"><div role="group" aria-label={title}>{content}</div></PopoverContent>
  </Popover></span>
}
