import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { WorkflowPage } from '@/components/forms/workflow'
import { RequirePermission } from '@/components/layout/require-permission'
import { ReclassifyCompanyDialog } from '@/components/reclassify/reclassify-company-dialog'
import { ReclassifySubjectDialog } from '@/components/reclassify/reclassify-subject-dialog'
import { BudgetAdjustDialog } from '@/components/reclassify/budget-adjust-dialog'
import { ConsolidationAdjustDialog } from '@/components/reclassify/consolidation-adjust-dialog'
import { companyPresetOf, adjustPresetOf, subjectPresetOf } from './reclassify'
import { api } from '@/lib/api'
import { FormError } from '@/components/forms/form'

/** 按日志标识读取已授权的原始记录；地址中不携带金额或调整原因。 */
export default function ReclassifyWorkflow() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const kind = params.get('kind') ?? 'subject'
  const logId = params.get('log') ?? ''
  const log = useQuery({
    queryKey: ['data', 'reclassify-workflow-log', logId], enabled: !!logId,
    queryFn: async ({ signal }) => {
      let page = 1
      while (!signal.aborted) {
        const data = await api.getReclassifyLogs({ page, pageSize: 100 })
        const found = data.items.find((item) => item.id === logId)
        if (found) return found
        if (page * 100 >= data.total || data.items.length === 0) throw new Error('找不到原调整记录，请返回列表重新选择')
        page += 1
      }
      throw new Error('读取已取消')
    },
  })
  const back = () => navigate('/data/reclassify')
  if (!['company', 'subject', 'budget'].includes(kind)) return <WorkflowPage onBack={back}><FormError message="调整类型无效，请返回列表选择" /></WorkflowPage>
  const incompatibleLog = !!log.data && (kind === 'company' ? log.data.type !== 'company' || log.data.templateType === 'budget' : log.data.type !== 'subject_adjust' || (kind === 'budget') !== (log.data.templateType === 'budget'))
  return <RequirePermission resource="data:reclassify" action={kind === 'company' ? 'company' : 'subject'}>
    <WorkflowPage onBack={back}>
      {logId && log.isLoading ? <p role="status" className="p-6 text-muted-foreground">正在读取原调整记录…</p>
        : log.isError ? <FormError message={log.error.message} />
          : incompatibleLog ? <FormError message="原记录与当前调整类型不一致，请返回列表重新选择" />
          : kind === 'company' ? <ReclassifyCompanyDialog key={logId} open onClose={back} reapplyLogId={logId || undefined} preset={log.data ? companyPresetOf(log.data) : undefined} />
            : kind === 'budget' ? <BudgetAdjustDialog key={logId} open onClose={back} reapplyLogId={logId || undefined} preset={log.data ? adjustPresetOf(log.data) : undefined} />
              : <ReclassifySubjectDialog key={logId} open onClose={back} reapplyLogId={logId || undefined} preset={log.data ? subjectPresetOf(log.data) : undefined} />
      }
    </WorkflowPage>
  </RequirePermission>
}

export function ConsolidationWorkflow() {
  const navigate = useNavigate()
  const back = () => navigate('/data/reclassify/consolidation')
  return <RequirePermission resource="data:reclassify" action="company"><WorkflowPage onBack={back}><ConsolidationAdjustDialog open onClose={back} /></WorkflowPage></RequirePermission>
}
