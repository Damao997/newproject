import { useRef, useState } from 'react'
import { BookmarkPlus, Loader2, Share2, Star, Trash2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { useFormModel, useFormValue } from '@/components/forms/form-model'
import { useFormClose } from '@/components/forms/form-navigation'
import { useAnalysisViews, useAnalysisViewMutations } from '@/hooks/api-queries'
import { ANALYSIS_ROW_DIMS, type AnalysisQuerySpec, type AnalysisViewItem } from '@/types'

/**
 * 视图管理（自定义报表持久化，L1-3，见 docs/plans/即席分析-L1L2-阶段方案.md §2.2）。
 *
 * 「保存为视图」= 当前 spec 具名落库（可选共享给所有 dashboard:view 用户）；
 * 「我的视图」= 列表含他人共享（只读）；自己的视图可编辑名称/共享并写回当前 spec，或删除。
 * 加载 = 把 spec 交回工作台（onApply），服务端不参与执行，与查询接口解耦。
 *
 * 输入与关闭：名称/共享只来自 useFormModel；Escape、遮罩、取消、路由离开共用 dirty/busy 策略。
 * 写入：保存中防重复并阻止关闭；失败保留输入；结果未知先查询确认；成功后用服务端返回对象
 * 核对列表与选中视图，不做本地乐观假设。
 */

type EditorTarget = { mode: 'create' } | { mode: 'edit'; view: AnalysisViewItem }

const errorText = (error: unknown) => {
  const responseMessage = (error as { response?: { data?: { message?: string } } })?.response?.data?.message
  if (responseMessage) return responseMessage
  return error instanceof Error ? error.message : '操作失败'
}

export function ViewManager({
  spec,
  onApply,
}: {
  spec: AnalysisQuerySpec
  onApply: (spec: AnalysisQuerySpec) => void
}) {
  const viewsQuery = useAnalysisViews()
  const mutations = useAnalysisViewMutations()
  const views = viewsQuery.data?.views ?? []
  const { confirm, element: confirmElement } = useConfirm()

  const model = useFormModel({ name: '', shared: false }, { name: '请输入视图名称' })
  const [name, setName] = useFormValue(model, 'name')
  const [shared, setShared] = useFormValue(model, 'shared')

  const [editor, setEditor] = useState<EditorTarget | null>(null)
  const [listOpen, setListOpen] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busyNotice, setBusyNotice] = useState(false)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const listTriggerRef = useRef<HTMLButtonElement>(null)

  const dialogBusy = model.pending || Boolean(mutations.create.isPending) || Boolean(mutations.update.isPending)
  const listBusy = Boolean(mutations.update.isPending) || Boolean(mutations.remove.isPending) || pendingActionId !== null
  // 先读取 errors 以订阅 react-hook-form 校验状态，避免“校验已失败但视图不重渲染”。
  const nameError = model.form.formState.errors.name?.message
  const showNameError = model.validationAttempted.current ? nameError : undefined

  const restoreFocus = () => {
    const preferred = returnFocusRef.current
    requestAnimationFrame(() => {
      const target = preferred && preferred.isConnected ? preferred : listTriggerRef.current
      target?.focus()
    })
  }

  const closeEditor = () => {
    setEditor(null)
    setSaveError(null)
    setBusyNotice(false)
    model.form.clearErrors()
    restoreFocus()
  }

  const closeGuard = useFormClose({
    dirty: model.form.formState.isDirty,
    busy: dialogBusy,
    enabled: editor !== null,
    onClose: closeEditor,
  })

  const requestClose = () => {
    if (dialogBusy) {
      setBusyNotice(true)
      return
    }
    closeGuard.requestClose()
  }

  const openEditor = async (target: EditorTarget) => {
    if (editor && model.form.formState.isDirty) {
      const discard = await confirm({
        title: '放弃未保存的修改？',
        description: `切换编辑对象会丢弃「${name.trim() || '未命名视图'}」尚未保存的名称修改。`,
        confirmText: '放弃并切换',
        danger: true,
      })
      if (!discard) return
    }
    returnFocusRef.current = document.activeElement as HTMLElement | null
    model.setValues(target.mode === 'create' ? { name: '', shared: false } : { name: target.view.name, shared: target.view.shared })
    model.form.clearErrors()
    setSaveError(null)
    setBusyNotice(false)
    setListOpen(false)
    setEditor(target)
  }

  /** 以服务端返回对象为起点，重新查询列表确认；返回是否已在列表中确认。 */
  const confirmSaved = async (saved: AnalysisViewItem, verb: string) => {
    const result = await viewsQuery.refetch()
    if (result.isError) {
      setNotice(`${verb}「${saved.name}」；列表刷新失败，已按服务端返回结果选中该视图`)
      setListError(`列表刷新失败：${errorText(result.error)}；请稍后重试刷新确认`)
      setActiveId(saved.id)
      return true
    }
    const matched = result.data?.views.find((view) => view.id === saved.id)
    if (!matched) {
      setSaveError(`${verb}接口已返回成功，但视图列表未包含该视图；请刷新列表确认后再操作。`)
      return false
    }
    setActiveId(matched.id)
    setNotice(`${verb}「${matched.name}」，列表已确认`)
    return true
  }

  const reconcileUnknownWrite = async (target: EditorTarget, trimmed: string, error: unknown) => {
    let latest: AnalysisViewItem[] | undefined
    let refreshFailed = false
    try {
      const result = await viewsQuery.refetch()
      if (result.isError) refreshFailed = true
      latest = result.data?.views
    } catch {
      refreshFailed = true
    }
    if (target.mode === 'create') {
      const matched = latest?.find((view) => view.isOwner && view.name === trimmed)
      if (matched) {
        setActiveId(matched.id)
        setNotice(`写入结果未知，已重新查询确认视图「${matched.name}」已保存`)
        closeEditor()
        return
      }
      setSaveError(`保存失败：${errorText(error)}${refreshFailed ? '；重新查询列表也失败，请稍后人工确认' : '；已重新查询，列表中未出现该视图'}`)
      return
    }
    const matched = latest?.find((view) => view.id === target.view.id)
    if (matched && matched.name === trimmed) {
      setActiveId(matched.id)
      setNotice(`写入结果未知，已重新查询确认视图「${matched.name}」已更新`)
      closeEditor()
      return
    }
    setSaveError(`更新失败：${errorText(error)}${refreshFailed ? '；重新查询列表也失败，请稍后人工确认' : `；已重新查询，名称未变为「${trimmed}」`}`)
  }

  const save = model.submit(async () => {
    const target = editor
    if (!target) return
    const trimmed = name.trim()
    setSaveError(null)
    setBusyNotice(false)
    try {
      if (target.mode === 'create') {
        const created = await mutations.create.mutateAsync({ name: trimmed, spec, shared })
        if (await confirmSaved(created, '已保存')) closeEditor()
      } else {
        const updated = await mutations.update.mutateAsync({ id: target.view.id, name: trimmed, spec, shared })
        if (await confirmSaved(updated, '已更新')) closeEditor()
      }
    } catch (error) {
      // 写入结果未知：只重新查询确认，不自动重发写请求。
      await reconcileUnknownWrite(target, trimmed, error)
    }
  })

  const handleApply = (view: AnalysisViewItem) => {
    if (listBusy) return
    onApply(view.spec)
    setActiveId(view.id)
    setNotice(`已加载视图「${view.name}」`)
    setListOpen(false)
  }

  const handleDelete = async (view: AnalysisViewItem) => {
    const confirmed = await confirm({
      title: '删除视图',
      description: `将删除「${view.name}」${view.shared ? '（已共享给团队成员）' : ''}。删除后无法恢复，团队成员将无法再加载。`,
      confirmText: '删除',
      danger: true,
    })
    if (!confirmed) return
    setPendingActionId(view.id)
    setListError(null)
    setNotice(null)
    try {
      await mutations.remove.mutateAsync(view.id)
      const result = await viewsQuery.refetch()
      if (result.isError) {
        setListError(`删除请求已返回，但列表刷新失败：${errorText(result.error)}；请重试刷新确认`)
        return
      }
      if (result.data?.views.some((item) => item.id === view.id)) {
        setListError(`删除「${view.name}」未被服务端确认，视图仍在列表中`)
        return
      }
      if (activeId === view.id) setActiveId(null)
      setNotice(`已删除「${view.name}」，列表已确认`)
    } catch (error) {
      let latest: AnalysisViewItem[] | undefined
      try {
        const result = await viewsQuery.refetch()
        latest = result.data?.views
      } catch {
        latest = undefined
      }
      const gone = !!latest && !latest.some((item) => item.id === view.id)
      if (gone) {
        if (activeId === view.id) setActiveId(null)
        setNotice(`删除结果未知，已重新查询确认「${view.name}」已删除`)
      } else {
        setListError(`删除失败：${errorText(error)}${latest ? '；视图仍在列表中，可重试' : '；重新查询失败，请稍后确认'}`)
      }
    } finally {
      setPendingActionId(null)
    }
  }

  const dimLabel = (viewSpec: AnalysisQuerySpec) => {
    const row = ANALYSIS_ROW_DIMS.find((d) => d.value === viewSpec.rowDim)
    const col = viewSpec.colDim ? ` × ${ANALYSIS_ROW_DIMS.find((d) => d.value === viewSpec.colDim)?.label ?? viewSpec.colDim}` : ''
    return `${row?.label ?? viewSpec.rowDim}${col}`
  }

  const viewsEmpty = viewsQuery.isError && !viewsQuery.data

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" className="h-9 gap-1.5"
        onClick={(event) => { returnFocusRef.current = event.currentTarget; void openEditor({ mode: 'create' }) }}>
        <BookmarkPlus className="h-3.5 w-3.5" />
        保存为视图
      </Button>
      <Popover open={listOpen} onOpenChange={setListOpen}>
        <PopoverTrigger asChild>
          <Button ref={listTriggerRef} variant="outline" size="sm" className="h-9 gap-1.5" aria-label="我的视图">
            <Star className="h-3.5 w-3.5" />
            我的视图{views.length > 0 ? `（${views.length}）` : ''}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="end">
          <div className="border-b px-3 py-2 text-xs text-muted-foreground">
            点击名称加载视图；自己的视图可编辑名称与共享设置
          </div>
          <div className="max-h-80 overflow-y-auto p-1">
            {viewsQuery.isPending ? (
              <p className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />正在加载视图…
              </p>
            ) : viewsEmpty ? (
              <div role="alert" className="space-y-2 px-3 py-4 text-xs">
                <p className="font-medium text-destructive">视图列表加载失败</p>
                <p className="text-muted-foreground">{errorText(viewsQuery.error)}</p>
                <Button variant="outline" size="sm" onClick={() => { void viewsQuery.refetch() }}>重试加载</Button>
              </div>
            ) : views.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">暂无视图（查询成功，列表为空），先在分析区调好维度与指标再「保存为视图」</p>
            ) : (
              <>
                {viewsQuery.isError && (
                  <p role="alert" className="mx-1 mb-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                    列表刷新失败，以下为上次成功结果：{errorText(viewsQuery.error)}
                  </p>
                )}
                {views.map((view) => (
                  <div key={view.id} className="flex items-center gap-1 rounded px-1 py-1 hover:bg-muted/50">
                    <button type="button" className="min-w-0 flex-1 text-left" aria-current={view.id === activeId ? 'true' : undefined}
                      disabled={listBusy} onClick={() => handleApply(view)}>
                      <span className="block truncate text-sm" title={view.name}>{view.name}</span>
                      <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        {dimLabel(view.spec)}
                        {view.shared && <span className="inline-flex items-center gap-0.5"><Share2 className="h-2.5 w-2.5" />共享</span>}
                        {!view.isOwner && <span>来自 {view.ownerName}</span>}
                        {view.id === activeId && <span className="text-primary">当前</span>}
                        <span>{new Date(view.updatedAt).toLocaleString('zh-CN')}</span>
                      </span>
                    </button>
                    {view.isOwner && (
                      <span className="flex shrink-0 items-center">
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" title="编辑视图（名称、共享并写回当前分析）"
                          disabled={listBusy}
                          onClick={(event) => { returnFocusRef.current = event.currentTarget; void openEditor({ mode: 'edit', view }) }}>
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" title="删除视图"
                          disabled={listBusy}
                          onClick={(event) => { returnFocusRef.current = event.currentTarget; void handleDelete(view) }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </span>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
          {(listError || notice) && (
            <div className="space-y-1 border-t px-3 py-2 text-[11px]">
              {listError && <p role="alert" className="text-destructive">{listError}</p>}
              {notice && <p role="status" className="text-muted-foreground">{notice}</p>}
            </div>
          )}
          {pendingActionId && <p role="status" className="border-t px-3 py-2 text-[11px] text-muted-foreground">正在写入并重新查询确认…</p>}
        </PopoverContent>
      </Popover>

      {notice && (
        <span role="status" title={notice} className="max-w-[240px] truncate text-xs text-muted-foreground">{notice}</span>
      )}

      <Dialog open={editor !== null} onOpenChange={(open) => { if (!open) requestClose() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editor?.mode === 'edit' ? `编辑视图「${editor.view.name}」` : '保存为视图'}</DialogTitle>
            <DialogDescription>
              当前分析口径（行维度{spec.colDim ? ' × 列维度' : ''}、指标、过滤、选项）将具名保存，之后可在「我的视图」一键加载。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input value={name} maxLength={50} placeholder="视图名称（如：厨房电器月度达成）"
              aria-label="视图名称" aria-invalid={!!showNameError}
              onChange={(e) => setName(e.target.value)} />
            {showNameError && (
              <p role="alert" className="text-xs text-destructive">{showNameError}</p>
            )}
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Checkbox checked={shared} onCheckedChange={(v) => setShared(v === true)} aria-label="共享给团队成员" />
              共享给团队成员（所有可看经营分析的同事均可加载）
            </label>
            {saveError && <p role="alert" className="text-xs text-destructive">{saveError}</p>}
            {busyNotice && <p role="status" className="text-xs text-muted-foreground">正在保存，请等待结果后再关闭</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={requestClose}>取消</Button>
            <Button onClick={() => { void save() }} disabled={dialogBusy}>
              {dialogBusy && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {closeGuard.element}
      {confirmElement}
    </div>
  )
}
