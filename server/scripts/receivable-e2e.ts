/* eslint-disable no-console */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * 应收模块端到端冒烟：真实账龄报表文件 → 预览 → 上传 → 激活 → 分析查询 → 催收全流程。
 * 运行前提：后端 dev 服务已启动、DB 已 seed。
 *   npx tsx scripts/receivable-e2e.ts [baseUrl]
 */

const BASE = process.argv[2] || 'http://localhost:3002/api/v1'
const SRC_DIRS = [
  'D:/flies/凭证附件用/六大往来/330058-2026-04',
  'D:/flies/凭证附件用/六大往来/330059-2026-04',
]

let token = ''

async function req(method: string, url: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  let payload: BodyInit | undefined
  if (form) {
    payload = form
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload })
  const json = (await res.json()) as { code: number; data: unknown; message: string }
  if (json.code !== 0) throw new Error(`${method} ${url} 失败: [${json.code}] ${json.message}`)
  return json.data
}

async function main() {
  // 1) 登录
  const login = (await req('POST', '/auth/login', { username: 'superadmin', password: process.env.SEED_DEFAULT_PASSWORD || 'Yipinhui@2026' })) as { accessToken: string }
  token = login.accessToken
  console.log('✔ 登录成功')

  // 2) 收集真实文件
  const files: { name: string; buf: Buffer }[] = []
  for (const dir of SRC_DIRS) {
    for (const name of readdirSync(dir)) {
      if (/\.(xls|xlsx)$/i.test(name)) files.push({ name, buf: readFileSync(path.join(dir, name)) })
    }
  }
  console.log(`✔ 数据源文件 ${files.length} 个`)

  // 3) 预览
  const form1 = new FormData()
  for (const f of files) form1.append('files', new Blob([new Uint8Array(f.buf)]), f.name)
  const previews = (await req('POST', '/transactions/import/preview', undefined, form1)) as Array<{ filename: string; recordCount: number; errorCount: number; warningCount: number; sheets: { transactionType: string; recordCount: number; cutoffDate: string | null }[]; summary: { companies: string[]; periods: string[]; totalClosingBalance: number; duplicateCount: number; internalCount: number } }>
  for (const p of previews) {
    console.log(`  预览 ${p.filename}: 记录=${p.recordCount} 错误=${p.errorCount} 警告=${p.warningCount} 期间=${p.summary.periods.join(',')} 公司=${p.summary.companies.join(',')} 内部=${p.summary.internalCount} 类型=[${p.sheets.map((s) => `${s.transactionType}:${s.recordCount}`).join(' ')}]`)
  }

  // 4) 上传入库
  const form2 = new FormData()
  for (const f of files) form2.append('files', new Blob([new Uint8Array(f.buf)]), f.name)
  const results = (await req('POST', '/transactions/import', undefined, form2)) as Array<{ filename: string; batch: { id: string; detailCount: number; errorCount: number; status: string } | null; error: string | null }>
  for (const r of results) {
    console.log(`  上传 ${r.filename}: ${r.error ? `失败 ${r.error}` : `批次=${r.batch!.id.slice(0, 8)} 入库=${r.batch!.detailCount} 错误=${r.batch!.errorCount}`}`)
  }

  // 5) 激活
  for (const r of results) {
    if (!r.batch) continue
    await req('POST', `/data/imports/${r.batch.id}/activate`)
  }
  console.log('✔ 全部批次已激活')

  // 6) 分析查询
  const overview = (await req('GET', '/transactions/overview')) as Array<{ transactionType: string; direction: string; totalClosingBalance: number; recordCount: number; internalCount: number }>
  console.log('✔ 六大往来总览:')
  for (const o of overview) console.log(`    ${o.transactionType}(${o.direction}) 期末=${o.totalClosingBalance.toFixed(2)} 笔数=${o.recordCount} 内部=${o.internalCount}`)

  const aging = (await req('GET', '/transactions/aging?groupBy=counterparty&transactionType=应收账款')) as unknown[]
  console.log(`✔ 应收账款按客商账龄分析 ${aging.length} 行`)

  const details = (await req('GET', '/transactions/details?direction=AR&pageSize=5')) as { total: number; items: unknown[] }
  console.log(`✔ AR 客商明细共 ${details.total} 条`)

  const cutoff = (await req('GET', '/transactions/latest-cutoff')) as { cutoffDate: string | null }
  console.log(`✔ 最新截止日期: ${cutoff.cutoffDate}`)

  // 7) 催收全流程
  const gen = (await req('POST', '/transactions/collections/generate', { minAgingBucket: '6m' })) as { created: number; skipped: number }
  console.log(`✔ 催收建议生成: 新建=${gen.created} 跳过=${gen.skipped}`)

  const plans = (await req('GET', '/transactions/collections?pageSize=5')) as { total: number; items: Array<{ id: string; counterpartyName: string | null; counterpartyCode: string; overdueAmount: number; status: string }> }
  console.log(`✔ 催收计划共 ${plans.total} 条，前 5:`)
  for (const p of plans.items) console.log(`    ${p.counterpartyName || p.counterpartyCode} 逾期=${p.overdueAmount.toFixed(2)} 状态=${p.status}`)

  if (plans.items.length > 0) {
    const plan = plans.items[0]
    const updated = (await req('PATCH', `/transactions/collections/${plan.id}`, { status: 'collecting' })) as { status: string }
    console.log(`✔ 状态流转 pending→${updated.status}`)
    await req('POST', `/transactions/collections/${plan.id}/logs`, { content: 'E2E 冒烟：电话联系客户核对逾期余额' })
    const logs = (await req('GET', `/transactions/collections/${plan.id}/logs`)) as unknown[]
    console.log(`✔ 催收记录 ${logs.length} 条`)
    // 非法流转应报错
    try {
      await req('PATCH', `/transactions/collections/${plan.id}`, { status: 'pending' })
      console.log('✘ 非法流转未被拦截！')
    } catch (e) {
      console.log(`✔ 非法流转被拦截: ${(e as Error).message}`)
    }
  }

  console.log('\n=== 应收模块端到端冒烟全部通过 ===')
}

main().catch((e) => {
  console.error('E2E 失败:', e)
  process.exit(1)
})
