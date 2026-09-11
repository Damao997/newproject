import { api } from '@/lib/api'

type TemplateType = 'operating' | 'static' | 'cashflow' | 'budget'

const TEMPLATE_NAME_MAP: Record<TemplateType, string> = {
  operating: '经营数据',
  static: '静态数据',
  cashflow: '现金流量数据',
  budget: '年度预算',
}

/**
 * 下载导入模板（后端生成，与导入解析转置宽表格式对齐）。
 *
 * 模板内容由后端按科目体系自动生成：
 *  - 科目行 = 全部数据类（data）指标，按树前序排列并随层级缩进；
 *  - operating/static：行1=公司名，行2=月份，行3+=科目行（最新两期）；
 *  - budget：行1=公司名，行2+=科目年度预算行（无月份行）。
 */
export async function downloadImportTemplate(type: TemplateType): Promise<void> {
  const { saveAs } = await import('file-saver')
  const blob = await api.downloadImportTemplate(type)
  saveAs(blob, `导入模板_${TEMPLATE_NAME_MAP[type]}.xlsx`)
}
