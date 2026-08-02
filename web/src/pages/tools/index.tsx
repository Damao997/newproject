import { PageContainer } from '@/components/layout/page-container'
import { EnterpriseLookup } from './enterprise-lookup'

/**
 * 其他工具页：财务日常小工具集合。
 * 本期：企业工商查询；后续工具在本组件中追加。
 */
export default function ToolsPage() {
  return (
    <PageContainer title="其他工具" description="财务日常实用小工具集合">
      <EnterpriseLookup />
    </PageContainer>
  )
}
