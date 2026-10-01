import { useLayoutEffect, useState, type RefObject } from 'react'

/** 按页面滚动容器的实际剩余空间限高；仅由表格页面显式启用。 */
export function useViewportPanelHeight(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const [height, setHeight] = useState<number>()

  useLayoutEffect(() => {
    if (!enabled) return
    const panel = ref.current
    const main = panel?.closest('main')
    if (!panel || !main) return
    const measure = () => {
      // 加上 scrollTop 消除页面滚动的影响，避免越滚动面板越高。
      const top = panel.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop
      const bottomPadding = Number.parseFloat(getComputedStyle(panel.parentElement ?? main).paddingBottom) || 0
      const next = Math.max(0, main.clientHeight - top - bottomPadding)
      setHeight((previous) => previous === next ? previous : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(main)
    if (panel.parentElement) observer.observe(panel.parentElement)
    window.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.visualViewport?.removeEventListener('resize', measure)
    }
  }, [enabled, ref])

  return enabled ? height : undefined
}
