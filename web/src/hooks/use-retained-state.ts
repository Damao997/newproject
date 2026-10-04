import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
// 仅保留列表查询条件，内存生命周期随页面会话结束；不存储编辑草稿。
const queryMemory = new Map<string, unknown>()
export function useRetainedState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => queryMemory.has(key) ? queryMemory.get(key) as T : initial)
  useEffect(() => { queryMemory.set(key, value) }, [key, value])
  return [value, setValue]
}
