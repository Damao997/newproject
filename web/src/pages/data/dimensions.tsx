import { useParams } from 'react-router-dom'
import { PageContainer } from '@/components/layout/page-container'
import { SubPageTabs } from '@/components/layout/sub-page-tabs'
import { DIMENSION_TABS } from '@/components/layout/module-tabs'
import { useStickyHeader } from '@/hooks/useStickyHeader'
import { usePermission } from '@/hooks/usePermission'
import { SubjectTreePanel } from '@/components/subject-tree/subject-tree-panel'
import { CompanyPanel } from '@/components/dimension/company-panel'
import { AggregationMapPanel } from '@/components/dimension/aggregation-map-panel'
import { FormulaMaintenance } from '@/pages/data/formula-maintenance'

const SUBJECT_TABS = ['operating', 'static', 'cashflow'] as const
type SubjectTab = (typeof SUBJECT_TABS)[number]
type DimSubTab = SubjectTab | 'company' | 'summary' | 'formulas'

const VALID_SUBS: readonly DimSubTab[] = [...SUBJECT_TABS, 'company', 'summary', 'formulas']

const SUBJECT_EXPORT_META: Record<SubjectTab, { fileName: string; sheet: string }> = {
  operating: { fileName: '经营科目层级', sheet: '经营科目层级' },
  static: { fileName: '静态科目层级', sheet: '静态科目层级' },
  cashflow: { fileName: '现金流量科目层级', sheet: '现金流量科目层级' },
}

/**
 * 数据管理 · 维度/科目体系：按 :sub 路由到真实数据面板（Tab 导航复用 SubPageTabs + DIMENSION_TABS）。
 * - operating/static/cashflow → SubjectTreePanel（科目树 CRUD/挂接重分类/类型转换，按 subjectType 区分）；
 * - company → CompanyPanel（主体 CRUD）；summary → AggregationMapPanel（汇总主体成员映射）；
 * - formulas → FormulaMaintenance（公式维护：试算/版本回滚/依赖分析/审批）。
 * 权限：科目树 CRUD 走 data:subject:*；主体 data:company:*；公式 data:metric:*；
 * 彻底删除/类型转换等高危操作仅 superadmin（role === 'superadmin'）。
 */
export default function DataDimensionsPage() {
  const { sub } = useParams<{ sub: string }>()
  const { can, role } = usePermission()
  const { headerRef, headerHeight } = useStickyHeader()

  const dimSubTab = (VALID_SUBS as readonly string[]).includes(sub ?? '')
    ? (sub as DimSubTab)
    : 'operating'

  const isSubjectTab = (SUBJECT_TABS as readonly string[]).includes(dimSubTab)
  const subjectTab = dimSubTab as SubjectTab

  return (
    <PageContainer
      title="维度/科目体系"
      description="维护经营/静态/现金流量科目、主体、汇总主体映射与指标公式"
      stickyHeader
      headerRef={headerRef}
    >
      <SubPageTabs items={DIMENSION_TABS} />

      {isSubjectTab && (
        <SubjectTreePanel
          type={subjectTab}
          stickyTop={headerHeight}
          canCreate={can('data:subject', 'create')}
          canUpdate={can('data:subject', 'update')}
          canDelete={can('data:subject', 'delete')}
          canConvert={role === 'superadmin'}
          canExport={can('data', 'export')}
          exportFileName={SUBJECT_EXPORT_META[subjectTab].fileName}
          exportSheet={SUBJECT_EXPORT_META[subjectTab].sheet}
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

      {dimSubTab === 'summary' && <AggregationMapPanel canUpdate={can('data:company', 'update')} />}

      {dimSubTab === 'formulas' && (
        <FormulaMaintenance
          canCreate={can('data:metric', 'create')}
          canUpdate={can('data:metric', 'update')}
          canDelete={can('data:metric', 'delete')}
          canApprove={can('data:metric', 'approve')}
          canPurge={role === 'superadmin'}
          canConvert={role === 'superadmin'}
        />
      )}
    </PageContainer>
  )
}
