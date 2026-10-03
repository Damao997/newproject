import { useCallback, useRef, useState } from 'react'

/** 文件处理和多阶段操作共用原子锁；包括请求前的确认阶段。 */
export function useFormTask() {
  const lock = useRef(false)
  const [pending, setPending] = useState(false)
  const run = useCallback(async <T,>(operation: () => Promise<T>): Promise<T | undefined> => {
    if (lock.current) return undefined
    lock.current = true; setPending(true)
    try { return await operation() } finally { lock.current = false; setPending(false) }
  }, [])
  return { pending, run }
}
