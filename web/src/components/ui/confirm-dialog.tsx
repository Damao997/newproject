import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ConfirmOptions {
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作：确认按钮用 destructive 样式 */
  danger?: boolean
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

/**
 * Radix 风格确认对话框 hook，替代原生 window.confirm。
 * 用法：const { confirm, element } = useConfirm()
 *   if (!(await confirm({ title, description, danger: true })) ) return
 *   ...；并在 JSX 中渲染 {element}
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({ open: false })
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((options: ConfirmOptions = {}) => {
    setState({ ...options, open: true })
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setState((s) => ({ ...s, open: false }))
  }, [])

  const element = (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) settle(false) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title ?? '确认操作'}</DialogTitle>
          {state.description && <DialogDescription>{state.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>{state.cancelText ?? '取消'}</Button>
          <Button variant={state.danger ? 'destructive' : 'default'} onClick={() => settle(true)}>
            {state.confirmText ?? '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, element }
}
