import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { SubjectAnalysisService } from './SubjectAnalysisService'

/**
 * 单项分析服务集成测试（真实 DB）。
 * 创建的记录在 afterAll 硬删除，保证共享库回到 seed 状态；无 DB 时整组跳过。
 */

let dbReady = false
let adminId = ''
let companyCode = ''
let subjectCode = ''
const suffix = Date.now().toString(36)
const period = `2099-${suffix.slice(0, 2).padStart(2, '0')}`.slice(0, 7) // 唯一期间，避免与种子冲突
const createdIds: string[] = []

// 全量 scope 上下文（scopeValue='*'）
const adminScope = { companyCode: null, scopeValue: '*' }

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
    dbReady = !!admin
    if (admin) adminId = admin.id
    if (dbReady) {
      const company = await prisma.company.findFirst({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
      const subject = await prisma.accountSubject.findFirst({ where: { subjectType: 'operating', status: 'active' }, select: { code: true } })
      companyCode = company?.code ?? ''
      subjectCode = subject?.code ?? ''
      dbReady = !!companyCode && !!subjectCode
    }
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.subjectAnalysis.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined)
})

describe('SubjectAnalysisService（真实 DB）', () => {
  it('create：净化 content 并写入，带回公司名/科目名', async () => {
    if (!dbReady) return
    const dto = await SubjectAnalysisService.create(adminScope, {
      companyCode,
      subjectCode,
      fiscalYear: '2099',
      period,
      title: '灶具收入分析',
      content: '<p>收入增长</p><script>alert(1)</script>',
      metricContext: { actual: 100, yoy: 12.3 },
    }, adminId)
    createdIds.push(dto.id)
    expect(dto.companyCode).toBe(companyCode)
    expect(dto.subjectCode).toBe(subjectCode)
    expect(dto.content).not.toContain('<script')
    expect(dto.content).toContain('收入增长')
    expect(dto.companyName).toBeTruthy()
    expect(dto.subjectName).toBeTruthy()
    expect(dto.metricContext?.actual).toBe(100)
  })

  it('create 幂等：同 公司×科目×期间 不产生重复，更新内容', async () => {
    if (!dbReady) return
    const dto2 = await SubjectAnalysisService.create(adminScope, {
      companyCode,
      subjectCode,
      fiscalYear: '2099',
      period,
      title: '灶具收入分析(改)',
      content: '<p>更新后的结论</p>',
    }, adminId)
    // upsert 命中同一记录，id 应相同
    expect(dto2.id).toBe(createdIds[0])
    expect(dto2.title).toBe('灶具收入分析(改)')
    const count = await basePrisma.subjectAnalysis.count({ where: { companyCode, subjectCode, period } })
    expect(count).toBe(1)
  })

  it('list / getById：可按公司与期间过滤', async () => {
    if (!dbReady) return
    const list = await SubjectAnalysisService.list(adminScope, { companyCode, period })
    expect(list.items.some((i) => i.id === createdIds[0])).toBe(true)

    const detail = await SubjectAnalysisService.getById(adminScope, createdIds[0])
    expect(detail.id).toBe(createdIds[0])
  })

  it('update：仅改标题/正文，公司科目期间不变', async () => {
    if (!dbReady) return
    const updated = await SubjectAnalysisService.update(adminScope, createdIds[0], { title: '终稿标题', content: '<p>终稿</p>' }, adminId)
    expect(updated.title).toBe('终稿标题')
    expect(updated.content).toContain('终稿')
    expect(updated.companyCode).toBe(companyCode)
  })

  it('scope 越权：受限用户操作非授权公司被拒（403）', async () => {
    if (!dbReady) return
    const restricted = { companyCode: 'NON_EXISTENT_EN', scopeValue: '' }
    await expect(
      SubjectAnalysisService.create(restricted, { companyCode, subjectCode, fiscalYear: '2099', period, title: 'x', content: '<p>x</p>' }, adminId),
    ).rejects.toMatchObject({ code: 403 })
  })

  it('remove：软删除后列表不可见，底层记录 status=inactive', async () => {
    if (!dbReady) return
    await SubjectAnalysisService.remove(adminScope, createdIds[0], adminId)
    const list = await SubjectAnalysisService.list(adminScope, { companyCode, period })
    expect(list.items.some((i) => i.id === createdIds[0])).toBe(false)
    const raw = await basePrisma.subjectAnalysis.findUnique({ where: { id: createdIds[0] }, select: { status: true } })
    expect(raw?.status).toBe('inactive')
  })

  it('batchForCompanies：按公司集合取数（含 ET 展开兜底）', async () => {
    if (!dbReady) return
    // 重新创建一条 active 记录供批量取数
    const dto = await SubjectAnalysisService.create(adminScope, {
      companyCode, subjectCode, fiscalYear: '2099', period, title: '批量', content: '<p>批量取数</p>',
    }, adminId)
    createdIds.push(dto.id)
    const { items, resolvedCompanyCodes } = await SubjectAnalysisService.batchForCompanies(adminScope, { companyCodes: [companyCode], period })
    expect(resolvedCompanyCodes).toContain(companyCode)
    expect(items.some((i) => i.id === dto.id)).toBe(true)
  })
})
