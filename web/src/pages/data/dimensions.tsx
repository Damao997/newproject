import { useParams } from 'react-router-dom'
import { PageContainer } from '@/components/layout/page-container'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { SubjectTreePanel } from '@/components/subject-tree/subject-tree-panel'
import { CompanyPanel } from '@/components/dimension/company-panel'
import { AggregationMapPanel } from '@/components/dimension/aggregation-map-panel'

// 「维度/科目体系」三级子标签（与路由路径段对应）
const DIM_SUB_TABS = ['operating', 'static', 'company', 'summary'] as const
type DimSubTab = (typeof DIM_SUB_TABS)[number]

/**
 * 数据管理 · 维度/科目体系：经营分析科目 / 静态科目 / 公司 / 汇总主体。
 * 三级子页由路由路径段驱动（/data/dimensions/operating 等），非法段回退经营分析科目。
 */
export default function DataDimensionsPage() {
  const { can } = usePermission()
  const { headerRef, headerHeight } = useStickyHeader()
  const { sub } = useParams<{ sub: string }>()
  const dimSubTab: DimSubTab = DIM_SUB_TABS.includes(sub as DimSubTab) ? (sub as DimSubTab) : 'operating'

  const canExport = can('data', 'export')
  const canConvertMetric = can('data:metric', 'convert')

  // 页头标题随三级子页变化（面包屑承担完整路径指示，页内不再重复层级标题）
  const pageTitle = { operating: '经营分析科目', static: '静态科目', company: '公司', summary: '汇总主体' }[dimSubTab]

  return (
    <PageContainer title={pageTitle} stickyHeader headerRef={headerRef}>
      {dimSubTab === 'operating' && (
        <SubjectTreePanel
          type="operating"
          stickyTop={headerHeight}
          canCreate={can('data:subject', 'create')}
          canUpdate={can('data:subject', 'update')}
          canDelete={can('data:subject', 'delete')}
          canConvert={canConvertMetric}
          canExport={canExport}
          exportFileName="经营分析科目"
          exportSheet="经营分析科目"
          countSuffix="（level0-level4）"
        />
      )}
      {dimSubTab === 'static' && (
        <SubjectTreePanel
          type="static"
          stickyTop={headerHeight}
          canCreate={can('data:subject', 'create')}
          canUpdate={can('data:subject', 'update')}
          canDelete={can('data:subject', 'delete')}
          canConvert={canConvertMetric}
          canExport={canExport}
          exportFileName="静态科目"
          exportSheet="静态科目"
          countSuffix="（level0-level1）"
        />
      )}
      {dimSubTab === 'company' && (
        <CompanyPanel
          stickyTop={headerHeight}
          canCreate={can('data:company', 'create')}
          canUpdate={can('data:company', 'update')}
          canDelete={can('data:company', 'delete')}
        />
      )}
      {dimSubTab === 'summary' && (
        <AggregationMapPanel canUpdate={can('data:company', 'update')} />
      )}
    </PageContainer>
  )
}
