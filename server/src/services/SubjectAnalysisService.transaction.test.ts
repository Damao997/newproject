import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { SubjectAnalysisService, TRANSACTION_SUBJECTS } from './SubjectAnalysisService'

/**
 * 往来单项分析（subjectType='transaction'）集成测试（真实 DB，无 DB 时整组跳过）。
 * 覆盖：TXN_* 编码创建成功且科目名解析为中文、非法 TXN 码被拒、
 * 幂等 upsert、operating/static 行为不回归（resolveSubjectType 仍走科目表）。
 * afterAll 硬删除测试记录。
 */

let dbReady = false
let adminId = ''
let companyCode = ''
const suffix = Date.now().toString(36)
const period = `2098-${suffix.slice(-2).replace(/[^0-9]/g, '1').padStart(2, '0')}`.slice(0, 7)
const createdIds: string[] = []

const adminScope = { companyCode: null, scopeValue: '*' }

beforeAll(async () => {
  try {
    await basePrisma.$queryRaw`SELECT 1`
    const admin = await prisma.user.findUnique({ where: { username: 'admin' }, select: { id: true } })
    if (admin) adminId = admin.id
    const company = await prisma.company.findFirst({ where: { entityType: 'single', status: 'active' }, select: { code: true } })
    companyCode = company?.code ?? ''
    dbReady = !!admin && !!companyCode
  } catch {
    dbReady = false
  }
})

afterAll(async () => {
  if (!dbReady) return
  await basePrisma.subjectAnalysis.deleteMany({ where: { id: { in: createdIds } } }).catch(() => undefined)
})

describe('SubjectAnalysisService transaction 类型（真实 DB）', () => {
  it('TXN_* 编码创建成功，subjectType=transaction，科目名解析为中文', async () => {
    if (!dbReady) return
    const dto = await SubjectAnalysisService.create(adminScope, {
      companyCode,
      subjectCode: 'TXN_AR',
      subjectType: 'transaction',
      fiscalYear: '2098',
      period,
      title: '应收账款分析',
      content: '<p>期末余额结构正常</p>',
      metricContext: { closingBalance: 1000, aging: { '1-3月': 600 }, cutPeriod: period },
    }, adminId)
    createdIds.push(dto.id)
    expect(dto.subjectType).toBe('transaction')
    expect(dto.subjectName).toBe('应收账款')
    expect(dto.metricContext?.closingBalance).toBe(1000)
  })

  it('未显式给类型时 TXN_* 编码自动解析为 transaction（不查科目表）', async () => {
    if (!dbReady) return
    const dto = await SubjectAnalysisService.create(adminScope, {
      companyCode,
      subjectCode: 'TXN_PER_AP',
      fiscalYear: '2098',
      period,
      title: '预付账款分析',
      content: '<p>ok</p>',
    }, adminId)
    createdIds.push(dto.id)
    expect(dto.subjectType).toBe('transaction')
    expect(dto.subjectName).toBe(TRANSACTION_SUBJECTS.TXN_PER_AP)
  })

  it('非法 TXN 编码被拒绝', async () => {
    if (!dbReady) return
    await expect(SubjectAnalysisService.create(adminScope, {
      companyCode,
      subjectCode: 'TXN_BOGUS',
      subjectType: 'transaction',
      fiscalYear: '2098',
      period,
      title: 'x',
      content: '<p>x</p>',
    }, adminId)).rejects.toThrow(/往来分析对象不存在/)
  })

  it('幂等 upsert：同 公司×TXN码×期间 命中同一记录', async () => {
    if (!dbReady) return
    const dto = await SubjectAnalysisService.create(adminScope, {
      companyCode,
      subjectCode: 'TXN_AR',
      subjectType: 'transaction',
      fiscalYear: '2098',
      period,
      title: '应收账款分析(改)',
      content: '<p>更新</p>',
    }, adminId)
    expect(dto.id).toBe(createdIds[0])
    const count = await basePrisma.subjectAnalysis.count({ where: { companyCode, subjectCode: 'TXN_AR', period } })
    expect(count).toBe(1)
  })

  it('operating/static 不回归：不存在的普通科目仍报"科目不存在"', async () => {
    if (!dbReady) return
    await expect(SubjectAnalysisService.create(adminScope, {
      companyCode,
      subjectCode: 'OP_NOT_EXIST_X',
      fiscalYear: '2098',
      period,
      title: 'x',
      content: '<p>x</p>',
    }, adminId)).rejects.toThrow(/科目不存在/)
  })
})
