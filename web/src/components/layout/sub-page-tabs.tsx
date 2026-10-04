import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useActivePath } from './sidebar/use-active-path'

export interface SubPageTab { path: string; label: string; group?: string }

/** 可收藏的分类使用路由链接；同一页口径切换仍由共享 Radix Tabs 负责。 */
export function SubPageTabs({ items }: { items: SubPageTab[] }) {
  const pathname = useActivePath()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ before: false, after: false })
  const active = items.find((item) => item.path === pathname) ?? items[0]

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const measure = () => {
      const before = viewport.scrollLeft > 2
      const after = viewport.scrollLeft + viewport.clientWidth < viewport.scrollWidth - 2
      setOverflow((previous) => previous.before === before && previous.after === after ? previous : { before, after })
    }
    revealLink(viewport.querySelector<HTMLElement>('[aria-current="page"]'))
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    const list = viewport.firstElementChild
    if (list) observer.observe(list)
    viewport.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => { observer.disconnect(); viewport.removeEventListener('scroll', measure) }
  }, [pathname, items])

  function revealLink(link: HTMLElement | null | undefined) {
    const viewport = viewportRef.current
    if (!viewport || !link) return
    const visible = viewport.getBoundingClientRect(), item = link.getBoundingClientRect()
    if (item.left < visible.left + 3) viewport.scrollLeft += item.left - visible.left - 3
    else if (item.right > visible.right - 3) viewport.scrollLeft += item.right - visible.right + 3
  }
  const scroll = (direction: number) => {
    const viewport = viewportRef.current
    viewport?.scrollBy({ left: direction * viewport.clientWidth * .7, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }
  const moveFocus = (event: KeyboardEvent<HTMLAnchorElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    const links = viewportRef.current?.querySelectorAll<HTMLAnchorElement>('a')
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    links?.[next]?.focus()
    revealLink(links?.[next])
  }

  if (!items.length) return null
  return <nav aria-label="模块分类" className={"module-tabs min-w-0 shrink-0" + (items.some(item => item.group) ? " module-tabs--grouped" : "")}>
    <button type="button" className="module-tabs-scroll" aria-label="查看前面的分类" disabled={!overflow.before} hidden={!overflow.before && !overflow.after} onClick={() => scroll(-1)}><ChevronLeft className="h-4 w-4" /></button>
    <div ref={viewportRef} className="module-tabs-viewport">
      <div className="module-tabs-list">
        {Array.from(new Set(items.map(item => item.group ?? ''))).map(group => <div key={group} className={group ? 'module-tabs-group' : 'contents'}>
          {group && <span className="module-tabs-group-label">{group}</span>}
          <div className={group ? 'module-tabs-group-links' : 'contents'}>{items.filter(item => (item.group ?? '') === group).map(item => <Link key={item.path} to={item.path} aria-current={item === active ? 'page' : undefined}
            className="module-tab" onKeyDown={event => moveFocus(event, items.indexOf(item))}>{item.label}</Link>)}</div>
        </div>)}
      </div>
    </div>
    <button type="button" className="module-tabs-scroll" aria-label="查看后面的分类" disabled={!overflow.after} hidden={!overflow.before && !overflow.after} onClick={() => scroll(1)}><ChevronRight className="h-4 w-4" /></button>
  </nav>
}
