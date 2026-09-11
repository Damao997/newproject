import { useMemo, useState } from 'react'
import { message } from 'antd'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Pill } from '@/components/ui/pill'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { PageContainer } from '@/components/layout/page-container'
import { Pagination } from '@/components/data-table/pagination'
import { useRoles, useAuditLogs, useAuditTodayStats, type RoleItem } from '@/hooks/api-queries'
import {
  AUDIT_MODULE_LABELS,
  AUDIT_ACTION_LABELS,
  AUDIT_RESOURCE_LABELS,
  AUDIT_PERM_ACTION_LABELS,
  AUDIT_ENTITY_LABELS,
  AUDIT_TEMPLATE_LABELS,
  AUDIT_DETAIL_KEY_LABELS,
} from '@/lib/constants'
import { exportToExcel } from '@/lib/export'
import { api } from '@/lib/api'
import { Search, Download, Settings2, RefreshCw, Filter, FileText, Info, Loader2 } from 'lucide-react'
import type { AuditLog } from '@/types'

const AUDIT_PAGE_SIZE = 20

/** 导出条数上限（超过提示缩小范围；pageSize 上限 1000，循环拉取） */
const EXPORT_MAX_ROWS = 5000

type AuditCategory = 'login' | 'data' | 'perm' | 'sys' | 'other'

/** module → 四大类映射：auth→登录、data→数据、admin+permission→权限、ai→系统，未收录归入「其他」 */
function moduleToCategory(module: string): AuditCategory {
  if (module === 'auth') return 'login'
  if (module === 'data') return 'data'
  if (module === 'admin' || module === 'permission') return 'perm'
  if (module === 'ai') return 'sys'
  return 'other'
}

const CATEGORY_LABELS: Record<AuditCategory, string> = {
  login: '登录',
  data: '数据',
  perm: '权限',
  sys: '系统',
  other: '其他',
}

const CATEGORY_TONES: Record<AuditCategory, 'green' | 'blue' | 'orange' | 'gray'> = {
  login: 'green',
  data: 'blue',
  perm: 'orange',
  sys: 'gray',
  other: 'gray',
}

const CATEGORY_DOT: Record<AuditCategory, string> = {
  login: 'border-[color:var(--state-success)] [&::after]:bg-[color:var(--state-success)]',
  data: 'border-[color:var(--color-primary)] [&::after]:bg-[color:var(--color-primary)]',
  perm: 'border-orange-500 [&::after]:bg-orange-500',
  sys: 'border-[color:var(--state-warning)] [&::after]:bg-[color:var(--state-warning)]',
  other: 'border-[color:var(--muted-foreground)] [&::after]:bg-[color:var(--muted-foreground)]',
}

/** 状态类值中文（detail 内 active/inactive 翻译） */
const STATUS_LABELS: Record<string, string> = { active: '启用', inactive: '停用' }

/** 用户头像按用户名取模分配底色（确定性，同一用户颜色稳定）：token 色阶类（禁硬编码 hex） */
const AVATAR_PALETTE = [
  'bg-blue-1 text-blue-9',
  'bg-success-50 text-success-strong',
  'bg-[hsl(var(--chart-11)/0.12)] text-chart-11',
  'bg-orange-50 text-orange-700',
] as const

function avatarClass(username: string): string {
  let sum = 0
  for (let i = 0; i < username.length; i++) sum += username.charCodeAt(i)
  return AVATAR_PALETTE[sum % AVATAR_PALETTE.length]
}

/** 轻量 UA 解析：浏览器 + 操作系统；解析失败回退原始 UA 截断 */
function parseUserAgent(ua: string | null | undefined): string {
  if (!ua) return '—'
  const browsers: Array<[RegExp, string]> = [
    [/Edg\/([\d.]+)/, 'Edge'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/Version\/([\d.]+).*Safari/, 'Safari'],
  ]
  const systems: Array<[RegExp, string]> = [
    [/Windows NT 10\.0/, 'Windows 10+'],
    [/Windows/, 'Windows'],
    [/Mac OS X/, 'macOS'],
    [/Android/, 'Android'],
    [/iPhone|iPad|iOS/, 'iOS'],
    [/Linux/, 'Linux'],
  ]
  const browser = browsers.find(([re]) => re.test(ua))
  const system = systems.find(([re]) => re.test(ua))
  if (!browser && !system) return ua.length > 60 ? `${ua.slice(0, 60)}…` : ua
  const version = browser ? (browser[0].exec(ua)?.[1]?.split('.')[0] ?? '') : ''
  const browserLabel = browser ? `${browser[1]} ${version}`.trim() : ''
  const systemLabel = system ? system[1] : ''
  return [browserLabel, systemLabel].filter(Boolean).join(' · ') || '—'
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false })
}

/** detail 值转中文摘要：对象按键中文展开，状态/单位类值翻译，超长截断 */
function fmtValue(v: unknown): string {
  if (v == null || v === '') return '—'
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${AUDIT_DETAIL_KEY_LABELS[k] ?? k}: ${fmtValue(val)}`,
    )
    return entries.join('，')
  }
  const s = String(v)
  if (STATUS_LABELS[s]) return STATUS_LABELS[s]
  if (s === 'wan') return '万元'
  return s.length > 80 ? `${s.slice(0, 80)}…` : s
}

/** 资源/编码数组 → 中文顿号串 */
function joinLabels(codes: unknown, map?: Record<string, string>): string {
  const arr = Array.isArray(codes) ? codes : []
  if (arr.length === 0) return '—'
  return arr.map((c) => map?.[String(c)] ?? String(c)).join('、')
}

/** 角色 code → 中文名（角色已删除时回退显示 code） */
function roleName(code: unknown, roleMap: Map<string, string>): string {
  const c = String(code ?? '')
  return roleMap.get(c) ?? c
}

/** 时间线 detail 截断长度 */
const TIMELINE_DETAIL_MAX = 60

/**
 * detail 中文化：JSON 安全解析后按 module+action 分支生成中文可读句子；
 * 未识别结构回退为「中文键: 值」拼接，解析失败回退原文。
 */
function formatAuditDetail(log: Pick<AuditLog, 'module' | 'action' | 'detail'>, roleMap: Map<string, string>): string {
  if (!log.detail) return '—'
  let d: Record<string, unknown>
  try {
    d = JSON.parse(log.detail) as Record<string, unknown>
  } catch {
    return log.detail
  }
  const act = typeof d.action === 'string' ? d.action : ''

  // 权限变更（单角色 / 批量）
  if (log.module === 'admin' && log.action === 'permission_change') {
    if (act === 'batch') {
      const names = joinLabels(d.roles, undefined)
      return `批量设置 ${String(d.roleCount ?? '—')} 个角色（${names}）的权限，各角色权限项 ${String(d.after ?? '—')} 项`
    }
    const parts: string[] = [`角色「${roleName(d.role, roleMap)}」：权限 ${String(d.before ?? '—')} 项 → ${String(d.after ?? '—')} 项`]
    if (Array.isArray(d.added) && d.added.length > 0) parts.push(`新增 ${joinLabels(d.added, AUDIT_RESOURCE_LABELS)}`)
    if (Array.isArray(d.removed) && d.removed.length > 0) parts.push(`移除 ${joinLabels(d.removed, AUDIT_RESOURCE_LABELS)}`)
    return parts.join('；')
  }

  // 角色增删改克隆
  if (log.module === 'admin' && log.action === 'role_change') {
    const map: Record<string, string> = {
      create: '新建角色',
      update: '更新角色',
      delete: '删除角色',
      clone: `克隆角色（源：${roleName(d.from, roleMap)}）`,
    }
    return map[act] ?? `角色维护 · ${act || '—'}`
  }

  // 彻底删除用户
  if (log.module === 'admin' && log.action === 'user_purge') {
    return `彻底删除用户「${String(d.username ?? '—')}」（角色：${roleName(d.role, roleMap)}）`
  }

  // 重置密码
  if (log.module === 'admin' && log.action === 'update' && act === 'reset_password') {
    return '重置登录密码'
  }

  // 越权拦截
  if (log.module === 'permission' && log.action === 'denied') {
    if (Array.isArray(d.anyOf)) {
      const list = (d.anyOf as string[]).map((s) => {
        const [res, a] = s.split(':')
        return `${AUDIT_RESOURCE_LABELS[res] ?? res} · ${AUDIT_PERM_ACTION_LABELS[a] ?? a}`
      }).join(' / ')
      return `访问所需权限（${list}）不足，操作被拒绝`
    }
    const res = String(d.resource ?? '')
    const a = String(d.action ?? '')
    return `访问「${AUDIT_RESOURCE_LABELS[res] ?? res} · ${AUDIT_PERM_ACTION_LABELS[a] ?? a}」权限不足，操作被拒绝`
  }

  // 数据导入（数据管理 / 往来）
  if (log.action === 'import' && (log.module === 'data' || log.module === 'transactions')) {
    const tpl = d.templateType ? (AUDIT_TEMPLATE_LABELS[String(d.templateType)] ?? String(d.templateType)) : ''
    const unit = d.valueUnit === 'wan' ? '（单位：万元）' : ''
    const rowCount = String(d.rowCount ?? d.detailCount ?? '—')
    const errPart = d.errorCount != null ? `、错误 ${String(d.errorCount)} 条` : ''
    return `导入${tpl ? `「${tpl}」` : ''}数据：${rowCount} 行${errPart}${unit}`
  }

  // 指标公式维护
  if (log.module === 'data' && log.action === 'metric_change') {
    const actMap: Record<string, string> = {
      create: '新增公式',
      update: '更新公式',
      delete: '删除公式',
      restore: '恢复指标',
      convert: '转换指标类型',
      purge: '彻底删除指标',
      rollback: `回滚公式至版本 ${String(d.toVersion ?? '—')}`,
      approve: `审批通过（版本 ${String(d.version ?? '—')}）`,
      reject: '驳回公式变更',
    }
    const base = actMap[act] ?? `公式操作 · ${act || '—'}`
    if (d.before != null || d.after != null) return `${base}：${fmtValue(d.before)} → ${fmtValue(d.after)}`
    return base
  }

  // 数据管理实体维护（公司/科目/映射等）
  if (log.module === 'data' && typeof d.entity === 'string') {
    const entity = AUDIT_ENTITY_LABELS[d.entity] ?? d.entity
    if (d.before != null || d.after != null) {
      return `更新「${entity}」：${fmtValue(d.before)} → ${fmtValue(d.after)}`
    }
    if (act === 'add') return `汇总主体映射：加入单体公司 ${String(d.single ?? '—')}`
    if (act === 'remove') return `汇总主体映射：移除单体公司 ${String(d.single ?? '—')}`
    return `维护「${entity}」配置`
  }

  // 往来模块状态流转
  if (log.module === 'transactions' && act) {
    const map: Record<string, string> = {
      account_status: `往来账户状态 → ${STATUS_LABELS[String(d.status ?? '')] ?? String(d.status ?? '—')}`,
      'set-salesman-status': `业务员状态 → ${STATUS_LABELS[String(d.status ?? '')] ?? String(d.status ?? '—')}`,
      'create-salesman': '新建业务员',
      'update-salesman': `更新业务员${Array.isArray(d.fields) ? `（${(d.fields as string[]).map((f) => AUDIT_DETAIL_KEY_LABELS[f] ?? f).join('、')}）` : ''}`,
      'create-collection': '生成催收计划',
      'update-collection': `更新催收计划${d.statusTo ? `（状态 → ${String(d.statusTo)}）` : ''}`,
      'add-collection-log': '添加催收记录',
    }
    if (map[act]) return map[act]
  }

  // 回退：键值对中文展示
  const entries = Object.entries(d).map(([k, v]) => `${AUDIT_DETAIL_KEY_LABELS[k] ?? k}: ${Array.isArray(v) ? joinLabels(v) : fmtValue(v)}`)
  return entries.join('；') || log.detail
}

/** 筛选条件表单值（draft 编辑 / applied 生效） */
const EMPTY_FILTERS = { role: 'all', module: 'all', action: 'all', username: '', startDate: '', endDate: '', q: '' }
type AuditFilters = typeof EMPTY_FILTERS

/** 审计日志：时间线视图（真实数据）+ 详情抽屉 + 高级搜索 + Excel 导出。 */
export default function AuditLogsPage() {
  const [auditPage, setAuditPage] = useState(1)
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_FILTERS)
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_FILTERS)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data: rolesData } = useRoles()
  const { data: auditData, isLoading: auditLoading } = useAuditLogs({
    page: auditPage,
    pageSize: AUDIT_PAGE_SIZE,
    role: applied.role === 'all' ? undefined : applied.role,
    module: applied.module === 'all' ? undefined : applied.module,
    action: applied.action === 'all' ? undefined : applied.action,
    username: applied.username.trim() || undefined,
    startDate: applied.startDate || undefined,
    endDate: applied.endDate || undefined,
    q: applied.q.trim() || undefined,
  })
  const { data: todayStats } = useAuditTodayStats()

  const roles = (rolesData ?? []) as RoleItem[]
  const auditLogs = (auditData?.items ?? []) as AuditLog[]
  const auditTotal = auditData?.total ?? 0

  /** 角色 code → 中文名映射（detail 中文化用） */
  const roleMap = useMemo(() => new Map(roles.map((r) => [r.code, r.name])), [roles])

  /** 今日分类计数：byModule 经四大类映射汇总 */
  const todayCounts = useMemo(() => {
    const acc: Record<AuditCategory, number> = { login: 0, data: 0, perm: 0, sys: 0, other: 0 }
    Object.entries(todayStats?.byModule ?? {}).forEach(([m, n]) => {
      acc[moduleToCategory(m)] += n
    })
    return acc
  }, [todayStats])

  const selected = auditLogs.find((l) => l.id === selectedId) ?? null

  const patchDraft = (patch: Partial<AuditFilters>) => setDraft((d) => ({ ...d, ...patch }))

  /** 查询：提交 draft 生效并回到第 1 页 */
  function applyQuery() {
    setApplied(draft)
    setAuditPage(1)
  }

  /** 重置：清空 draft + applied 回默认 */
  function resetFilters() {
    setDraft(EMPTY_FILTERS)
    setApplied(EMPTY_FILTERS)
    setAuditPage(1)
  }

  /** 导出日志：按当前筛选循环拉取（上限 5000 条），ExcelJS 生成 xlsx 下载 */
  async function handleExport() {
    if (auditTotal > EXPORT_MAX_ROWS) {
      message.warning(`审计结果共 ${auditTotal} 条，超过导出上限 ${EXPORT_MAX_ROWS} 条，请缩小筛选范围`)
      return
    }
    setExporting(true)
    try {
      const exportParams = {
        role: applied.role === 'all' ? undefined : applied.role,
        module: applied.module === 'all' ? undefined : applied.module,
        action: applied.action === 'all' ? undefined : applied.action,
        username: applied.username.trim() || undefined,
        startDate: applied.startDate || undefined,
        endDate: applied.endDate || undefined,
        q: applied.q.trim() || undefined,
      }
      const rows: AuditLog[] = []
      let total = auditTotal
      for (let page = 1; rows.length < Math.min(total, EXPORT_MAX_ROWS); page++) {
        const res = await api.getAuditLogs({ ...exportParams, page, pageSize: 1000 })
        total = res.total
        const items = (res.items ?? []) as AuditLog[]
        rows.push(...items)
        if (items.length < 1000) break
      }
      await exportToExcel({
        filename: `审计日志_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}.xlsx`,
        sheetName: '审计日志',
        columns: [
          { header: '时间', key: 'time', width: 20 },
          { header: '用户', key: 'username', width: 14 },
          { header: '模块', key: 'module', width: 12 },
          { header: '操作', key: 'action', width: 14 },
          { header: '详情', key: 'detail', width: 60 },
          { header: 'IP 地址', key: 'ip', width: 16 },
          { header: '操作对象', key: 'targetId', width: 24 },
        ],
        rows: rows.map((log) => ({
          time: formatDateTime(log.createdAt),
          username: log.username,
          module: AUDIT_MODULE_LABELS[log.module] ?? log.module,
          action: AUDIT_ACTION_LABELS[log.action] ?? log.action,
          detail: formatAuditDetail(log, roleMap),
          ip: log.ip ?? '',
          targetId: log.targetId ?? '',
        })),
      })
      message.success(`已导出 ${rows.length} 条审计记录`)
    } catch (err) {
      console.error('审计日志导出失败', err)
      message.error('导出失败，请稍后重试')
    } finally {
      setExporting(false)
    }
  }

  return (
    <PageContainer
      title="审计日志"
      description="记录用户登录、数据操作、权限变更、系统事件等行为"
      actions={
        <>
          <Button variant="outline" size="sm" disabled={exporting} onClick={handleExport}>
            {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1.5 h-3.5 w-3.5" />}
            导出日志
          </Button>
          <Button size="sm" onClick={() => setAdvancedOpen(true)}>
            <Settings2 className="mr-1.5 h-3.5 w-3.5" />
            高级搜索
          </Button>
        </>
      }
    >
      {/* 筛选行：角色 / 模块 / 用户 / 类型 / 时间（编辑 draft，「查询」提交生效） */}
      <Card className="rounded-card p-0">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <span className="text-[13px] text-muted-foreground">角色</span>
          <Select value={draft.role} onValueChange={(v) => patchDraft({ role: v })}>
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue placeholder="全部角色" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部角色</SelectItem>
              {roles.map((role) => (
                <SelectItem key={role.code} value={role.code}>{role.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-[13px] text-muted-foreground">模块</span>
          <Select value={draft.module} onValueChange={(v) => patchDraft({ module: v })}>
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue placeholder="全部模块" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模块</SelectItem>
              {Object.entries(AUDIT_MODULE_LABELS).map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-[13px] text-muted-foreground">用户</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={draft.username}
              onChange={(e) => patchDraft({ username: e.target.value })}
              placeholder="按姓名/工号搜索"
              className="h-8 w-[180px] pl-7"
            />
          </div>

          <span className="text-[13px] text-muted-foreground">类型</span>
          <Select value={draft.action} onValueChange={(v) => patchDraft({ action: v })}>
            <SelectTrigger className="h-8 w-[140px]">
              <SelectValue placeholder="全部类型" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              {Object.entries(AUDIT_ACTION_LABELS).map(([code, label]) => (
                <SelectItem key={code} value={code}>{label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <span className="text-[13px] text-muted-foreground">时间</span>
          <DateRangePicker
            startDate={draft.startDate}
            endDate={draft.endDate}
            onChange={(r) => patchDraft(r)}
            startPlaceholder="开始日期"
            endPlaceholder="结束日期"
          />

          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={resetFilters}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              重置
            </Button>
            <Button size="sm" onClick={applyQuery}>
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              查询
            </Button>
          </div>
        </div>
      </Card>

      {/* 时间线 + 详情抽屉 */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <Card className="rounded-card p-0">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-light px-5 py-4">
            <div>
              <h3 className="text-[15px] font-semibold tracking-tight">时间线流 · 今日 {todayStats?.total ?? 0} 条 / 共 {auditTotal} 条</h3>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['login', 'data', 'perm', 'sys', 'other'] as const).map((cat) => (
                <Pill key={cat} tone={CATEGORY_TONES[cat]}>{CATEGORY_LABELS[cat]} {todayCounts[cat]}</Pill>
              ))}
            </div>
          </div>

          <div className="px-5 py-5">
            {auditLoading ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">加载中…</p>
            ) : auditLogs.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">暂无审计记录，请调整筛选条件</p>
            ) : (
              <div className="relative pl-12">
                <div className="absolute bottom-2 left-[18px] top-2 w-[2px] bg-border" aria-hidden />
                {auditLogs.map((log) => {
                  const category = moduleToCategory(log.module)
                  const isActive = log.id === selectedId
                  return (
                    <div
                      key={log.id}
                      className={[
                        'relative cursor-pointer pb-[18px] last:pb-0',
                        isActive ? 'opacity-100' : 'opacity-95 hover:opacity-100',
                      ].join(' ')}
                      onClick={() => setSelectedId(log.id)}
                    >
                      <span
                        className={[
                          'absolute left-[-30px] top-[3px] flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-border bg-card',
                          'after:block after:h-[10px] after:w-[10px] after:rounded-full after:bg-muted-foreground after:content-[""]',
                          CATEGORY_DOT[category],
                        ].join(' ')}
                        aria-hidden
                      />
                      <div className="mb-1.5 flex flex-wrap items-center gap-2.5">
                        <span className="text-[14px] font-semibold text-foreground">{AUDIT_ACTION_LABELS[log.action] ?? log.action}</span>
                        <Pill tone={CATEGORY_TONES[category]}>{CATEGORY_LABELS[category]}</Pill>
                        <span className="ml-auto font-num text-xs tabular-nums text-muted-foreground">{formatTime(log.createdAt)}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted-foreground">
                        <span className="min-w-0">
                          {(() => {
                            const text = formatAuditDetail(log, roleMap)
                            return text.length > TIMELINE_DETAIL_MAX ? `${text.slice(0, TIMELINE_DETAIL_MAX)}…` : text
                          })()}
                        </span>
                        <span
                          className={[
                            'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-medium',
                            avatarClass(log.username),
                          ].join(' ')}
                        >
                          {log.username.charAt(0).toUpperCase()}
                        </span>
                        <span className="font-medium text-foreground">{log.username}</span>
                        <span className="ml-auto">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={(e) => { e.stopPropagation(); setSelectedId(log.id) }}
                          >
                            详情
                          </Button>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="border-t px-4 py-2.5">
            <Pagination page={auditPage} pageSize={AUDIT_PAGE_SIZE} total={auditTotal} onPageChange={setAuditPage} />
          </div>
        </Card>

        {/* 详情抽屉 */}
        <div className="space-y-4 lg:sticky lg:top-[76px] lg:self-start">
          <Card className="rounded-card p-5 shadow-antd-1">
            <div className="mb-1 flex items-center gap-2 text-[15px] font-semibold">
              <FileText className="h-[18px] w-[18px] text-muted-foreground" />
              审计详情
            </div>
            <p className="mb-4 text-xs text-muted-foreground">点击左侧时间线条目展开详情</p>

            {!selected ? (
              <p className="py-8 text-center text-[13px] text-muted-foreground">未选中任何记录</p>
            ) : (
              <>
                <div className="mb-4">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-foreground">{AUDIT_ACTION_LABELS[selected.action] ?? selected.action}</span>
                    <Pill tone={CATEGORY_TONES[moduleToCategory(selected.module)]}>{CATEGORY_LABELS[moduleToCategory(selected.module)]}</Pill>
                  </div>
                  <div className="font-num text-xs tabular-nums text-muted-foreground">
                    {formatDateTime(selected.createdAt)}
                  </div>
                </div>

                <div className="mb-4">
                  <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">操作信息</h4>
                  <div className="space-y-1 text-[13px]">
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted-foreground">操作人</span>
                      <span className="font-mono text-foreground">{selected.username}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted-foreground">IP 地址</span>
                      <span className="font-mono text-foreground">{selected.ip || '—'}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted-foreground">设备</span>
                      <span className="font-mono text-foreground">{parseUserAgent(selected.userAgent)}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted-foreground">所属模块</span>
                      <span className="font-mono text-foreground">{AUDIT_MODULE_LABELS[selected.module] ?? selected.module}</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="w-20 shrink-0 text-muted-foreground">动作类型</span>
                      <span className="font-mono text-foreground">{AUDIT_ACTION_LABELS[selected.action] ?? selected.action}</span>
                    </div>
                    {selected.targetId && (
                      <div className="flex gap-2">
                        <span className="w-20 shrink-0 text-muted-foreground">操作对象</span>
                        <span className="break-all font-mono text-foreground">{selected.targetId}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-muted-foreground">变更内容</h4>
                  <div className="break-all rounded-md border border-border-light bg-muted/40 px-3 py-2 font-mono text-[12px] leading-relaxed text-foreground">
                    {formatAuditDetail(selected, roleMap)}
                  </div>
                </div>
              </>
            )}
          </Card>

          <Card className="rounded-card p-5">
            <div className="mb-2 flex items-center gap-2 text-[14px] font-semibold">
              <Info className="h-4 w-4 text-blue-6" />
              提示
            </div>
            <p className="text-[13px] leading-6 text-muted-foreground">
              从时间线中选择一条审计记录以查看详细操作：
            </p>
            <ul className="ml-4 mt-3 space-y-1.5 text-[13px] leading-[1.9] text-muted-foreground">
              <li>用户身份 / IP / 设备信息</li>
              <li>操作模块 / 动作类型</li>
              <li>操作对象与变更内容（中文摘要）</li>
            </ul>
          </Card>
        </div>
      </div>

      {/* 高级搜索弹窗：全条件表单 + 关键词（匹配操作对象与详情） */}
      <Dialog open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>高级搜索</DialogTitle>
            <DialogDescription>组合条件精确检索审计记录；关键词可模糊匹配操作对象与详情内容</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[13px]">用户</Label>
              <Input value={draft.username} onChange={(e) => patchDraft({ username: e.target.value })} placeholder="按姓名/工号搜索" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">角色</Label>
              <Select value={draft.role} onValueChange={(v) => patchDraft({ role: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部角色" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部角色</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.code} value={role.code}>{role.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">模块</Label>
              <Select value={draft.module} onValueChange={(v) => patchDraft({ module: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部模块" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部模块</SelectItem>
                  {Object.entries(AUDIT_MODULE_LABELS).map(([code, label]) => (
                    <SelectItem key={code} value={code}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[13px]">类型</Label>
              <Select value={draft.action} onValueChange={(v) => patchDraft({ action: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="全部类型" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部类型</SelectItem>
                  {Object.entries(AUDIT_ACTION_LABELS).map(([code, label]) => (
                    <SelectItem key={code} value={code}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">时间范围</Label>
              <DateRangePicker
                startDate={draft.startDate}
                endDate={draft.endDate}
                onChange={(r) => patchDraft(r)}
                className="w-full [&_.ant-picker]:flex-1"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-[13px]">关键词</Label>
              <Input
                value={draft.q}
                onChange={(e) => patchDraft({ q: e.target.value })}
                placeholder="模糊匹配操作对象 ID 与详情内容"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft({ ...EMPTY_FILTERS })}>清空条件</Button>
            <Button onClick={() => { setAdvancedOpen(false); applyQuery() }}>开始搜索</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
