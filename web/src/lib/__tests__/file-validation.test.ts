import { describe, it, expect } from 'vitest'
import { validateExcelFile, MAX_UPLOAD_SIZE } from '@/lib/file-validation'

function makeFile(name: string, size: number): File {
  const file = new File(['x'], name, { type: 'application/octet-stream' })
  // File.size 只读，通过 defineProperty 覆盖以模拟不同大小
  Object.defineProperty(file, 'size', { value: size })
  return file
}

describe('validateExcelFile', () => {
  it('接受 .xlsx 文件', () => {
    expect(validateExcelFile(makeFile('data.xlsx', 1024)).valid).toBe(true)
  })

  it('接受 .xls 文件（大小写不敏感）', () => {
    expect(validateExcelFile(makeFile('DATA.XLS', 1024)).valid).toBe(true)
  })

  it('拒绝非 Excel 扩展名', () => {
    const result = validateExcelFile(makeFile('malware.exe', 1024))
    expect(result.valid).toBe(false)
    expect(result.message).toContain('.xlsx')
  })

  it('拒绝超过 200MB 的文件', () => {
    const result = validateExcelFile(makeFile('big.xlsx', MAX_UPLOAD_SIZE + 1))
    expect(result.valid).toBe(false)
    expect(result.message).toContain('200MB')
  })

  it('接受恰好 200MB 的文件', () => {
    expect(validateExcelFile(makeFile('edge.xlsx', MAX_UPLOAD_SIZE)).valid).toBe(true)
  })
})
