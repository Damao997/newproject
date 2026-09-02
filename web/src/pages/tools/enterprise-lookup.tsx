import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Search,
  Check,
  Copy,
  History,
  Building2,
  Shield,
  Clock,
  Loader2,
  SearchX,
  AlertTriangle,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { PageContainer } from '@/components/layout/page-container'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { api } from '@/lib/api'
import type { EnterpriseSearchResult, EnterpriseHistoryItem } from '@/lib/api'
import { cn } from '@/lib/utils'

/**
 * 企业信息查询：企业工商信息关键词搜索 + 本人查询历史。
 * 数据来自 api.toolsEnterpriseSearch / api.toolsEnterpriseHistory：
 * 仅渲染后端真实返回的档案字段（缺失显示 '-'），无股东/风险/关联等字段则不渲染对应区块。
 * 设计稿：antd-style-design/pages/enterprise-lookup.html（保留搜索 hero 与档案卡视觉壳）
 */

const HISTORY_PAGE_SIZE = 8

const PROVIDER_LABELS: Record<string, string> = {
  mock: 'Mock 数据源',
  tianyancha: '天眼查',
  qichacha: '企查查',
}

function providerLabel(provider: string) {
  return PROVIDER_LABELS[provider] ?? provider
}

function formatDateTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function EnterpriseLookup() {
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [submittedKeyword, setSubmittedKeyword] = useState('')
  const [historyPage, setHistoryPage] = useState(1)
  const [copied, setCopied] = useState(false)

  const searchQuery = useQuery({
    queryKey: ['tools', 'enterprise-search', submittedKeyword],
    queryFn: () => api.toolsEnterpriseSearch(submittedKeyword),
    enabled: submittedKeyword.trim().length > 0,
    staleTime: 30_000,
  })

  const historyQuery = useQuery({
    queryKey: ['tools', 'enterprise-history', historyPage],
    queryFn: () => api.toolsEnterpriseHistory({ page: historyPage, pageSize: HISTORY_PAGE_SIZE }),
  })

  // 每次搜索成功返回后刷新查询历史（服务端搜索即写入一条记录）
  useEffect(() => {
    if (searchQuery.dataUpdatedAt > 0) {
      void queryClient.invalidateQueries({ queryKey: ['tools', 'enterprise-history'] })
    }
  }, [searchQuery.dataUpdatedAt, queryClient])

  const result: EnterpriseSearchResult | null = searchQuery.data ?? null

  const submitSearch = (raw: string) => {
    const kw = raw.trim()
    if (!kw) return
    setSubmittedKeyword(kw)
  }

  const onHistoryClick = (item: EnterpriseHistoryItem) => {
    setKeyword(item.keyword)
    setSubmittedKeyword(item.keyword)
  }

  const onCopy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默忽略
    }
  }

  const historyData = historyQuery.data
  const historyTotal = historyData?.total ?? 0
  const totalPages = Math.max(Math.ceil(historyTotal / HISTORY_PAGE_SIZE), 1)
  const recentKeywords = [...new Set((historyData?.items ?? []).map((i) => i.keyword))].slice(0, 5)

  const infoFields: { label: string; value: string; mono?: boolean; wide?: boolean }[] = result
    ? [
        { label: '统一社会信用代码', value: result.creditCode || '-', mono: true },
        { label: '法定代表人', value: result.legalPerson ?? '-' },
        { label: '注册资本', value: result.registeredCapital ?? '-' },
        { label: '成立日期', value: result.establishDate ?? '-' },
        { label: '经营状态', value: result.status ?? '-' },
        { label: '企业类型', value: result.companyType ?? '-' },
        { label: '所属行业', value: result.industry ?? '-' },
        { label: '注册地址', value: result.registeredAddress ?? '-', wide: true },
        { label: '经营范围', value: result.businessScope ?? '-', wide: true },
      ]
    : []

  return (
    <PageContainer
      title="企业信息查询"
      description="企业工商信息一站式查询，辅助客户准入与风险决策"
    >
      {/* 搜索 hero：主题主色同色相渐变（随侧边栏风格切换）+ 输入 + 最近搜索（真实查询历史） */}
      <div className="relative overflow-hidden rounded-card bg-gradient-to-br from-primary to-[hsl(var(--primary)/0.72)] p-8 text-white shadow-antd-1">
        <span className="pointer-events-none absolute -right-16 -top-16 h-60 w-60 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }} aria-hidden />
        <h2 className="relative text-[22px] font-semibold leading-tight">查询企业工商信息</h2>
        <p className="relative mt-2 text-sm text-white/85">输入企业名称或统一社会信用代码，查询结果由数据源聚合并缓存</p>

        <form
          className="relative mt-5 flex items-center rounded-md bg-white p-1 shadow-[0_4px_16px_rgba(0,0,0,0.08)]"
          onSubmit={(e) => {
            e.preventDefault()
            submitSearch(keyword)
          }}
        >
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-9 flex-1 border-0 shadow-none focus-visible:ring-0"
            style={{ background: 'transparent' }}
            placeholder="企业名称 / 统一社会信用代码"
          />
          <Button type="submit" className="h-9 px-5" disabled={searchQuery.isFetching}>
            {searchQuery.isFetching ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-1.5 h-4 w-4" />
            )}
            查询
          </Button>
        </form>

        {recentKeywords.length > 0 && (
          <div className="relative mt-3.5 flex flex-wrap items-center text-[12px] text-white/75">
            <b className="mr-2 font-semibold text-white">最近搜索:</b>
            {recentKeywords.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => {
                  setKeyword(h)
                  submitSearch(h)
                }}
                className="mr-3.5 cursor-pointer text-white/85 hover:text-white"
              >
                {h}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 主区两列：左档案 / 右查询历史 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-4">
          {submittedKeyword === '' ? (
            <Card className="rounded-card p-0">
              <EmptyState
                icon={Search}
                title="输入关键词开始查询"
                description="支持企业名称或统一社会信用代码，查询结果展示工商档案与数据来源"
                className="py-24"
              />
            </Card>
          ) : searchQuery.isFetching && !searchQuery.data ? (
            <Card className="rounded-card p-0">
              <div className="flex min-h-[320px] flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">查询中…</span>
              </div>
            </Card>
          ) : searchQuery.isError ? (
            <Card className="rounded-card p-0">
              <EmptyState
                icon={AlertTriangle}
                title="查询失败"
                description={searchQuery.error instanceof Error ? searchQuery.error.message : '网络异常或数据源暂不可用，请稍后重试'}
                action={
                  <Button variant="outline" size="sm" onClick={() => void searchQuery.refetch()}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    重试
                  </Button>
                }
              />
            </Card>
          ) : !result ? (
            <Card className="rounded-card p-0">
              <EmptyState
                icon={SearchX}
                title="未找到匹配企业"
                description={`未查询到与「${submittedKeyword}」匹配的工商信息，可尝试完整企业名称或统一社会信用代码`}
                className="py-16"
              />
            </Card>
          ) : (
            <Card className="rounded-card p-0">
              <div className="flex items-start gap-5 border-b border-border-light p-5">
                <div className="flex h-[72px] w-[72px] flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[hsl(var(--primary)/0.72)] text-2xl font-bold text-white shadow-antd-1">
                  {result.name.charAt(0)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="text-xl font-semibold text-foreground">{result.name}</span>
                    {result.status && <Badge variant="default">{result.status}</Badge>}
                  </div>
                  <div className="text-[13px] leading-relaxed text-muted-foreground">
                    <b className="font-medium text-foreground">法定代表人:</b> {result.legalPerson ?? '-'} &nbsp;·&nbsp; <b className="font-medium text-foreground">成立日期:</b> {result.establishDate ?? '-'} &nbsp;·&nbsp; <b className="font-medium text-foreground">注册资本:</b> {result.registeredCapital ?? '-'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-3.5 p-5 sm:grid-cols-2">
                {infoFields.map((f) => (
                  <div key={f.label} className={cn('flex items-start gap-2 text-[13px] leading-relaxed', f.wide && 'sm:col-span-2')}>
                    <div className="w-[100px] flex-shrink-0 text-muted-foreground">{f.label}</div>
                    <div className={cn('flex-1 text-foreground', f.mono && 'flex items-center gap-1.5 font-mono')}>
                      {f.value}
                      {f.mono && f.value !== '-' && (
                        <button
                          type="button"
                          onClick={() => onCopy(f.value)}
                          className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-primary"
                          title="复制信用代码"
                        >
                          {copied ? <Check className="h-3 w-3 text-success-500" /> : <Copy className="h-3 w-3" />}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        {/* 右列：查询历史（真实分页） */}
        <Card className="rounded-card p-0">
          <div className="flex items-center justify-between border-b border-border-light px-5 py-4">
            <h3 className="text-base font-semibold tracking-tight">
              查询历史
              {historyTotal > 0 && (
                <span className="ml-1.5 text-[13px] font-normal text-muted-foreground">{historyTotal} 条</span>
              )}
            </h3>
            {historyQuery.isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          {historyQuery.isLoading ? (
            <div className="flex min-h-[200px] items-center justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : historyQuery.isError ? (
            <EmptyState
              compact
              icon={AlertTriangle}
              title="历史加载失败"
              description={historyQuery.error instanceof Error ? historyQuery.error.message : undefined}
              className="py-10"
              action={
                <Button variant="outline" size="sm" onClick={() => void historyQuery.refetch()}>
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                  重试
                </Button>
              }
            />
          ) : !historyData || historyData.items.length === 0 ? (
            <EmptyState
              compact
              icon={History}
              title="暂无查询历史"
              description="发起查询后将在此展示本人最近查询记录"
              className="py-10"
            />
          ) : (
            <>
              <div className="flex flex-col gap-1.5 p-3">
                {historyData.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onHistoryClick(item)}
                    className="w-full cursor-pointer rounded-md border border-border-light px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-brand-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-foreground">{item.keyword}</span>
                      {item.fromCache && <Badge variant="info">缓存</Badge>}
                    </div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {item.matchedName ?? '未匹配到企业'} · {formatDateTime(item.createdAt)}
                    </div>
                  </button>
                ))}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border-light px-5 py-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={historyPage <= 1 || historyQuery.isFetching}
                    onClick={() => setHistoryPage((p) => Math.max(p - 1, 1))}
                  >
                    <ChevronLeft className="mr-1 h-3.5 w-3.5" />
                    上一页
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    第 {historyPage} / {totalPages} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={historyPage >= totalPages || historyQuery.isFetching}
                    onClick={() => setHistoryPage((p) => Math.min(p + 1, totalPages))}
                  >
                    下一页
                    <ChevronRight className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      {/* 底部数据来源（仅查询到结果时展示真实元信息） */}
      {result && (
        <Card className="rounded-card p-0">
          <div className="flex flex-wrap items-center gap-4 px-5 py-3.5 text-[13px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Building2 className="h-3.5 w-3.5" />
              {result.name}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-success-500" />
              数据来源：{providerLabel(result.provider)}
              {result.fromCache ? ' · 缓存命中' : ''}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              获取时间：{formatDateTime(result.fetchedAt)}
            </span>
          </div>
        </Card>
      )}
    </PageContainer>
  )
}

export default EnterpriseLookup
