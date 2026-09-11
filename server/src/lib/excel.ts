import ExcelJS from 'exceljs'

/**
 * 通用 Excel 导出：根据列定义与数据行生成 xlsx Buffer（见 backend 规范导出要求）。
 */
export interface ExcelColumn {
  header: string
  key: string
  width?: number
}

export async function buildExcel(
  sheetName: string,
  columns: ExcelColumn[],
  rows: Record<string, unknown>[],
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'yipinhui-finance'
  wb.created = new Date()
  const ws = wb.addWorksheet(sheetName)
  ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 16 }))
  ws.getRow(1).font = { bold: true }
  for (const row of rows) {
    ws.addRow(row)
  }
  const arrayBuffer = await wb.xlsx.writeBuffer()
  return Buffer.from(arrayBuffer)
}
