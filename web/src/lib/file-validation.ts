/** 允许的 Excel 扩展名，对齐《安全与权限规范》§十 */
export const ALLOWED_EXCEL_EXTENSIONS = ['.xlsx', '.xls'] as const

/** 最大文件大小 200MB，对齐《安全与权限规范》§十（ERP 大账龄报表可达 100MB+） */
export const MAX_UPLOAD_SIZE = 200 * 1024 * 1024

export interface FileValidationResult {
  valid: boolean
  message?: string
}

/**
 * 上传前的前端第一道校验。
 *
 * 校验扩展名（.xlsx / .xls）与大小（≤ 50MB）。
 * 注意：这是前端第一道校验，真实的 MIME magic number 校验在后端完成。
 */
export function validateExcelFile(file: File): FileValidationResult {
  const lowerName = file.name.toLowerCase()
  const extMatched = ALLOWED_EXCEL_EXTENSIONS.some((ext) => lowerName.endsWith(ext))
  if (!extMatched) {
    return { valid: false, message: '仅支持 .xlsx / .xls 文件' }
  }

  if (file.size > MAX_UPLOAD_SIZE) {
    return { valid: false, message: '文件大小超过 200MB 限制' }
  }

  return { valid: true }
}
