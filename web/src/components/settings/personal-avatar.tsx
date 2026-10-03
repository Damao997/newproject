import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/authStore'
export function PersonalAvatar({ className = '', name, version }: { className?: string; name: string; version?: string | null }) {
  const id = useAuthStore(s => s.user?.id)
  const [source, setSource] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    let url: string | null = null
    setSource(null)
    if (version) void api.getAvatar().then(blob => {
      if (!active) return
      url = URL.createObjectURL(blob); setSource(url)
    }).catch(() => { console.error('头像读取失败，已显示姓名缩写') })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [id, version])
  return <span className={'personal-avatar ' + className}>{source ? <img src={source} alt={name + '的头像'} /> : <span aria-hidden="true">{name.slice(0, 1)}</span>}</span>
}
