import ExcelJS from 'exceljs'
import { saveAs } from 'file-saver'

export interface ExportColumn {
  /** 表头文本 */
  header: string
  /** 对应行数据的字段名 */
  key: string
  /** 列宽（字符数） */
  width?: number
}

interface ExportOptions {
  /** 下载文件名（含 .xlsx 后缀） */
  filename: string
  /** 工作表名称 */
  sheetName?: string
  columns: ExportColumn[]
  rows: Record<string, unknown>[]
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/**
 * 客户端 Excel 导出。
 *
 * 使用 ExcelJS 生成工作簿并通过 file-saver 触发浏览器下载，
 * 供各页面「导出 Excel」按钮统一调用（导出内容为当前筛选结果）。
 */
export async function exportToExcel({
  filename,
  sheetName = 'Sheet1',
  columns,
  rows,
}: ExportOptions): Promise<void> {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet(sheetName)

  sheet.columns = columns.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width ?? 16,
  }))

  rows.forEach((row) => sheet.addRow(row))

  // 表头加粗
  sheet.getRow(1).font = { bold: true }

  const buffer = await workbook.xlsx.writeBuffer()
  saveAs(new Blob([buffer], { type: XLSX_MIME }), filename)
}
