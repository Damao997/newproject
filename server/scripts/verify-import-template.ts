import { ImportService } from '../src/services/ImportService'
import { parseImportWorkbook } from '../src/lib/excel-import'
import { prisma } from '../src/lib/prisma'

/**
 * 验证导入模板与解析器兼容性：
 * 1) ImportService.getTemplate 生成的三种模板（operating/static/budget）用 parseImportWorkbook 解析，
 *    断言 errorCount === 0（科目名、公司名全部匹配，值列留空不产生错误）；
 * 2) 模板科目行数 = 库中该类型数据类（data）指标数（且模板行全部可解析）。
 *
 * 用法：npx tsx scripts/verify-import-template.ts（需本地 DB 运行）
 */
async function main(): Promise<void> {
  let failed = false
  for (const type of ['operating', 'static', 'budget'] as const) {
    const buffer = await ImportService.getTemplate(type)

    // 与 ImportService.buildResolvers 同源构建解析器（公司名/简称、科目名 → 编码）
    const subjectType = type === 'static' ? 'static' : 'operating'
    const [companies, subjects] = await Promise.all([
      prisma.company.findMany({ select: { code: true, name: true, shortName: true } }),
      prisma.accountSubject.findMany({ where: { subjectType }, select: { code: true, name: true } }),
    ])
    const companyByName = new Map<string, string>()
    for (const c of companies) {
      companyByName.set(c.name.trim(), c.code)
      if (c.shortName) companyByName.set(c.shortName.trim(), c.code)
    }
    const parsed = parseImportWorkbook(buffer, type, {
      companyByName,
      subjectByName: new Map(subjects.map((s) => [s.name.trim(), s.code])),
      defaultFiscalYear: 'FY2026',
    })

    // 断言 1：解析零错误（模板可直接导入）
    console.log(`[${type}] 解析行=${parsed.dataRowCount} 错误=${parsed.errors.length}`)
    if (parsed.errors.length > 0) {
      console.log('  错误示例：', JSON.stringify(parsed.errors.slice(0, 5)))
      failed = true
    }

    // 断言 2：模板科目行数 = 数据类指标数
    const metrics = await prisma.metric.findMany({
      where: { code: { in: subjects.map((s) => s.code) }, status: 'active' },
      select: { code: true, dataType: true },
    })
    const dataCount = metrics.filter((m) => m.dataType === 'data').length
    console.log(`  数据类指标=${dataCount} 模板科目行=${parsed.dataRowCount} ${dataCount === parsed.dataRowCount ? '一致' : '不一致'}`)
    if (dataCount !== parsed.dataRowCount) failed = true
  }
  await prisma.$disconnect()
  if (failed) {
    console.error('[verify] 失败')
    process.exit(1)
  }
  console.log('[verify] 通过：模板科目均来自数据类指标，且可直接被导入解析')
}

main().catch((err) => {
  console.error('[verify] 异常：', err)
  process.exit(1)
})
