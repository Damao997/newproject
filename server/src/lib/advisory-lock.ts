import { createHash } from 'node:crypto'

/**
 * 由范围键生成稳定的 bigint advisory lock 键（单参数形式，跨 PG 版本/发行版签名一致）。
 * 取摘要前 7 字节（56 位，落在有符号 bigint 范围内），以十进制字符串承载避免 JS number 精度丢失。
 *
 * 调用方式（$queryRaw 模板内）：
 *   `SELECT pg_advisory_xact_lock(${advisoryLockKey(range)}::bigint) IS NULL AS locked`
 * - ::bigint 显式转换：Prisma 以 numeric/text 传参，不转换时部分 PG 签名无法解析；
 * - IS NULL 包裹：advisory lock 函数返回 void，Prisma $queryRaw 无法反序列化 void 列，须转为 boolean。
 */
export function advisoryLockKey(range: string): string {
  const hash = createHash('md5').update(range).digest()
  return BigInt(`0x${hash.subarray(0, 7).toString('hex')}`).toString()
}
