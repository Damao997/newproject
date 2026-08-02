import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type EnterpriseSearchResult } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { Search, Copy, Check, History, Building2, AlertCircle, ExternalLink } from 'lucide-react'

/**
 * 企业工商查询：按名称或统一社会信用代码查询合作企业的注册信息与经营状态。
 * 后端带 7 天缓存，命中缓存时展示"缓存数据"标识；右侧展示本人最近查询。
 */

/** 外部权威平台核实链接（免费网页查询） */
function externalLookupLinks(keyword: string) {
  return [
    { label: '爱企查核实', url: `https://aiqicha.baidu.com/s?q=${encodeURIComponent(keyword)}` },
    { label: '国家公示系统核实', url: 'https://www.gsxt.gov.cn/' },
  ]
}

/** 外链按钮组：跳转外部平台人工核实工商信息 */
function ExternalVerifyLinks({ keyword }: { keyword: string }) {
  if (!keyword.trim()) return null
  return (
    <div className="flex flex-wrap items-center gap-2">
      {externalLookupLinks(keyword.trim()).map((link) => (
        <Button key={link.label} variant="outline" size="sm" asChild>
          <a href={link.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            {link.label}
          </a>
        </Button>
      ))}
    </div>
  )
}

/** 经营状态 → Badge 样式（在业/存续=绿，注销/吊销=红，其余灰） */
function statusVariant(status: string | null): 'success' | 'destructive' | 'secondary' {
  if (!status) return 'secondary'
  if (status.includes('在业') || status.includes('存续') || status.includes('开业')) return 'success'
  if (status.includes('注销') || status.includes('吊销') || status.includes('停业')) return 'destructive'
  return 'secondary'
}

function InfoField({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="space-y-0.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-sm text-foreground', mono && 'font-mono')}>{value || '—'}</div>
    </div>
  )
}

export function EnterpriseLookup() {
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<EnterpriseSearchResult | null>(null)
  const [searched, setSearched] = useState(false)
  const [copied, setCopied] = useState(false)
  const [scopeExpanded, setScopeExpanded] = useState(false)

  const searchMutation = useMutation({
    mutationFn: (kw: string) => api.toolsEnterpriseSearch(kw),
    onSuccess: (data) => {
      setResult(data)
      setSearched(true)
      setScopeExpanded(false)
      queryClient.invalidateQueries({ queryKey: ['tools', 'enterprise-history'] })
    },
  })

  const { data: history } = useQuery({
    queryKey: ['tools', 'enterprise-history'],
    queryFn: () => api.toolsEnterpriseHistory({ page: 1, pageSize: 10 }),
    staleTime: 0,
  })

  const doSearch = (kw: string) => {
    const trimmed = kw.trim()
    if (!trimmed || searchMutation.isPending) return
    setKeyword(trimmed)
    searchMutation.mutate(trimmed)
  }

  const copyCreditCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默忽略
    }
  }

  return (
    <div className="grid animate-fade-in gap-4 lg:grid-cols-3">
      {/* 左侧：搜索 + 结果 */}
      <div className="space-y-4 lg:col-span-2">
        <Card>
          <CardContent className="pt-6">
            <div className="flex gap-2">
              <Input
                placeholder="输入企业名称或统一社会信用代码"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') doSearch(keyword) }}
                maxLength={100}
              />
              <Button onClick={() => doSearch(keyword)} disabled={!keyword.trim() || searchMutation.isPending}>
                <Search className="mr-1.5 h-4 w-4" />
                {searchMutation.isPending ? '查询中...' : '查询'}
              </Button>
            </div>
            {searchMutation.isError && (
              <p className="mt-2 flex items-center text-sm text-destructive">
                <AlertCircle className="mr-1 h-4 w-4" />
                {(searchMutation.error as Error).message || '查询失败，请稍后重试'}
              </p>
            )}
          </CardContent>
        </Card>

        {searchMutation.isPending && (
          <Card>
            <CardContent className="space-y-3 pt-6">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </CardContent>
          </Card>
        )}

        {!searchMutation.isPending && searched && !result && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12 text-center">
              <Building2 className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">未查询到相关企业，请检查名称或信用代码是否正确</p>
              <div className="mt-4">
                <ExternalVerifyLinks keyword={keyword} />
              </div>
            </CardContent>
          </Card>
        )}

        {!searchMutation.isPending && result && (
          <Card className="animate-fade-in">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-lg">{result.name}</CardTitle>
                <Badge variant={statusVariant(result.status)}>{result.status || '状态未知'}</Badge>
                {result.fromCache && <Badge variant="outline">缓存数据</Badge>}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div className="space-y-0.5 sm:col-span-2">
                  <div className="text-xs text-muted-foreground">统一社会信用代码</div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-sm">{result.creditCode}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => copyCreditCode(result.creditCode)}
                      title="复制信用代码"
                    >
                      {copied ? <Check className="h-3.5 w-3.5 text-success-strong" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </div>
                <InfoField label="法定代表人" value={result.legalPerson} />
                <InfoField label="注册资本" value={result.registeredCapital} />
                <InfoField label="成立日期" value={result.establishDate} />
                <InfoField label="企业类型" value={result.companyType} />
                <InfoField label="所属行业" value={result.industry} />
                <InfoField label="注册地址" value={result.registeredAddress} />
              </div>

              {result.businessScope && (
                <div className="space-y-0.5">
                  <div className="text-xs text-muted-foreground">经营范围</div>
                  <p className={cn('text-sm text-foreground', !scopeExpanded && 'line-clamp-2')}>
                    {result.businessScope}
                  </p>
                  {result.businessScope.length > 60 && (
                    <button
                      className="text-xs text-primary hover:underline"
                      onClick={() => setScopeExpanded((v) => !v)}
                    >
                      {scopeExpanded ? '收起' : '展开全部'}
                    </button>
                  )}
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  数据来源：{result.provider === 'mock' ? '模拟数据源（演示用，非真实工商数据）' : result.provider}
                  ・获取时间：{new Date(result.fetchedAt).toLocaleString('zh-CN')}
                </p>
                <ExternalVerifyLinks keyword={result.name} />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* 右侧：最近查询 */}
      <Card className="h-fit">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center text-base">
            <History className="mr-1.5 h-4 w-4 text-muted-foreground" />
            最近查询
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(history?.items ?? []).length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">暂无查询记录</p>
          ) : (
            <ul className="space-y-1">
              {history?.items.map((item) => (
                <li key={item.id}>
                  <button
                    className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted"
                    onClick={() => doSearch(item.keyword)}
                    title="点击重新查询"
                  >
                    <div className="truncate text-sm text-foreground">{item.matchedName ?? item.keyword}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(item.createdAt).toLocaleString('zh-CN')}
                      {item.matchedName === null && ' ・未命中'}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
