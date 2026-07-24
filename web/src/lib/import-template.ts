import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type TemplateType = 'operating' | 'static' | 'budget'

/**
 * 生成并下载标准导入模板（宽表版式，与后端 unpivot 解析对齐）。
 *
 * 布局：
 *  - operating：行1=公司名（A列留空），行2=月份日期，行3+=科目值。
 *    列按 (公司 × 月份) 排列，最新月为本月实际、上一月为同期实际。
 *  - static   ：行1=公司名，行2=快照月份，行3+=科目值。
 *  - budget   ：行1=公司名，行2+=科目年度预算值（无月份行）。
 */
export async function downloadImportTemplate(type: TemplateType): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('导入模板')

  if (type === 'budget') {
    sheet.addRow(['科目名称', '示例公司A', '示例公司B'])
    sheet.addRow(['营业收入', 12000, 8000])
    sheet.addRow(['营业成本', 7000, 5000])
    sheet.getRow(1).font = { bold: true }
  } else {
    // operating / static：公司名行 + 月份行 + 科目行
    sheet.addRow(['科目名称', '示例公司A', '示例公司A', '示例公司B', '示例公司B'])
    sheet.addRow(['', '2025-06', '2025-05', '2025-06', '2025-05'])
    if (type === 'operating') {
      sheet.addRow(['营业收入', 1200, 1100, 900, 850])
      sheet.addRow(['营业成本', 700, 660, 520, 500])
    } else {
      sheet.addRow(['应收账款', 3200, 3000, 2100, 2000])
      sheet.addRow(['存货', 1800, 1700, 1200, 1150])
    }
    sheet.getRow(1).font = { bold: true }
    sheet.getRow(2).font = { bold: true }
  }

  sheet.columns.forEach((col) => { col.width = 16 })

  const buffer = await workbook.xlsx.writeBuffer()
  const nameMap: Record<TemplateType, string> = { operating: '经营数据', static: '静态数据', budget: '年度预算' }
  saveAs(new Blob([buffer], { type: XLSX_MIME }), `导入模板_${nameMap[type]}.xlsx`)
}
