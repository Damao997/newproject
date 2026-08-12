import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PageContainer } from '@/components/layout/page-container'
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table'
import { Pagination } from '@/components/data-table/pagination'
import { useRoles, useAuditLogs, type RoleItem } from '@/hooks/api-queries'
import { AUDIT_MODULE_LABELS, AUDIT_ACTION_LABELS } from '@/lib/constants'
import { Search } from 'lucide-react'
import type { AuditLog } from '@/types'

const AUDIT_PAGE_SIZE = 20

/** 审计日志：查看系统操作日志、用户行为记录与安全审计信息（按角色/模块/时间/用户检索）。 */
export default function AuditLogsPage() {
  const [auditPage, setAuditPage] = useState(1)
  // 审计日志筛选：角色/模块/用户关键字/时间范围（任一变化重置到第一页）
  const [auditRole, setAuditRole] = useState('all')
  const [auditModule, setAuditModule] = useState('all')
  const [auditUsername, setAuditUsername] = useState('')
  const [auditStart, setAuditStart] = useState('')
  const [auditEnd, setAuditEnd] = useState('')

  const { data: rolesData } = useRoles()
  const { data: auditData } = useAuditLogs({
    page: auditPage,
    pageSize: AUDIT_PAGE_SIZE,
    role: auditRole === 'all' ? undefined : auditRole,
    module: auditModule === 'all' ? undefined : auditModule,
    username: auditUsername.trim() || undefined,
    startDate: auditStart || undefined,
    endDate: auditEnd || undefined,
  })

  const roles = (rolesData ?? []) as RoleItem[]
  const auditLogs = (auditData?.items ?? []) as AuditLog[]
  const auditTotal = auditData?.total ?? 0

  const auditColumns: DataTableColumn<AuditLog>[] = [
    {
      key: 'createdAt', header: '时间', cellClassName: 'text-muted-foreground whitespace-nowrap',
      render: (log) => new Date(log.createdAt).toLocaleString('zh-CN'),
    },
    { key: 'username', header: '用户', cellClassName: 'font-medium' },
    { key: 'module', header: '模块', render: (log) => AUDIT_MODULE_LABELS[log.module] ?? log.module },
    { key: 'action', header: '操作', render: (log) => AUDIT_ACTION_LABELS[log.action] ?? log.action },
    { key: 'detail', header: '详情', cellClassName: 'text-muted-foreground' },
  ]

  return (
    <PageContainer title="审计日志" description="查看系统操作日志、用户行为记录与安全审计信息">
      {/* 控制层：筛选工具条（筛选卡） */}
      <Card className="rounded-card p-4">
      <div className="flex flex-col space-y-2 lg:flex-row lg:items-center lg:space-x-2 lg:space-y-0">
            <Select value={auditRole} onValueChange={(v) => { setAuditRole(v); setAuditPage(1) }}>
              <SelectTrigger className="w-full lg:w-[160px]">
                <SelectValue placeholder="选择角色" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部角色</SelectItem>
                {roles.map((role) => (
                  <SelectItem key={role.code} value={role.code}>{role.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={auditModule} onValueChange={(v) => { setAuditModule(v); setAuditPage(1) }}>
              <SelectTrigger className="w-full lg:w-[160px]">
                <SelectValue placeholder="选择模块" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部模块</SelectItem>
                {Object.entries(AUDIT_MODULE_LABELS).map(([code, label]) => (
                  <SelectItem key={code} value={code}>{label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center space-x-2">
              <Input
                type="date"
                value={auditStart}
                onChange={(e) => { setAuditStart(e.target.value); setAuditPage(1) }}
                className="w-full lg:w-[150px]"
              />
              <span className="text-muted-foreground">至</span>
              <Input
                type="date"
                value={auditEnd}
                onChange={(e) => { setAuditEnd(e.target.value); setAuditPage(1) }}
                className="w-full lg:w-[150px]"
              />
            </div>

            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="搜索操作用户名..."
                value={auditUsername}
                onChange={(e) => { setAuditUsername(e.target.value); setAuditPage(1) }}
                className="pl-8"
              />
            </div>
          </div>
      </Card>

          {/* 展示层：审计日志表格（表格卡） */}
          <Card className="overflow-hidden rounded-card">
          <div className="pt-2">
            <DataTable columns={auditColumns} data={auditLogs} rowKey={(log) => log.id} emptyText="暂无审计日志" />
            <div className="border-t px-4 py-2.5">
              <Pagination page={auditPage} pageSize={AUDIT_PAGE_SIZE} total={auditTotal} onPageChange={setAuditPage} />
            </div>
          </div>
          </Card>
    </PageContainer>
  )
}
