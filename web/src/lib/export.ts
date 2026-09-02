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
 * 统一 Blob 下载：把 api 层返回的文件流（xlsx 等）触发浏览器保存。
 * 动态 import file-saver，保持与 exportToExcel 相同的低频加载策略。
 */
export async function downloadBlob(blob: Blob, filename: string): Promise<void> {
  const { saveAs } = await import('file-saver')
  saveAs(blob, filename)
}

/**
 * 客户端 Excel 导出。
 *
 * 使用 ExcelJS 生成工作簿并通过 file-saver 触发浏览器下载，
 * 供各页面「导出 Excel」按钮统一调用（导出内容为当前筛选结果）。
 *
 * ExcelJS（~900KB）与 file-saver 在函数内动态 import：
 * 导出是低频交互，不应让所有引用本模块的页面在首屏就付出该体积代价。
 */
export async function exportToExcel({
  filename,
  sheetName = 'Sheet1',
  columns,
  rows,
}: ExportOptions): Promise<void> {
  const [{ default: ExcelJS }, { saveAs }] = await Promise.all([
    import('exceljs'),
    import('file-saver'),
  ])

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
