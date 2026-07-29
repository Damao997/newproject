/* eslint-disable no-console */
import { basePrisma } from '../src/lib/prisma'

/**
 * 一次性存量修正：贷方性质类型（预收账款/应付账款/其他应付款）符号归一。
 * 早期导入按 ERP 借方正号口径原样入库（余额为负），本脚本统一翻转为正。
 * 注意：仅可执行一次！重复执行会把符号翻回去。
 * 幂等保护：仅翻转 rawJson 中无 rawClosingBalance 标记的旧数据（新解析器入库的行已归一并带标记）。
 */
async function main() {
  const res = await basePrisma.$executeRaw`
    UPDATE transaction_detail SET
      opening_balance = -opening_balance,
      closing_balance = -closing_balance,
      aging_1m = -aging_1m, aging_2m = -aging_2m, aging_3m = -aging_3m,
      aging_4m = -aging_4m, aging_5m = -aging_5m, aging_6m = -aging_6m,
      aging_6m_to_1y = -aging_6m_to_1y, aging_1y_to_2y = -aging_1y_to_2y,
      aging_2y_to_3y = -aging_2y_to_3y, aging_3y_plus = -aging_3y_plus,
      aging_total = -aging_total
    WHERE transaction_type IN ('预收账款', '应付账款', '其他应付款')
      AND (raw_json IS NULL OR NOT (raw_json ? 'rawClosingBalance'))
  `
  console.log(`已翻转贷方性质旧数据 ${res} 行`)

  const check = await basePrisma.transactionDetail.groupBy({
    by: ['transactionType'],
    _sum: { closingBalance: true },
  })
  for (const c of check) console.log(`  ${c.transactionType}: 期末余额合计 ${Number(c._sum.closingBalance).toFixed(2)}`)
  await basePrisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
