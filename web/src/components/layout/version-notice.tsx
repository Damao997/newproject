import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  compareVersions,
  fetchReleaseNotes,
  getCurrentVersion,
  getLastReadVersion,
  getLastSeenUpdateVersion,
  markUpdateSeen,
  markVersionRead,
  type ReleaseEntry,
  type ReleaseNoteItem,
} from '@/lib/app-version'

const NOTE_TYPE_META: Record<ReleaseNoteItem['type'], { label: string; variant: BadgeProps['variant'] }> = {
  feature: { label: '新功能', variant: 'success' },
  fix: { label: '修复', variant: 'destructive' },
  improvement: { label: '优化', variant: 'secondary' },
}

function ReleaseNotesBody({ entry }: { entry: ReleaseEntry }) {
  return (
    <ul className="space-y-2">
      {entry.notes.map((n, i) => (
        <li key={i} className="flex items-start gap-2 text-body leading-6 text-foreground">
          <Badge variant={NOTE_TYPE_META[n.type].variant} className="mt-0.5 shrink-0">
            {NOTE_TYPE_META[n.type].label}
          </Badge>
          <span>{n.text}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * 版本更新公告（登录后全局挂载，见 MainLayout）：
 * - 发现新版本（服务器已发布更新、本地仍是旧版）：底部常驻横幅 + 公告弹窗，可一键刷新；
 * - 当前已是最新且公告未读：自动弹窗展示本次更新内容，确认后写 localStorage；
 * - 开发环境（无 meta app-version）或发布说明拉取失败：静默不渲染。
 */
export function VersionNotice() {
  const currentVersion = useMemo(() => getCurrentVersion(), [])
  const [releases, setReleases] = useState<ReleaseEntry[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [autoDialog, setAutoDialog] = useState<ReleaseEntry | null>(null)
  const [bannerDismissed, setBannerDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchReleaseNotes().then((data) => {
      if (!cancelled) setReleases(data.releases)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const latest = releases[0]
  const isDev = currentVersion === 'dev'
  const hasNewVersion =
    !!latest && !isDev && compareVersions(latest.version, currentVersion) > 0

  // 自动弹窗：发现新版本仅弹一次；当前已最新但公告未读则弹出欢迎
  useEffect(() => {
    if (!latest || isDev) return
    if (compareVersions(latest.version, currentVersion) > 0) {
      if (getLastSeenUpdateVersion() !== latest.version) {
        markUpdateSeen(latest.version)
        setAutoDialog(latest)
      }
    } else if (
      compareVersions(latest.version, currentVersion) === 0 &&
      getLastReadVersion() !== latest.version
    ) {
      setAutoDialog(latest)
    }
  }, [latest, currentVersion, isDev])

  const closeAuto = () => {
    setAutoDialog(null)
    if (latest) markVersionRead(latest.version)
  }

  if (isDev || !latest || releases.length === 0) return null

  const showDialog = dialogOpen || autoDialog !== null
  const openEntry = dialogOpen ? latest : autoDialog

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

      {/* 公告弹窗：新版本详情 + 立即刷新；或当前版本的欢迎公告 */}
      <Dialog
        open={showDialog}
        onOpenChange={(o) => {
          if (!o) {
            closeAuto()
            setDialogOpen(false)
          }
        }}
      >
        {openEntry && (
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>
                {hasNewVersion
                  ? `发现新版本 ${openEntry.version}`
                  : `欢迎使用 ${openEntry.version}`}
              </DialogTitle>
              <DialogDescription>
                {openEntry.title}｜发布于 {openEntry.publishedAt}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] overflow-y-auto">
              <ReleaseNotesBody entry={openEntry} />
            </div>
            <DialogFooter>
              {hasNewVersion ? (
                <>
                  <Button variant="outline" onClick={closeAuto}>
                    稍后再说
                  </Button>
                  <Button onClick={() => window.location.reload()}>
                    <RefreshCw className="mr-1 h-4 w-4" />
                    立即刷新
                  </Button>
                </>
              ) : (
                <Button onClick={closeAuto}>我知道了</Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  )
}
