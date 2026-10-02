import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { VersionNotice } from '../version-notice'
import { useNoticeStore } from '@/stores/noticeStore'
import { fetchReleaseNotes, type ReleaseEntry } from '@/lib/app-version'

// 仅替换网络拉取，其余工具（比较/排序/localStorage）保持真实实现
vi.mock('@/lib/app-version', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/app-version')>()
  return { ...actual, fetchReleaseNotes: vi.fn() }
})

/** 故意乱序输入，用于验证组件内部按发布时间倒序排列 */
const RELEASES: ReleaseEntry[] = [
  {
    version: 'v2026.09.1',
    publishedAt: '2026-09-11',
    title: '九月优化',
    notes: [{ type: 'fix', text: '九月修复内容' }],
  },
  {
    version: 'v2026.10.3',
    publishedAt: '2026-10-02',
    title: '十月最新',
    notes: [{ type: 'feature', text: '十月新功能内容' }],
  },
  {
    version: 'v2026.08.1',
    publishedAt: '2026-08-07',
    title: '首版发布',
    notes: [{ type: 'feature', text: '首版功能内容' }],
  },
]

/** 当前部署版本 = 最新版本，且公告已读：避免自动弹窗，改由顶栏入口手动打开 */
function setupEnv() {
  const meta = document.createElement('meta')
  meta.name = 'app-version'
  meta.content = 'v2026.10.3'
  document.head.appendChild(meta)
  localStorage.setItem('app-version-read', 'v2026.10.3')
  localStorage.setItem('app-version-update-seen', 'v2026.10.3')
}

describe('VersionNotice 历史版本入口', () => {
  beforeEach(() => {
    localStorage.clear()
    document.querySelector('meta[name="app-version"]')?.remove()
    useNoticeStore.setState({ open: false, initialView: 'main' })
    vi.mocked(fetchReleaseNotes).mockResolvedValue({ releases: RELEASES })
    setupEnv()
  })

  afterEach(() => {
    document.querySelector('meta[name="app-version"]')?.remove()
  })

  it('主视图显著展示历史版本入口，并可打开倒序列表', async () => {
    useNoticeStore.getState().openNotice('main')
    render(<VersionNotice />)

    const entry = await screen.findByText('查看历史版本更新')
    expect(entry).toBeInTheDocument()
    expect(screen.getByText(`共 ${RELEASES.length} 个版本`)).toBeInTheDocument()

    fireEvent.click(entry)
    expect(await screen.findByText('历史版本更新')).toBeInTheDocument()

    // 列表按发布时间倒序（输入为乱序）
    const versionNodes = screen.getAllByText(/^v2026\./)
    expect(versionNodes.map((n) => n.textContent)).toEqual(['v2026.10.3', 'v2026.09.1', 'v2026.08.1'])
  })

  it('查看旧版本时展示完整公告内容并标注为历史版本', async () => {
    useNoticeStore.getState().openNotice('main')
    render(<VersionNotice />)

    fireEvent.click(await screen.findByText('查看历史版本更新'))
    fireEvent.click(await screen.findByText('v2026.08.1'))

    await waitFor(() => expect(screen.getByText('历史版本')).toBeInTheDocument())
    expect(screen.getByText(/当前查看的是历史版本 v2026\.08\.1/)).toBeInTheDocument()
    expect(screen.getByText('首版功能内容')).toBeInTheDocument()
  })

  it('查看列表中的最新版本时标注为最新版本', async () => {
    useNoticeStore.getState().openNotice('main')
    render(<VersionNotice />)

    fireEvent.click(await screen.findByText('查看历史版本更新'))
    fireEvent.click(await screen.findByText('v2026.10.3'))

    await waitFor(() => expect(screen.getByText('最新版本')).toBeInTheDocument())
    expect(screen.queryByText(/当前查看的是历史版本/)).not.toBeInTheDocument()
    expect(screen.getByText('十月新功能内容')).toBeInTheDocument()
  })
})