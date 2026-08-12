import { PageContainer } from '@/components/layout/page-container'
import { usePermission } from '@/hooks/usePermission'
import { FormulaMaintenance } from './formula-maintenance'

/**
 * 数据管理 · 公式维护：计算公式列表、公式编辑、试算、AI 生成、
 * 历史版本、审批（superadmin）、依赖图与类型转换。
 */
export default function DataFormulasPage() {
  const { can } = usePermission()

  return (
    <PageContainer title="公式维护">
      <FormulaMaintenance
        canCreate={can('data:metric', 'create')}
        canUpdate={can('data:metric', 'update')}
        canDelete={can('data:metric', 'delete')}
        canApprove={can('data:metric', 'approve')}
        canPurge={can('data:metric', 'purge')}
        canConvert={can('data:metric', 'convert')}
      />
    </PageContainer>
  )
}
