import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, History, Info, RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent, DialogBody,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  compareVersions,
  fetchReleaseNotes,
  getCurrentVersion,
  getLastSeenUpdateVersion,
  markUpdateSeen,
  markVersionRead,
  sortReleasesDesc,
  type ReleaseEntry,
  type ReleaseNoteType,
} from '@/lib/app-version'
import { useNoticeStore } from '@/stores/noticeStore'

type NoteMeta = { label: string; variant: BadgeProps['variant'] }

const NOTE_TYPE_META: Record<ReleaseNoteType, NoteMeta> = {
  feature: { label: '新功能', variant: 'success' },
  fix: { label: '修复', variant: 'destructive' },
  improvement: { label: '优化', variant: 'secondary' },
  note: { label: '提示', variant: 'info' },
}

/**
 * 未知类型的兜底标签。release-notes.json 是人工维护的数据，
 * 一旦出现映射表外的 type，绝不能让它把整页渲染带崩
 * （v2026.10.9 事故：type=note 触发 `NOTE_TYPE_META[n.type].variant` 抛错，
 * 登录后所有页面被错误边界接管）。
 */
const NOTE_FALLBACK_META: NoteMeta = { label: '更新', variant: 'secondary' }

function noteMeta(type: string): NoteMeta {
  return (NOTE_TYPE_META as Record<string, NoteMeta>)[type] ?? NOTE_FALLBACK_META
}

function ReleaseNotesBody({ entry }: { entry: ReleaseEntry }) {
  return (
    <ul className="space-y-2">
      {entry.notes.map((n, i) => {
        const meta = noteMeta(n.type)
        return (
          <li key={i} className="flex items-start gap-2 text-body leading-6 text-foreground">
            <Badge variant={meta.variant} className="mt-0.5 shrink-0">
              {meta.label}
            </Badge>
            <span>{n.text}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** 公告弹窗内部视图：main=最新公告内容；list=历史版本列表；detail=某版本详情 */
type NoticeViewState = 'main' | 'list' | 'detail'

/**
 * 版本更新公告（登录后全局挂载，见 MainLayout）：
 * - 发现新版本（服务器已发布更新、本地仍是旧版）：底部常驻横幅 + 公告弹窗，可一键刷新；
 * - 当前已是最新且公告未读：自动弹窗展示本次更新内容，确认后写 localStorage；
 * - 顶栏用户菜单「更新公告」：手动打开公告弹窗，随时查看更新内容与历史版本；
 * - 历史版本：主视图提供显著入口 → 倒序版本列表 → 单个版本完整公告（非最新版明确标注为历史版本）；
 * - 开发环境（无 meta app-version）或发布说明拉取失败：静默不渲染（手动入口除外）。
 */
export function VersionNotice() {
  const currentVersion = useMemo(() => getCurrentVersion(), [])
  const [releases, setReleases] = useState<ReleaseEntry[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [autoDialog, setAutoDialog] = useState<ReleaseEntry | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [view, setView] = useState<NoticeViewState>('main')
  const [selected, setSelected] = useState<ReleaseEntry | null>(null)

  const noticeOpen = useNoticeStore((s) => s.open)
  const noticeInitialView = useNoticeStore((s) => s.initialView)
  const closeNotice = useNoticeStore((s) => s.closeNotice)

  useEffect(() => {
    let cancelled = false
    fetchReleaseNotes().then((data) => {
      if (!cancelled) setReleases(data.releases)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 历史版本列表统一按发布时间倒序，不依赖 release-notes.json 的人工维护顺序
  const sorted = useMemo(() => sortReleasesDesc(releases), [releases])
  const latest = sorted[0]
  const isDev = currentVersion === 'dev'
  const hasNewVersion =
    !!latest && !isDev && compareVersions(latest.version, currentVersion) > 0

  // 自动弹窗只提醒需要刷新的新版本，当前版本公告保留手动入口。
  useEffect(() => {
    if (!latest || isDev) return
    if (compareVersions(latest.version, currentVersion) > 0) {
      if (getLastSeenUpdateVersion() !== latest.version) {
        markUpdateSeen(latest.version)
        setAutoDialog(latest)
      }
    }
  }, [latest, currentVersion, isDev])

  // 顶栏「更新公告」入口：打开弹窗并进入指定视图
  useEffect(() => {
    if (!noticeOpen) return
    setView(noticeInitialView)
    setSelected(null)
  }, [noticeOpen, noticeInitialView])

  const closeAuto = () => {
    setAutoDialog(null)
    if (latest) markVersionRead(latest.version)
  }

  const handleClose = () => {
    closeAuto()
    setDialogOpen(false)
    closeNotice()
    setView('main')
    setSelected(null)
  }

  // 开发环境且非手动打开时静默不渲染；手动入口即使无数据也需给出可见反馈
  const canRender = noticeOpen || (!isDev && !!latest && sorted.length > 0)
  if (!canRender) return null

  const showDialog = dialogOpen || autoDialog !== null || noticeOpen
  const openEntry = dialogOpen || noticeOpen ? latest : autoDialog
  // 视图兜底：缺少入口/选中项时回落到列表，避免弹窗空白
  const activeView: NoticeViewState =
    view === 'main' && !openEntry ? 'list' : view === 'detail' && !selected ? 'list' : view

  const titleText = hasNewVersion
    ? `发现新版本 ${openEntry?.version ?? latest?.version ?? ''}`
    : autoDialog
      ? `欢迎使用 ${openEntry?.version ?? ''}`
      : '更新公告'

  return (
    <>
      {/* 底部横幅：检测到服务器已发布新版本（本地仍为旧版）时常驻 */}
      {hasNewVersion && !bannerDismissed && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t bg-background/95 px-4 py-2 backdrop-blur-sm">
          <p className="flex items-center gap-2 text-body text-foreground">
            <RefreshCw className="h-4 w-4 shrink-0 text-primary" />
            系统有新版本 {latest.version}，点击查看更新内容
          </p>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="sm" onClick={() => setDialogOpen(true)}>
              查看更新
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="关闭更新提示"
              onClick={() => setBannerDismissed(true)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={showDialog}
        onOpenChange={(o) => {
          if (!o) handleClose()
        }}
      >
        <DialogContent className="max-w-md">
          {/* 主视图：最新公告内容 + 历史版本入口 */}
          {activeView === 'main' && openEntry && (
            <>
              <DialogHeader>
                <DialogTitle>{titleText}</DialogTitle>
                <DialogDescription>
                  {openEntry.title}｜发布于 {openEntry.publishedAt}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="grid gap-4">
                <div className="min-w-0">
                  <ReleaseNotesBody entry={openEntry} />
                </div>
                {sorted.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setView('list')}
                    className="flex w-full items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2.5 text-left transition-colors hover:bg-muted"
                  >
                    <span className="flex items-center gap-2 text-body text-foreground">
                      <History className="h-4 w-4 shrink-0 text-primary" />
                      查看历史版本更新
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-caption text-muted-foreground">
                      共 {sorted.length} 个版本
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </button>
                )}
              </DialogBody>
              <DialogFooter>
                {hasNewVersion ? (
                  <>
                    <Button variant="outline" onClick={handleClose}>
                      稍后再说
                    </Button>
                    <Button onClick={() => window.location.reload()}>
                      <RefreshCw className="mr-1 h-4 w-4" />
                      立即刷新
                    </Button>
                  </>
                ) : autoDialog ? (
                  <Button onClick={handleClose}>我知道了</Button>
                ) : (
                  <Button variant="outline" onClick={handleClose}>
                    关闭
                  </Button>
                )}
              </DialogFooter>
            </>
          )}

          {/* 历史版本列表：按发布时间倒序 */}
          {activeView === 'list' && (
            <>
              <DialogHeader>
                <DialogTitle>历史版本更新</DialogTitle>
                <DialogDescription>
                  {sorted.length > 0 ? `按发布时间倒序，共 ${sorted.length} 个版本` : '暂无更新公告记录'}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="-mx-1">
                {sorted.length === 0 ? (
                  <p className="px-1 py-8 text-center text-body text-muted-foreground">暂无更新公告记录</p>
                ) : (
                  <ul className="divide-y divide-border/60">
                    {sorted.map((r) => (
                      <li key={r.version}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(r)
                            setView('detail')
                          }}
                          className="flex w-full items-center gap-3 rounded-md px-1 py-3 text-left transition-colors hover:bg-muted/60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="text-body font-medium text-foreground">{r.version}</span>
                              {r.version === latest?.version && <Badge variant="info">最新</Badge>}
                              <span className="text-caption text-muted-foreground">{r.publishedAt}</span>
                            </span>
                            <span className="mt-1 line-clamp-2 block text-body text-muted-foreground">
                              {r.title}
                            </span>
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setView('main')}>
                  返回
                </Button>
              </DialogFooter>
            </>
          )}

          {/* 历史版本详情：完整公告内容 + 历史版本标注 */}
          {activeView === 'detail' && selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {selected.version}
                  {selected.version === latest?.version ? (
                    <Badge variant="info">最新版本</Badge>
                  ) : (
                    <Badge variant="warning">历史版本</Badge>
                  )}
                </DialogTitle>
                <DialogDescription>
                  {selected.title}｜发布于 {selected.publishedAt}
                </DialogDescription>
              </DialogHeader>
              <DialogBody className="grid gap-4">
                {selected.version !== latest?.version && latest && (
                  <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/[0.08] px-3 py-2 text-caption text-warning-strong">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      当前查看的是历史版本 {selected.version}，最新版本为 {latest.version}
                    </span>
                  </div>
                )}
                <div className="min-w-0">
                  <ReleaseNotesBody entry={selected} />
                </div>
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setView('list')}>
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  返回列表
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
