/**
 * 前端应用版本与发布说明工具。
 *
 * 版本来源：部署脚本 deploy-zjyph.ps1 构建后向 index.html 注入
 *   <meta name="app-version" content="v2026.08.x">；开发环境无该标签，视为 'dev'。
 * 发布说明：web/public/release-notes.json（随构建进入 dist，由 nginx 直出）。
 */

export interface ReleaseNoteItem {
  type: 'feature' | 'fix' | 'improvement'
  text: string
}

export interface ReleaseEntry {
  version: string
  publishedAt: string
  title: string
  notes: ReleaseNoteItem[]
}

export interface ReleaseNotesData {
  releases: ReleaseEntry[]
}

export const APP_VERSION_META_KEY = 'app-version'
/** localStorage：用户已读公告的最新版本 */
export const READ_VERSION_STORAGE_KEY = 'app-version-read'
/** localStorage：已自动弹出"发现新版本"提示的最新版本 */
export const UPDATE_SEEN_STORAGE_KEY = 'app-version-update-seen'

/** 读取当前部署版本（meta 标签）；开发环境无标签返回 'dev' */
export function getCurrentVersion(): string {
  return document.querySelector(`meta[name="${APP_VERSION_META_KEY}"]`)?.getAttribute('content') || 'dev'
}

/**
 * 版本号比较：vYYYY.MM.N 三段数字逐位比较（v2026.08.10 > v2026.08.2）；
 * 兼容非纯 tag（v2026.08.1-3-g2a3b4c5 取主版本段，部署脚本已归一化，此处为防御）；
 * 无法解析的版本（含 'dev'）视为最低。
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : []
  }
  const pa = parse(a)
  const pb = parse(b)
  if (pa.length === 0 && pb.length === 0) return 0
  if (pa.length === 0) return -1
  if (pb.length === 0) return 1
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

export function getLastReadVersion(): string | null {
  return localStorage.getItem(READ_VERSION_STORAGE_KEY)
}

export function markVersionRead(version: string): void {
  localStorage.setItem(READ_VERSION_STORAGE_KEY, version)
}

export function getLastSeenUpdateVersion(): string | null {
  return localStorage.getItem(UPDATE_SEEN_STORAGE_KEY)
}

export function markUpdateSeen(version: string): void {
  localStorage.setItem(UPDATE_SEEN_STORAGE_KEY, version)
}

/** 拉取发布说明；任何失败（网络/非 200/结构异常）静默降级为空列表 */
export async function fetchReleaseNotes(): Promise<ReleaseNotesData> {
  try {
    const res = await fetch('/release-notes.json', { cache: 'no-cache' })
    if (!res.ok) return { releases: [] }
    const data = (await res.json()) as ReleaseNotesData
    if (!Array.isArray(data.releases)) return { releases: [] }
    return data
  } catch {
    return { releases: [] }
  }
}
