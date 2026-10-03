import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

/** 懒加载和详情标题更新时，浏览器标签与当前可见页面保持一致。 */
export function DocumentTitle() {
  const { pathname } = useLocation()
  useEffect(() => {
    const update = () => {
      const title = document.querySelector('h1')?.textContent?.trim()
        || document.querySelector<HTMLInputElement>('input[aria-label="报告标题"]')?.value?.trim()
        || document.querySelector('[data-route-error] h2')?.textContent?.trim()
        || '加载中'
      const next = `${title} · 浙江壹品慧`
      if (document.title !== next) document.title = next
    }
    update()
    const observer = new MutationObserver(update)
    const root = document.getElementById('root')
    if (root) observer.observe(root, { subtree: true, childList: true, characterData: true })
    root?.addEventListener('input', update)
    return () => { observer.disconnect(); root?.removeEventListener('input', update) }
  }, [pathname])
  return null
}
