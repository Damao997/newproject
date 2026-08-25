import { useParams } from 'react-router-dom'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { DIMENSION_TABS } from '@/components/layout/module-tabs'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { SubjectTreePanel } from '@/components/subject-tree/subject-tree-panel'
import { CompanyPanel } from '@/components/dimension/company-panel'
import { AggregationMapPanel } from '@/components/dimension/aggregation-map-panel'
import { FormulaMaintenance } from './formula-maintenance'

// 「维度/科目体系」三级子标签（与路由路径段对应）
const DIM_SUB_TABS = ['operating', 'static', 'cashflow', 'company', 'summary', 'formulas'] as const
type DimSubTab = (typeof DIM_SUB_TABS)[number]

/**
 * 数据管理 · 维度/科目体系：经营分析科目 / 静态科目 / 公司 / 汇总主体 / 公式维护。
 * 三级子页由路由路径段驱动（/data/dimensions/operating 等），非法段回退经营分析科目。
 */
export default function DataDimensionsPage() {
  const { can } = usePermission()
  const { headerRef, headerHeight } = useStickyHeader()
  const { sub } = useParams<{ sub: string }>()
  const dimSubTab: DimSubTab = DIM_SUB_TABS.includes(sub as DimSubTab) ? (sub as DimSubTab) : 'operating'

  const canExport = can('data', 'export')
  const canConvertMetric = can('data:metric', 'convert')

  // 页头标题固定为模块名（Tab 承担分类切换指示，面包屑承担完整路径指示）
  const pageTitle = '维度/科目体系'

  return (
    <PageContainer title={pageTitle} stickyHeader headerRef={headerRef}>
      {/* 页内 Tab：经营分析科目（默认）/ 静态科目 / 主体管理 / 汇总主体映射 / 公式维护 */}
      <SubPageTabs items={DIMENSION_TABS} />
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
        />
      )}
      {dimSubTab === 'cashflow' && (
        <SubjectTreePanel
          type="cashflow"
          stickyTop={headerHeight}
          canCreate={can('data:subject', 'create')}
          canUpdate={can('data:subject', 'update')}
          canDelete={can('data:subject', 'delete')}
          canConvert={canConvertMetric}
          canExport={canExport}
          exportFileName="现金流量科目"
          exportSheet="现金流量科目"
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
      {dimSubTab === 'formulas' && (
        <FormulaMaintenance
          canCreate={can('data:metric', 'create')}
          canUpdate={can('data:metric', 'update')}
          canDelete={can('data:metric', 'delete')}
          canApprove={can('data:metric', 'approve')}
          canPurge={can('data:metric', 'purge')}
          canConvert={canConvertMetric}
        />
      )}
    </PageContainer>
  )
}
