import { createHash } from 'node:crypto'
import * as XLSX from 'xlsx'
import { prisma } from '../lib/prisma'
import { errors } from '../lib/errors'
import { recordAudit } from '../middleware/audit'
import { parseImportWorkbook, type ImportTemplate, type Resolvers } from '../lib/excel-import'

/**
 * 数据导入服务：文件校验（MIME magic + 大小由 multer 保证）、解析计数、
 * 批次留痕与生命周期（draft→active，激活自动归档同类旧 active）。
 *
 * 说明：宽表→长表 unpivot 依赖 mapping_scheme.column_map 配置，作为后续增量；
 * 本期导入完成「真实文件解析 + 批次登记 + 生命周期管理」，不做占位/伪造。
 */

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]) // PK.. (zip/xlsx)
const XLS_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) // 老式 xls 复合文档

type TemplateType = 'operating' | 'static' | 'budget' | 'transaction' | 'inventory'

const UNPIVOT_TEMPLATES = new Set<TemplateType>(['operating', 'static', 'budget'])

async function buildResolvers(template: ImportTemplate, fiscalYear: string): Promise<Resolvers> {
  const companies = await prisma.company.findMany({ select: { code: true, name: true } })
  const subjectType = template === 'static' ? 'static' : 'operating'
  const subjects = await prisma.accountSubject.findMany({ where: { subjectType }, select: { code: true, name: true } })
  return {
    companyByName: new Map(companies.map((c) => [c.name.trim(), c.code])),
    subjectByName: new Map(subjects.map((s) => [s.name.trim(), s.code])),
    defaultFiscalYear: fiscalYear,
  }
}

function assertExcelMagic(buf: Buffer): void {
  const head = buf.subarray(0, 4)
  if (!head.equals(XLSX_MAGIC) && !head.equals(XLS_MAGIC)) {
    throw errors.badRequest('文件格式非法：仅支持 .xlsx/.xls')
  }
}

export interface ImportErrorItem {
  row: number
  column: string
  message: string
}

export interface ImportBatchDto {
  id: string
  filename: string
  templateType: string
  status: string
  rowCount: number
  successCount: number
  errorCount: number
  createdBy: string | null
  createdAt: string
  activatedAt?: string
  /** 解析错误明细（仅详情接口返回；列表接口为空数组以控制体积） */
  errors?: ImportErrorItem[]
}

function toDto(b: {
  id: string; fileName: string; dataType: string; lifecycleStatus: string; status: string
  rowCount: number; errorCount: number; uploadedById: string | null; createdAt: Date; updatedAt: Date
  errorsJson?: unknown
}, includeErrors = false): ImportBatchDto {
  const dto: ImportBatchDto = {
    id: b.id,
    filename: b.fileName,
    templateType: b.dataType,
    status: b.lifecycleStatus,
    rowCount: b.rowCount,
    successCount: Math.max(b.rowCount - b.errorCount, 0),
    errorCount: b.errorCount,
    createdBy: b.uploadedById,
    createdAt: b.createdAt.toISOString(),
    activatedAt: b.lifecycleStatus === 'active' ? b.updatedAt.toISOString() : undefined,
  }
  if (includeErrors) {
    dto.errors = Array.isArray(b.errorsJson) ? (b.errorsJson as ImportErrorItem[]) : []
  }
  return dto
}

export const ImportService = {
  /**
   * 导入预览（dry-run）：仅解析不建批次、不写库，返回将入库行数/各类计数/错误明细。
   */
  async preview(file: { buffer: Buffer }, templateType: TemplateType, fiscalYear = 'FY2025'): Promise<{ dataRowCount: number; errorCount: number; operatingCount: number; staticCount: number; budgetCount: number; errors: ImportErrorItem[] }> {
    assertExcelMagic(file.buffer)
    if (!UNPIVOT_TEMPLATES.has(templateType)) {
      // 非 unpivot 模板（transaction/inventory）：仅统计数据行数
      let rowCount = 0
      try {
        const wb = XLSX.read(file.buffer, { type: 'buffer' })
        const first = wb.SheetNames[0]
        const gridRows = first ? (XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, blankrows: false }) as unknown[][]) : []
        rowCount = Math.max(gridRows.length - 1, 0)
      } catch {
        throw errors.badRequest('Excel 解析失败，请检查文件内容与模板类型')
      }
      return { dataRowCount: rowCount, errorCount: 0, operatingCount: 0, staticCount: 0, budgetCount: 0, errors: [] }
    }
    const template = templateType as ImportTemplate
    let parsed
    try {
      const resolvers = await buildResolvers(template, fiscalYear)
      parsed = parseImportWorkbook(file.buffer, template, resolvers)
    } catch {
      throw errors.badRequest('Excel 解析失败，请检查文件内容与模板类型')
    }
    return {
      dataRowCount: parsed.dataRowCount,
      errorCount: parsed.errors.length,
      operatingCount: parsed.operating.length,
      staticCount: parsed.static.length,
      budgetCount: parsed.budget.length,
      errors: parsed.errors.slice(0, 200),
    }
  },

  async upload(file: { originalname: string; buffer: Buffer; size: number }, templateType: TemplateType, userId: string, traceId?: string, fiscalYear = 'FY2025'): Promise<ImportBatchDto> {
    assertExcelMagic(file.buffer)

    // 文件去重：同 hash 且 active 的批次
    const fileHash = createHash('sha256').update(file.buffer).digest('hex')
    const dup = await prisma.importBatch.findFirst({ where: { fileHash, lifecycleStatus: 'active' }, select: { id: true } })
    if (dup) {
      throw errors.conflict('该文件已导入并处于生效状态，请勿重复导入')
    }

    // 先建批次（草稿/处理中）
    const batch = await prisma.importBatch.create({
      data: {
        fileName: file.originalname,
        uploadedById: userId,
        status: 'processing',
        dataType: templateType,
        lifecycleStatus: 'draft',
        fileHash,
        sourceType: 'upload',
        fiscalYear,
      },
    })

    let rowCount = 0
    let errorCount = 0
    let insertedCount = 0
    let errorList: { row: number; column: string; message: string }[] = []

    try {
      if (UNPIVOT_TEMPLATES.has(templateType)) {
        // 宽表 → 长表 unpivot
        const template = templateType as ImportTemplate
        const resolvers = await buildResolvers(template, fiscalYear)
        const parsed = parseImportWorkbook(file.buffer, template, resolvers)
        rowCount = parsed.dataRowCount
        errorList = parsed.errors
        errorCount = parsed.errors.length

        if (parsed.operating.length > 0) {
          const res = await prisma.factOperating.createMany({ data: parsed.operating.map((r) => ({ ...r, batchId: batch.id })), skipDuplicates: true })
          insertedCount += res.count
        }
        if (parsed.static.length > 0) {
          const res = await prisma.factStatic.createMany({ data: parsed.static.map((r) => ({ ...r, batchId: batch.id })), skipDuplicates: true })
          insertedCount += res.count
        }
        if (parsed.budget.length > 0) {
          const res = await prisma.factBudget.createMany({ data: parsed.budget.map((r) => ({ ...r, batchId: batch.id })), skipDuplicates: true })
          insertedCount += res.count
        }
      } else {
        // transaction/inventory 暂仅登记：统计数据行数
        const wb = XLSX.read(file.buffer, { type: 'buffer' })
        const first = wb.SheetNames[0]
        const gridRows = first ? (XLSX.utils.sheet_to_json(wb.Sheets[first], { header: 1, blankrows: false }) as unknown[][]) : []
        rowCount = Math.max(gridRows.length - 1, 0)
      }
    } catch {
      await prisma.importBatch.update({ where: { id: batch.id }, data: { status: 'failed' } })
      throw errors.badRequest('Excel 解析失败，请检查文件内容与模板类型')
    }

    // 结算批次状态：有错且无有效数据→failed；有错但部分入库→partial；无错→success
    const finalStatus = errorCount > 0 ? (insertedCount > 0 ? 'partial' : 'failed') : 'success'
    const updated = await prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        status: finalStatus,
        rowCount,
        errorCount,
        errorsJson: (errorList.slice(0, 200) as never) ?? undefined,
      },
    })
    await recordAudit({ userId, module: 'data', action: 'import', targetId: batch.id, detail: { templateType, rowCount, errorCount, insertedCount } }, traceId)
    return toDto(updated)
  },

  async list(params: { page: number; pageSize: number; templateType?: string }): Promise<{ items: ImportBatchDto[]; total: number; page: number; pageSize: number; totalPages: number }> {
    const where = params.templateType ? { dataType: params.templateType as TemplateType } : {}
    const [rows, total] = await Promise.all([
      prisma.importBatch.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (params.page - 1) * params.pageSize, take: params.pageSize }),
      prisma.importBatch.count({ where }),
    ])
    return {
      items: rows.map((r) => toDto(r)),
      total,
      page: params.page,
      pageSize: params.pageSize,
      totalPages: Math.ceil(total / params.pageSize),
    }
  },

  async getById(id: string): Promise<ImportBatchDto> {
    const b = await prisma.importBatch.findUnique({ where: { id } })
    if (!b) throw errors.notFound('导入批次不存在')
    return toDto(b, true)
  },

  /** 激活批次：置 active，归档同 dataType 的旧 active 批次 */
  async activate(id: string, userId: string, traceId?: string): Promise<ImportBatchDto> {
    const b = await prisma.importBatch.findUnique({ where: { id } })
    if (!b) throw errors.notFound('导入批次不存在')
    if (b.lifecycleStatus === 'active') return toDto(b)

    const updated = await prisma.$transaction(async (tx) => {
      // 预算按财年管理：仅归档同 dataType 且同 fiscalYear 的旧 active（允许多财年预算共存）；
      // 经营/静态维持整体替换（归档同 dataType 全部旧 active）。
      const archiveWhere =
        b.dataType === 'budget'
          ? { dataType: b.dataType, lifecycleStatus: 'active' as const, fiscalYear: b.fiscalYear }
          : { dataType: b.dataType, lifecycleStatus: 'active' as const }
      await tx.importBatch.updateMany({
        where: archiveWhere,
        data: { lifecycleStatus: 'archived' },
      })
      return tx.importBatch.update({
        where: { id },
        data: { lifecycleStatus: 'active', status: 'success' },
      })
    })
    await recordAudit({ userId, module: 'data', action: 'update', targetId: id, detail: { action: 'activate' } }, traceId)
    return toDto(updated)
  },
}
