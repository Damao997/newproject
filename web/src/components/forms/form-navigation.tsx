import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useBlocker } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogBody, DialogFooter } from '@/components/ui/dialog'

const ActivityContext = createContext({ busy: false, discardAll: () => {} })
export const useFormActivity = () => useContext(ActivityContext)

type Entry = { dirty: boolean; busy: boolean }
const NavigationContext = createContext<((id: string, entry: Entry | null) => void) | null>(null)

/** 路由只注册一个阻断器，编辑器、弹窗与整页流程共用离开保护。 */
export function FormNavigationProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, Entry>())
  const [, update] = useState(0)
  const register = useCallback((id: string, entry: Entry | null) => {
    if (entry) entries.current.set(id, entry)
    else entries.current.delete(id)
    update((value) => value + 1)
  }, [])
  const active = [...entries.current.values()].some((entry) => entry.dirty || entry.busy)
  const busy = [...entries.current.values()].some((entry) => entry.busy)
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    [...entries.current.values()].some((entry) => entry.dirty || entry.busy) &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search))
  useEffect(() => {
    if (!active) return
    const onUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [active])
  const discardAll = useCallback(() => { entries.current.clear(); update(value => value + 1) }, [])
  return <ActivityContext.Provider value={{ busy, discardAll }}><NavigationContext.Provider value={register}>{children}
    <Dialog open={blocker.state === 'blocked'} onOpenChange={(open) => { if (!open && blocker.state === 'blocked') blocker.reset() }} presentation="modal">
      <DialogContent className="max-w-md"><DialogHeader><DialogTitle>{busy ? '正在保存' : '放弃未保存的修改？'}</DialogTitle></DialogHeader>
        <DialogBody><p className="text-sm text-muted-foreground">{busy ? '操作正在执行，请等待结果后再离开。' : '离开后，本次未保存的内容会丢失。'}</p></DialogBody>
        <DialogFooter><Button variant="outline" onClick={() => { if (blocker.state === 'blocked') blocker.reset() }}>{busy ? '留在此页' : '继续编辑'}</Button>
          {!busy && <Button variant="destructive" onClick={() => { if (blocker.state === 'blocked') blocker.proceed() }}>放弃修改</Button>}
        </DialogFooter></DialogContent>
    </Dialog>
  </NavigationContext.Provider></ActivityContext.Provider>
}

export function useFormNavigation(dirty: boolean, busy: boolean) {
  const register = useContext(NavigationContext)
  const id = useId()
  useEffect(() => { register?.(id, { dirty, busy }); return () => register?.(id, null) }, [register, id, dirty, busy])
  return useCallback(() => register?.(id, null), [register, id])
}

/** 本地关闭和取消也走同一保护；成功回调直接关闭，不再提示已保存内容。 */
export function useFormClose({ dirty, busy, onClose, enabled = true }: { dirty: boolean; busy: boolean; onClose: () => void; enabled?: boolean }) {
  const release = useFormNavigation(enabled && dirty, enabled && busy)
  const [confirming, setConfirming] = useState(false)
  const requestClose = useCallback(() => {
    if (busy) return
    if (dirty) setConfirming(true)
    else onClose()
  }, [busy, dirty, onClose])
  const element = <Dialog open={confirming} onOpenChange={setConfirming} presentation="modal">
    <DialogContent className="max-w-md"><DialogHeader><DialogTitle>放弃未保存的修改？</DialogTitle></DialogHeader>
      <DialogBody><p className="text-sm text-muted-foreground">本次填写的内容尚未保存。</p></DialogBody>
      <DialogFooter><Button variant="outline" autoFocus onClick={() => setConfirming(false)}>继续编辑</Button>
        <Button variant="destructive" disabled={busy} onClick={() => { setConfirming(false); release(); onClose() }}>放弃修改</Button></DialogFooter>
    </DialogContent></Dialog>
  return { requestClose, element }
}
