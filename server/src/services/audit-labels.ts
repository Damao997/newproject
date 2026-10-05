import { prisma } from '../lib/prisma'

/**
 * 审计日志人话化富化：把 targetId 与 detail 中的内部标识解析为业务名称。
 * 仅对当前页记录做批量 IN 查询（调用方每页 ≤ 20 条），成本有界。
 * 属附加展示信息：任一步失败都退化为空标签，不阻断审计列表本身。
 */

export interface AuditLabelInput {
  module: string
  action: string
  targetId: string | null
  detail: unknown
}

export interface AuditLabels {
  /** 与入参同序；无法解析时为 null */
  targetLabels: (string | null)[]
  /** 本页 detail 中出现的编码 → 业务名称 */
  codeLabels: Record<string, string>
}

type Kind =
  | 'user' | 'role' | 'analysis' | 'reportTemplate' | 'report' | 'importBatch'
  | 'salesman' | 'collectionPlan' | 'customerExt' | 'transactionAccount'
  | 'company' | 'subject' | 'metric' | 'productCategory' | 'keyMetricsProduct' | 'expenseMapping'

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

const stringList = (v: unknown): string[] => {
  if (typeof v === 'string' && v) return [v]
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []
}

/** detail 中需要翻译成名称的编码键 */
const COMPANY_KEYS = ['companyCode', 'single', 'singleCompanyCode', 'summaryCompanyCode', 'scope', 'sourceCompanyCode', 'targetCompanyCode']
const SUBJECT_KEYS = ['subjectCode', 'accountCode', 'fromParent', 'toParent']
const ROLE_KEYS = ['role', 'roles']
const TEMPLATE_KEYS = ['templateCode']

/** 依据 module/action（辅以 detail.action/entity）判断 targetId 可能指向的业务对象，按可能性排序 */
function candidateKinds(module: string, action: string, d: Record<string, unknown>): Kind[] {
  if (module === 'auth') return ['user']
  if (module === 'admin') {
    return action === 'role_change' || action === 'permission_change' ? ['role'] : ['user']
  }
  if (module === 'reports') {
    if (action.startsWith('analysis_')) return ['analysis']
    if (action.startsWith('template_')) return ['reportTemplate']
    if (action.startsWith('report_') || action.startsWith('share_')) return ['report']
    return []
  }
  if (module === 'data') {
    const entity = String(d.entity ?? '')
    if (entity === 'company' || entity === 'aggregation_map' || entity === 'subject_budget_config') return ['company']
    if (entity === 'subject') return ['subject']
    if (entity === 'product_category') return ['productCategory']
    if (entity === 'key_metrics_product') return ['keyMetricsProduct']
    if (entity === 'expense_subject_mapping') return ['expenseMapping']
    if (action === 'metric_change') return ['metric']
    if (action === 'reclassify') return ['subject']
    if (action === 'import' || action === 'import_rollback') return ['importBatch']
    const da = String(d.action ?? '')
    if (da === 'activate' || da === 'archive' || da === 'purge') return ['importBatch']
    return []
  }
  if (module === 'transactions') {
    if (action === 'import') return ['importBatch']
    const da = String(d.action ?? '')
    if (da === 'create-salesman' || da === 'update-salesman' || da === 'set-salesman-status') return ['salesman']
    if (da === 'create-collection' || da === 'update-collection' || da === 'add-collection-log') return ['collectionPlan']
    if (da === 'account_status') return ['transactionAccount']
    // 未标注 action 的往来记录：UUID 之间不会混淆，按可能性依次尝试
    return ['salesman', 'collectionPlan', 'customerExt']
  }
  return []
}

export async function resolveAuditLabels(rows: AuditLabelInput[]): Promise<AuditLabels> {
  const targetLabels: (string | null)[] = rows.map(() => null)
  const codeLabels: Record<string, string> = {}
  if (rows.length === 0) return { targetLabels, codeLabels }

  try {
    const rowKinds: Kind[][] = []
    const idSets: Partial<Record<Kind, Set<string>>> = {}
    const codesFor = (kind: Kind, codes: string[]) => {
      if (codes.length === 0) return
      const set = (idSets[kind] ??= new Set<string>())
      codes.forEach((c) => set.add(c))
    }
    const companyCodes: string[] = []
    const subjectCodes: string[] = []
    const roleCodes: string[] = []
    const templateCodes: string[] = []
    const shapeTargets: Array<{ kind: 'pair' | 'triple'; parts: string[] } | null> = []

    rows.forEach((r) => {
      const d = asRecord(r.detail)
      const kinds = candidateKinds(r.module, r.action, d)
      rowKinds.push(kinds)
      if (r.targetId) for (const k of kinds) (idSets[k] ??= new Set<string>()).add(r.targetId)

      // 结构化 targetId：`A->B`（公司对）/ `X:Y:Z`（汇总主体:科目:期间）
      const id = r.targetId ?? ''
      if (id.includes('->')) {
        const parts = id.split('->').map((s) => s.trim())
        shapeTargets.push({ kind: 'pair', parts })
        companyCodes.push(...parts)
      } else if (id.split(':').length === 3) {
        const parts = id.split(':')
        shapeTargets.push({ kind: 'triple', parts })
        companyCodes.push(parts[0]); subjectCodes.push(parts[1])
      } else {
        shapeTargets.push(null)
      }

      COMPANY_KEYS.forEach((k) => companyCodes.push(...stringList(d[k])))
      SUBJECT_KEYS.forEach((k) => subjectCodes.push(...stringList(d[k])))
      ROLE_KEYS.forEach((k) => roleCodes.push(...stringList(d[k])))
      TEMPLATE_KEYS.forEach((k) => templateCodes.push(...stringList(d[k])))
    })

    codesFor('subject', subjectCodes)
    codesFor('role', roleCodes)
    codesFor('reportTemplate', templateCodes)

    const idsOf = (kind: Kind) => [...(idSets[kind] ?? [])]
    const has = (kind: Kind) => idsOf(kind).length > 0

    const [users, roles, analyses, templates, reports, batches, salesmen, plans, exts, txAccounts, subjects, metrics, categories, products, mappings] =
      await Promise.all([
        has('user') ? prisma.user.findMany({ where: { id: { in: idsOf('user') } }, select: { id: true, displayName: true } }) : [],
        has('role') ? prisma.role.findMany({ where: { OR: [{ id: { in: idsOf('role') } }, { code: { in: idsOf('role') } }] }, select: { id: true, code: true, name: true } }) : [],
        has('analysis') ? prisma.subjectAnalysis.findMany({ where: { id: { in: idsOf('analysis') } }, select: { id: true, title: true } }) : [],
        has('reportTemplate') ? prisma.reportTemplate.findMany({ where: { OR: [{ id: { in: idsOf('reportTemplate') } }, { code: { in: idsOf('reportTemplate') } }] }, select: { id: true, code: true, name: true } }) : [],
        has('report') ? prisma.report.findMany({ where: { id: { in: idsOf('report') } }, select: { id: true, title: true } }) : [],
        has('importBatch') ? prisma.importBatch.findMany({ where: { id: { in: idsOf('importBatch') } }, select: { id: true, fileName: true } }) : [],
        has('salesman') ? prisma.salesman.findMany({ where: { id: { in: idsOf('salesman') } }, select: { id: true, name: true } }) : [],
        has('collectionPlan') ? prisma.collectionPlan.findMany({ where: { id: { in: idsOf('collectionPlan') } }, select: { id: true, companyCode: true, counterpartyCode: true } }) : [],
        has('customerExt') ? prisma.customerExt.findMany({ where: { id: { in: idsOf('customerExt') } }, select: { id: true, companyCode: true, counterpartyCode: true } }) : [],
        has('transactionAccount') ? prisma.transactionAccount.findMany({ where: { code: { in: idsOf('transactionAccount') } }, select: { code: true, name: true } }) : [],
        has('subject') ? prisma.accountSubject.findMany({ where: { code: { in: idsOf('subject') } }, select: { code: true, name: true } }) : [],
        has('metric') ? prisma.metric.findMany({ where: { code: { in: idsOf('metric') } }, select: { code: true, name: true } }) : [],
        has('productCategory') ? prisma.productCategory.findMany({ where: { code: { in: idsOf('productCategory') } }, select: { code: true, name: true } }) : [],
        has('keyMetricsProduct') ? prisma.keyMetricsProduct.findMany({ where: { code: { in: idsOf('keyMetricsProduct') } }, select: { code: true, name: true } }) : [],
        has('expenseMapping') ? prisma.expenseSubjectMapping.findMany({ where: { code: { in: idsOf('expenseMapping') } }, select: { code: true, name: true } }) : [],
      ])

    // 公司名依赖 detail 编码与催收计划/客商自带的公司码，故在首轮查询后回填再查
    plans.forEach((p) => companyCodes.push(p.companyCode))
    exts.forEach((e) => companyCodes.push(e.companyCode))
    codesFor('company', companyCodes)
    const companies = has('company')
      ? await prisma.company.findMany({ where: { code: { in: idsOf('company') } }, select: { code: true, name: true } })
      : []

    const byId = <T extends { id: string }>(list: T[], field: keyof T): Map<string, string> =>
      new Map(list.map((x) => [x.id, String(x[field] ?? '')]))
    const byCode = <T extends { code: string }>(list: T[], field: keyof T): Map<string, string> =>
      new Map(list.map((x) => [x.code, String(x[field] ?? '')]))

    const userMap = byId(users, 'displayName')
    const roleById = byId(roles, 'name')
    const roleByCode = byCode(roles, 'name')
    const analysisMap = byId(analyses, 'title')
    const templateById = byId(templates, 'name')
    const templateByCode = byCode(templates, 'name')
    const reportMap = byId(reports, 'title')
    const batchMap = byId(batches, 'fileName')
    const salesmanMap = byId(salesmen, 'name')
    const companyMap = byCode(companies, 'name')
    const subjectMap = byCode(subjects, 'name')
    const metricMap = byCode(metrics, 'name')
    const categoryMap = byCode(categories, 'name')
    const productMap = byCode(products, 'name')
    const mappingMap = byCode(mappings, 'name')
    const txAccountMap = byCode(txAccounts, 'name')

    const companyName = (code: string) => companyMap.get(code)
    const counterpartyLabel = (companyCode: string, counterpartyCode: string) =>
      `${companyName(companyCode) ?? companyCode} · ${counterpartyCode}`

    const labelByKind = (kind: Kind, id: string): string | undefined => {
      switch (kind) {
        case 'user': return userMap.get(id)
        case 'role': return roleById.get(id) ?? roleByCode.get(id)
        case 'analysis': return analysisMap.get(id)
        case 'reportTemplate': return templateById.get(id) ?? templateByCode.get(id)
        case 'report': return reportMap.get(id)
        case 'importBatch': return batchMap.get(id)
        case 'salesman': return salesmanMap.get(id)
        case 'collectionPlan': { const p = plans.find((x) => x.id === id); return p ? counterpartyLabel(p.companyCode, p.counterpartyCode) : undefined }
        case 'customerExt': { const e = exts.find((x) => x.id === id); return e ? counterpartyLabel(e.companyCode, e.counterpartyCode) : undefined }
        case 'transactionAccount': return txAccountMap.get(id)
        case 'company': return companyMap.get(id)
        case 'subject': return subjectMap.get(id)
        case 'metric': return metricMap.get(id)
        case 'productCategory': return categoryMap.get(id)
        case 'keyMetricsProduct': return productMap.get(id)
        case 'expenseMapping': return mappingMap.get(id)
      }
    }

    rows.forEach((r, i) => {
      const id = r.targetId
      if (id) {
        for (const kind of rowKinds[i]) {
          const hit = labelByKind(kind, id)
          if (hit) { targetLabels[i] = hit; break }
        }
      }
      if (!targetLabels[i]) {
        const shape = shapeTargets[i]
        if (shape?.kind === 'pair') {
          const [a, b] = shape.parts
          targetLabels[i] = `${companyName(a) ?? a} → ${companyName(b) ?? b}`
        } else if (shape?.kind === 'triple') {
          const [c, s, period] = shape.parts
          targetLabels[i] = `${companyName(c) ?? c} · ${subjectMap.get(s) ?? s} · ${period}`
        }
      }
    })

    const codeMap: Record<string, string> = {}
    companyMap.forEach((v, k) => { if (v) codeMap[k] = v })
    subjectMap.forEach((v, k) => { if (v) codeMap[k] = v })
    roleByCode.forEach((v, k) => { if (v) codeMap[k] = v })
    templateByCode.forEach((v, k) => { if (v) codeMap[k] = v })
    return { targetLabels, codeLabels: codeMap }
  } catch {
    // 富化属附加信息，查询失败时静默降级为原始标识
    return { targetLabels, codeLabels }
  }
}
