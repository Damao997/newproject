import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { ReportService } from './ReportService'
import { SubjectAnalysisService } from './SubjectAnalysisService'

/**
 * 汇总报告服务集成测试（真实 DB）。
 * 覆盖：创建报告 → 生成章节(实时引用) → 章节增删排序 → 版本快照 → 导出 → 归档。
 * afterAll 硬删除创建的报告/章节/版本/单项分析；无 DB 时整组跳过。
 */

let dbReady = false
let adminId = ''
let companyCode = ''
let subjectCode = ''
const period = `2098-${(Date.now() % 12 + 1).toString().padStart(2, '0')}`
const adminScope = { companyCode: null, scopeValue: '*' }

const createdReportIds: string[] = []
const createdAnalysisIds: string[] = []

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
  for (const rid of createdReportIds) {
    await basePrisma.reportSection.deleteMany({ where: { reportId: rid } }).catch(() => undefined)
    await basePrisma.reportVersion.deleteMany({ where: { reportId: rid } }).catch(() => undefined)
  }
  await basePrisma.report.deleteMany({ where: { id: { in: createdReportIds } } }).catch(() => undefined)
  await basePrisma.subjectAnalysis.deleteMany({ where: { id: { in: createdAnalysisIds } } }).catch(() => undefined)
})

describe('ReportService（真实 DB）', () => {
  let reportId = ''

  it('准备：创建一条单项分析供汇总引用', async () => {
    if (!dbReady) return
    const a = await SubjectAnalysisService.create(adminScope, {
      companyCode, subjectCode, fiscalYear: '2098', period, title: '被引用分析', content: '<p>单项结论</p>',
    }, adminId)
    createdAnalysisIds.push(a.id)
    expect(a.id).toBeTruthy()
  })

  it('create：按公司主体创建报告（自动判定 scope 类型）', async () => {
    if (!dbReady) return
    const report = await ReportService.create({ title: '总体分析报告', fiscalYear: '2098', period, companyScope: { type: 'company', code: companyCode } }, adminId)
    createdReportIds.push(report.id)
    reportId = report.id
    expect(report.status).toBe('draft')
    expect(report.companyScope.code).toBe(companyCode)
    expect(report.sections).toHaveLength(0)
  })

  it('generateSections：按 companyScope 拉取单项分析生成引用章节', async () => {
    if (!dbReady) return
    const report = await ReportService.generateSections(adminScope, reportId, adminId)
    expect(report.sections.length).toBeGreaterThanOrEqual(1)
    const ref = report.sections.find((s) => s.analysisId === createdAnalysisIds[0])
    expect(ref).toBeTruthy()
    expect(ref?.missing).toBe(false)
    expect(ref?.content).toContain('单项结论')
  })

  it('setSections：追加自由章节并重排，未列出的章节被删除', async () => {
    if (!dbReady) return
    const before = await ReportService.getById(reportId)
    const refSection = before.sections.find((s) => s.analysisId === createdAnalysisIds[0])
    // 仅保留引用章节 + 新增一个自由章节
    const report = await ReportService.setSections(reportId, [
      { title: '概述', content: '<p>整体概述</p>' },
      { analysisId: createdAnalysisIds[0] },
    ], adminId)
    expect(report.sections).toHaveLength(2)
    expect(report.sections[0].title).toBe('概述')
    expect(report.sections[0].analysisId).toBeNull()
    expect(report.sections[1].analysisId).toBe(createdAnalysisIds[0])
    // 自由章节内容已净化
    expect(report.sections[0].content).toContain('整体概述')
    void refSection
  })

  it('setSections 进阶：更新自由章节 / 删除章节 / 重建引用章节 / 非法引用报错', async () => {
    if (!dbReady) return
    // 当前章节：[自由(概述), 引用(analysis0)]
    const cur = await ReportService.getById(reportId)
    const free = cur.sections.find((s) => s.analysisId === null)
    expect(free).toBeTruthy()

    // 1) 更新既有自由章节（传 id）+ 移除引用章节（触发 deleteMany）
    const onlyFree = await ReportService.setSections(reportId, [{ id: free!.id, title: '概述改', content: '<p>改后</p>' }], adminId)
    expect(onlyFree.sections).toHaveLength(1)
    expect(onlyFree.sections[0].title).toBe('概述改')

    // 2) 重新以 analysisId 添加引用章节（既有章节中不存在 → 走创建分支）
    const readded = await ReportService.setSections(reportId, [
      { id: onlyFree.sections[0].id, title: '概述改', content: '<p>改后</p>' },
      { analysisId: createdAnalysisIds[0] },
    ], adminId)
    expect(readded.sections).toHaveLength(2)
    expect(readded.sections[1].analysisId).toBe(createdAnalysisIds[0])

    // 3) 引用不存在的单项分析 → 400
    await expect(
      ReportService.setSections(reportId, [{ analysisId: 'non-existent-id' }], adminId),
    ).rejects.toMatchObject({ code: 400 })
  })

  it('saveVersion：生成版本快照并递增 currentVersion', async () => {
    if (!dbReady) return
    const before = await ReportService.getById(reportId)
    const { versionNo } = await ReportService.saveVersion(reportId, '首次定稿', adminId)
    expect(versionNo).toBe(before.currentVersion + 1)
    const versions = await ReportService.listVersions(reportId)
    expect(versions.items.some((v) => v.versionNo === versionNo)).toBe(true)
  })

  it('实时引用：单项分析修改后报告章节同步最新内容', async () => {
    if (!dbReady) return
    await SubjectAnalysisService.update(adminScope, createdAnalysisIds[0], { content: '<p>修订后的单项结论</p>' }, adminId)
    const report = await ReportService.getById(reportId)
    const ref = report.sections.find((s) => s.analysisId === createdAnalysisIds[0])
    expect(ref?.content).toContain('修订后的单项结论')
  })

  it('exportStructured：返回标题/章节纯文本', async () => {
    if (!dbReady) return
    const data = await ReportService.exportStructured(reportId)
    expect(data.title).toBe('总体分析报告')
    expect(data.sections.length).toBeGreaterThanOrEqual(1)
    expect(data.sections.every((s) => typeof s.plainText === 'string')).toBe(true)
  })

  it('archive：状态置为 archived', async () => {
    if (!dbReady) return
    await ReportService.archive(reportId, adminId)
    const raw = await basePrisma.report.findUnique({ where: { id: reportId }, select: { status: true } })
    expect(raw?.status).toBe('archived')
  })
})
