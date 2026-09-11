import { useLayoutEffect, useRef, useState } from 'react'

/**
 * 页面吸顶测量 hook：与财务指标页（indicators/index.tsx）ResizeObserver 模式一致，
 * 实时测量 PageContainer 吸顶标题区（headerRef）与页面筛选卡（filterRef）的高度，
 * 驱动筛选卡/表格容器的吸顶偏移（top = headerHeight / headerHeight + filterHeight）。
 *
 * 用法：
 *   const { headerRef, filterRef, headerHeight, filterHeight } = useStickyHeader()
 *   <PageContainer stickyHeader headerRef={headerRef} ...>
 *     <Card ref={filterRef} className="sticky z-10" style={{ top: headerHeight }}>筛选卡</Card>
 *     <div className="sticky overflow-auto" style={{ top: headerHeight + filterHeight, maxHeight: ... }}>表格</div>
 */
export function useStickyHeader() {
  const headerRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)
  const [headerHeight, setHeaderHeight] = useState(0)
  const [filterHeight, setFilterHeight] = useState(0)

  useLayoutEffect(() => {
    const headerEl = headerRef.current
    const filterEl = filterRef.current
    const measureHeader = () => {
      if (headerEl) setHeaderHeight(headerEl.getBoundingClientRect().height)
    }
    const measureFilter = () => {
      if (filterEl) setFilterHeight(filterEl.getBoundingClientRect().height)
    }
    measureHeader()
    measureFilter()
    const roHeader = new ResizeObserver(measureHeader)
    const roFilter = new ResizeObserver(measureFilter)
    if (headerEl) roHeader.observe(headerEl)
    if (filterEl) roFilter.observe(filterEl)
    return () => {
      roHeader.disconnect()
      roFilter.disconnect()
    }
  }, [])

  return { headerRef, filterRef, headerHeight, filterHeight }
}
