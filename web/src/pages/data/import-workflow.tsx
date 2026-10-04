import { useNavigate, useSearchParams } from 'react-router-dom'
import { WorkflowPage } from '@/components/forms/workflow'
import { RequirePermission } from '@/components/layout/require-permission'
import { TransactionImportDialog } from './transaction-import-dialog'
import { ImportPanel } from './import-panel'

export default function ImportWorkflow() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const back = () => navigate('/data/import')
  return <RequirePermission resource="data:import" action="upload"><WorkflowPage onBack={back}>
    {params.get('kind') === 'transaction'
      ? <TransactionImportDialog open onOpenChange={(open) => { if (!open) back() }} />
      : <ImportPanel workflow />}
  </WorkflowPage></RequirePermission>
}
