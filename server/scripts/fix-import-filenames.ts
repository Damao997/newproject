import { prisma } from '../src/lib/prisma'

/**
 * 一次性修复历史导入批次的乱码文件名（multer/busboy latin1 误解码）。
 * 保守策略：仅当 fileName 全部字符在 latin1 范围内、latin1→utf8 重解码后
 * 包含 CJK 字符且无替换符（\ufffd）时才更新。幂等，可重复运行。
 */
async function main() {
  const batches = await prisma.importBatch.findMany({ select: { id: true, fileName: true } })
  let fixed = 0
  for (const b of batches) {
    if (/[^\u0000-\u00ff]/.test(b.fileName)) continue // 已含非 latin1 字符，视为正常
    const decoded = Buffer.from(b.fileName, 'latin1').toString('utf8')
    if (decoded.includes('\ufffd')) continue // 非合法 UTF-8 字节序列，保持原样
    if (!/[\u4e00-\u9fff]/.test(decoded)) continue // 解码后无中文，可能是正常西文名，不动
    await prisma.importBatch.update({ where: { id: b.id }, data: { fileName: decoded } })
    console.log(`修复: ${b.fileName} -> ${decoded}`)
    fixed++
  }
  console.log(`共检查 ${batches.length} 条批次，修复 ${fixed} 条`)
}

main().finally(() => prisma.$disconnect())
