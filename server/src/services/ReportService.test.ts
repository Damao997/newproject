import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { basePrisma, prisma } from '../lib/prisma'
import { ReportService } from './ReportService'
import { SubjectAnalysisService } from './SubjectAnalysisService'

/**
 * 汇总报告服务集成测试（真实 DB）。
 * 覆盖：创建报告 → 生成章节(实时引用) → 章节增删排序 → 版本快照/查看/回退 →
 * 乐观锁冲突 → scope 越权 → 状态机 → 导出 → 归档。
 * afterAll 硬删除创建的报告/章节/版本/单项分析；无 DB 时整组跳过。
 */

let dbReady = false
let adminId = ''
let companyCode = ''
let subjectCode = ''
const period = `2098-${(Date.now() % 12 + 1).toString().padStart(2, '0')}`
const adminScope = { companyCode: null, scopeValue: '*' }
// 越权用：绑定不存在的单体公司 → resolveScope 收敛为该编码，不覆盖任何真实报告主体
const outsiderScope = { companyCode: 'CO_NO_SUCH', scopeValue: null }

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
    const report = await ReportService.create(adminScope, { title: '总体分析报告', fiscalYear: '2098', period, companyScope: { type: 'company', code: companyCode } }, adminId)
    createdReportIds.push(report.id)
    reportId = report.id
    expect(report.status).toBe('draft')
    expect(report.companyScope.code).toBe(companyCode)
    expect(report.sections).toHaveLength(0)
  })

  it('scope 越权：范围外用户无法读取/创建该主体报告（403）', async () => {
    if (!dbReady) return
    await expect(ReportService.getById(outsiderScope, reportId)).rejects.toMatchObject({ code: 403 })
    await expect(
      ReportService.create(outsiderScope, { title: 'x', fiscalYear: '2098', period, companyScope: { type: 'company', code: companyCode } }, adminId),
    ).rejects.toMatchObject({ code: 403 })
    // 列表对范围外用户不可见
    const list = await ReportService.list(outsiderScope, { status: 'all' })
    expect(list.items.some((r) => r.id === reportId)).toBe(false)
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
    const report = await ReportService.setSections(adminScope, reportId, [
      { title: '概述', content: '<p>整体概述</p>' },
      { analysisId: createdAnalysisIds[0] },
    ], adminId)
    expect(report.sections).toHaveLength(2)
    expect(report.sections[0].title).toBe('概述')
    expect(report.sections[0].analysisId).toBeNull()
    expect(report.sections[1].analysisId).toBe(createdAnalysisIds[0])
    // 自由章节内容已净化
    expect(report.sections[0].content).toContain('整体概述')
  })

  it('setSections 进阶：更新自由章节 / 删除章节 / 重建引用章节 / 非法引用报错', async () => {
    if (!dbReady) return
    // 当前章节：[自由(概述), 引用(analysis0)]
    const cur = await ReportService.getById(adminScope, reportId)
    const free = cur.sections.find((s) => s.analysisId === null)
    expect(free).toBeTruthy()

    // 1) 更新既有自由章节（传 id）+ 移除引用章节（触发 deleteMany）
    const onlyFree = await ReportService.setSections(adminScope, reportId, [{ id: free!.id, title: '概述改', content: '<p>改后</p>' }], adminId)
    expect(onlyFree.sections).toHaveLength(1)
    expect(onlyFree.sections[0].title).toBe('概述改')

    // 2) 重新以 analysisId 添加引用章节（既有章节中不存在 → 走创建分支）
    const readded = await ReportService.setSections(adminScope, reportId, [
      { id: onlyFree.sections[0].id, title: '概述改', content: '<p>改后</p>' },
      { analysisId: createdAnalysisIds[0] },
    ], adminId)
    expect(readded.sections).toHaveLength(2)
    expect(readded.sections[1].analysisId).toBe(createdAnalysisIds[0])

    // 3) 引用不存在的单项分析 → 400
    await expect(
      ReportService.setSections(adminScope, reportId, [{ analysisId: 'non-existent-id' }], adminId),
    ).rejects.toMatchObject({ code: 400 })
  })

  it('乐观锁：过期 expectedUpdatedAt → 409', async () => {
    if (!dbReady) return
    await expect(
      ReportService.setSections(adminScope, reportId, [], adminId, '2000-01-01T00:00:00.000Z'),
    ).rejects.toMatchObject({ code: 409 })
    await expect(
      ReportService.saveVersion(adminScope, reportId, 'x', adminId, '2000-01-01T00:00:00.000Z'),
    ).rejects.toMatchObject({ code: 409 })
  })

  it('saveVersion：生成版本快照并递增 currentVersion', async () => {
    if (!dbReady) return
    const before = await ReportService.getById(adminScope, reportId)
    const { versionNo } = await ReportService.saveVersion(adminScope, reportId, '首次定稿', adminId)
    expect(versionNo).toBe(before.currentVersion + 1)
    const versions = await ReportService.listVersions(adminScope, reportId)
    expect(versions.items.some((v) => v.versionNo === versionNo)).toBe(true)
  })

  it('getVersion + rollbackVersion：查看快照并整体回退章节', async () => {
    if (!dbReady) return
    const versions = await ReportService.listVersions(adminScope, reportId)
    const versionNo = versions.items[0].versionNo
    const snap = await ReportService.getVersion(adminScope, reportId, versionNo)
    expect(snap.snapshot.sections.length).toBeGreaterThanOrEqual(1)
    expect(snap.snapshot.title).toBe('总体分析报告')

    // 改动章节（清空为单个自由章节）→ 回退 → 恢复快照结构
    await ReportService.setSections(adminScope, reportId, [{ title: '临时', content: '<p>临时内容</p>' }], adminId)
    const rolled = await ReportService.rollbackVersion(adminScope, reportId, versionNo, adminId)
    expect(rolled.sections).toHaveLength(snap.snapshot.sections.length)
    expect(rolled.sections.some((s) => s.analysisId === createdAnalysisIds[0])).toBe(true)

    // 不存在的版本 → 404
    await expect(ReportService.getVersion(adminScope, reportId, 9999)).rejects.toMatchObject({ code: 404 })
  })

  it('实时引用：单项分析修改后报告章节同步最新内容', async () => {
    if (!dbReady) return
    await SubjectAnalysisService.update(adminScope, createdAnalysisIds[0], { content: '<p>修订后的单项结论</p>' }, adminId)
    const report = await ReportService.getById(adminScope, reportId)
    const ref = report.sections.find((s) => s.analysisId === createdAnalysisIds[0])
    expect(ref?.content).toContain('修订后的单项结论')
  })

  it('状态机：发布后禁止编辑章节，撤回草稿后恢复可编辑', async () => {
    if (!dbReady) return
    const published = await ReportService.update(adminScope, reportId, { status: 'published' }, adminId)
    expect(published.status).toBe('published')
    // 发布态：改标题/改章节/存版本均拒绝
    await expect(ReportService.update(adminScope, reportId, { title: '改名' }, adminId)).rejects.toMatchObject({ code: 400 })
    await expect(ReportService.setSections(adminScope, reportId, [], adminId)).rejects.toMatchObject({ code: 400 })
    await expect(ReportService.saveVersion(adminScope, reportId, 'x', adminId)).rejects.toMatchObject({ code: 400 })
    // 撤回草稿
    const back = await ReportService.update(adminScope, reportId, { status: 'draft' }, adminId)
    expect(back.status).toBe('draft')
  })

  it('exportStructured：返回标题/章节纯文本', async () => {
    if (!dbReady) return
    const data = await ReportService.exportStructured(adminScope, reportId)
    expect(data.title).toBe('总体分析报告')
    expect(data.sections.length).toBeGreaterThanOrEqual(1)
    expect(data.sections.every((s) => typeof s.plainText === 'string')).toBe(true)
  })

  it('list：keyword 命中标题；归档后默认列表排除、all 包含', async () => {
    if (!dbReady) return
    const hit = await ReportService.list(adminScope, { keyword: '总体分析报告' })
    expect(hit.items.some((r) => r.id === reportId)).toBe(true)

    await ReportService.archive(adminScope, reportId, adminId)
    const raw = await basePrisma.report.findUnique({ where: { id: reportId }, select: { status: true } })
    expect(raw?.status).toBe('archived')

    const defaultList = await ReportService.list(adminScope, {})
    expect(defaultList.items.some((r) => r.id === reportId)).toBe(false)
    const allList = await ReportService.list(adminScope, { status: 'all', keyword: '总体分析报告' })
    expect(allList.items.some((r) => r.id === reportId)).toBe(true)

    // 归档态不可编辑，可恢复为草稿
    await expect(ReportService.setSections(adminScope, reportId, [], adminId)).rejects.toMatchObject({ code: 400 })
    const restored = await ReportService.update(adminScope, reportId, { status: 'draft' }, adminId)
    expect(restored.status).toBe('draft')
  })
})
