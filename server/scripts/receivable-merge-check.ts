/* eslint-disable no-console */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * 激活合并语义验证：
 * 1) 上传 330058-2026-05 并激活 → 2026-04 数据保留（新期间并存）；
 * 2) 重复上传已 active 的 2026-04 文件 → fileHash 冲突拒绝；
 * 3) 重新上传同期间(2026-05)同类型文件再激活 → 替换而非叠加（笔数不变）。
 */

const BASE = process.argv[2] || 'http://localhost:3002/api/v1'
let token = ''

async function req(method: string, url: string, body?: unknown, form?: FormData) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` }
  let payload: BodyInit | undefined
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  const res = await fetch(`${BASE}${url}`, { method, headers, body: payload })
  const json = (await res.json()) as { code: number; data: unknown; message: string }
  if (json.code !== 0) throw new Error(`[${json.code}] ${json.message}`)
  return json.data
}

async function totalDetails(): Promise<number> {
  const d = (await req('GET', '/transactions/details?pageSize=1')) as { total: number }
  return d.total
}

async function main() {
  const login = (await req('POST', '/auth/login', { username: 'superadmin', password: 'Yipinhui@2026' })) as { accessToken: string }
  token = login.accessToken

  const before = await totalDetails()
  console.log(`✔ 激活前明细总数: ${before}`)

  // 1) 上传 2026-05 全部文件并激活
  const dir = 'D:/flies/凭证附件用/六大往来/330058-2026-05'
  const files = readdirSync(dir).filter((n) => /\.(xls|xlsx)$/i.test(n))
  const form = new FormData()
  for (const n of files) form.append('files', new Blob([new Uint8Array(readFileSync(path.join(dir, n)))]), n)
  const results = (await req('POST', '/transactions/import', undefined, form)) as Array<{ filename: string; batch: { id: string; detailCount: number } | null; error: string | null }>
  let added = 0
  for (const r of results) {
    if (r.error) {
      if (r.error.includes('重复导入')) continue // 幂等重跑：已生效批次跳过
      throw new Error(`上传失败 ${r.filename}: ${r.error}`)
    }
    await req('POST', `/data/imports/${r.batch!.id}/activate`)
    added += r.batch!.detailCount
  }
  const after05 = await totalDetails()
  console.log(`✔ 2026-05 上传激活 ${results.length} 批共 ${added} 条，明细总数 ${before} → ${after05}（应为 ${before + added}，期间并存不覆盖 04）`)
  if (after05 !== before + added) throw new Error('期间并存断言失败')

  const cutoff = (await req('GET', '/transactions/latest-cutoff')) as { cutoffDate: string | null }
  console.log(`✔ 最新截止日期: ${cutoff.cutoffDate}（应为 2026-05-31）`)

  // 2) 重复上传已 active 的 2026-05 文件 → 冲突
  const dupForm = new FormData()
  dupForm.append('files', new Blob([new Uint8Array(readFileSync(path.join(dir, files[0])))]), files[0])
  const dupRes = (await req('POST', '/transactions/import', undefined, dupForm)) as Array<{ error: string | null }>
  if (dupRes[0].error?.includes('重复导入')) console.log(`✔ 重复上传被拒绝: ${dupRes[0].error}`)
  else throw new Error(`重复上传未被拦截: ${JSON.stringify(dupRes)}`)

  // 3) 同 (公司,期间,类型) 替换验证：取 2026-06 一个 SpreadsheetML 文件激活后，
  //    用同一文件尾部追加空白字节（hash 不同、XML 仍合法、内容相同）再次上传激活，
  //    断言明细总数不变（替换而非叠加）。
  const dir06 = 'D:/flies/凭证附件用/六大往来/330058-2026-06'
  const file06 = readdirSync(dir06).find((n) => /^CUX_AR_应收/.test(n))
  if (!file06) throw new Error('缺少 2026-06 应收文件')
  const buf06 = readFileSync(path.join(dir06, file06))

  const f1 = new FormData()
  f1.append('files', new Blob([new Uint8Array(buf06)]), file06)
  const r1 = (await req('POST', '/transactions/import', undefined, f1)) as Array<{ batch: { id: string; detailCount: number } | null; error: string | null }>
  if (r1[0].error && !r1[0].error.includes('重复导入')) throw new Error(r1[0].error)
  if (r1[0].batch) await req('POST', `/data/imports/${r1[0].batch.id}/activate`)
  const afterFirst = await totalDetails()

  const buf06b = Buffer.concat([buf06, Buffer.from('\n')]) // hash 不同，XML 尾部空白合法
  const f2 = new FormData()
  f2.append('files', new Blob([new Uint8Array(buf06b)]), file06)
  const r2 = (await req('POST', '/transactions/import', undefined, f2)) as Array<{ batch: { id: string; detailCount: number } | null; error: string | null }>
  if (r2[0].error) throw new Error(r2[0].error)
  if (r1[0].batch && r2[0].batch!.detailCount !== r1[0].batch.detailCount) throw new Error('同内容文件解析结果不一致')
  await req('POST', `/data/imports/${r2[0].batch!.id}/activate`)
  const afterSecond = await totalDetails()
  console.log(`✔ 同期间同类型再激活: 首批后总数=${afterFirst}，次批(入库${r2[0].batch!.detailCount})激活后总数=${afterSecond}`)
  if (afterSecond !== afterFirst) throw new Error(`同期间同类型未发生替换：${afterFirst} → ${afterSecond}`)
  console.log('✔ 同 (公司,期间,类型) 合并替换语义生效（总数不变）')

  console.log('\n=== 激活合并语义验证通过 ===')
}

main().catch((e) => {
  console.error('验证失败:', e)
  process.exit(1)
})
