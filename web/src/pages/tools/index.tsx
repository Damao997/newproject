import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { PageContainer } from '@/components/layout/page-container'
import { Building2 } from 'lucide-react'
import { EnterpriseLookup } from './enterprise-lookup'

/**
 * 其他工具页：以 Tab 组织的财务日常小工具集合。
 * 本期：企业工商查询；后续工具在 TabsList/TabsContent 中追加。
 */
export default function ToolsPage() {
  const [activeTab, setActiveTab] = useState('enterprise')

  return (
    <PageContainer title="其他工具" description="财务日常实用小工具集合">
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="enterprise">
            <Building2 className="mr-1.5 h-4 w-4" />
            企业工商查询
          </TabsTrigger>
        </TabsList>
        <TabsContent value="enterprise">
          <EnterpriseLookup />
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
