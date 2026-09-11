import { useCallback, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  /** 物理删除等不可逆操作：要求用户输入指定文本才能确认 */
  requireInput?: string
}

interface ConfirmState extends ConfirmOptions {
  open: boolean
}

/**
 * Radix 风格确认对话框 hook，替代原生 window.confirm。
 * 用法：const { confirm, element } = useConfirm()
 *   if (!(await confirm({ title, description, danger: true })) ) return
 *   ...；并在 JSX 中渲染 {element}
 *
 * 物理删除等不可逆操作可传 requireInput，用户必须输入指定文本（如实体编码）才能点击确认。
 */
export function useConfirm() {
  const [state, setState] = useState<ConfirmState>({ open: false })
  const [inputValue, setInputValue] = useState('')
  const resolver = useRef<((ok: boolean) => void) | null>(null)

  const confirm = useCallback((options: ConfirmOptions = {}) => {
    setInputValue('')
    setState({ ...options, open: true })
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = useCallback((ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setInputValue('')
    setState((s) => ({ ...s, open: false }))
  }, [])

  const inputConfirmed = !state.requireInput || inputValue.trim() === state.requireInput

  const element = (
    <Dialog open={state.open} onOpenChange={(o) => { if (!o) settle(false) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{state.title ?? '确认操作'}</DialogTitle>
          {state.description && <DialogDescription>{state.description}</DialogDescription>}
        </DialogHeader>
        {state.requireInput && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              请输入 <span className="font-mono font-semibold text-foreground">{state.requireInput}</span> 以确认操作
            </Label>
            <Input
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={state.requireInput}
              autoFocus
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => settle(false)}>{state.cancelText ?? '取消'}</Button>
          <Button variant={state.danger ? 'destructive' : 'default'} onClick={() => settle(true)} disabled={!inputConfirmed}>
            {state.confirmText ?? '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { confirm, element }
}
