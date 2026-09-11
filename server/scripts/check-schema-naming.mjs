#!/usr/bin/env node
// 数据库命名规范守护脚本（规则见 docs/plans/数据模型规范.md 二、命名规范）
// 校验 prisma/schema.prisma：
//   1. 每个 model 必须有 @@map，且值为 snake_case（复数仅告警）
//   2. 含大写字母的字段（camelCase 多词）必须有 @map，且值与字段名 snake_case 对应
//   3. @@map 值不得为 PostgreSQL 保留字（存量 `user` 白名单放行）
//   4. 枚举值含大写字母视为违规（存量 `AgingBucket` 白名单放行）
// 违规输出行号与原因并 exit 1。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const schemaPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'prisma', 'schema.prisma')
const lines = readFileSync(schemaPath, 'utf8').split(/\r?\n/)

// 存量例外白名单（新增表/枚举不得追加，除非规范文档同步修订）
const RESERVED_TABLE_WHITELIST = new Set(['user'])
const ENUM_WHITELIST = new Set(['AgingBucket'])
// 以 s 结尾但实为单数的词，避免复数启发式误报
const SINGULAR_S_WHITELIST = new Set(['analysis', 'status'])

// PostgreSQL 保留字（常用子集，覆盖易踩雷的表名）
const PG_RESERVED = new Set([
  'user', 'order', 'group', 'table', 'check', 'default', 'grant', 'select',
  'where', 'from', 'to', 'in', 'on', 'and', 'or', 'not', 'null', 'primary',
  'references', 'constraint', 'column', 'create', 'index', 'cast', 'do',
  'for', 'into', 'limit', 'offset', 'union', 'all', 'any', 'some', 'case',
  'when', 'then', 'else', 'end', 'desc', 'asc', 'between', 'both', 'collate',
  'distinct', 'having', 'join', 'using', 'with', 'window', 'returning',
])

const SNAKE_CASE = /^[a-z][a-z0-9_]*$/

const errors = []
const warnings = []

let block = null // { kind: 'model' | 'enum', name, startLine, hasMap, fields: [] }

function closeBlock(endLine) {
  if (!block) return
  if (block.kind === 'model') {
    if (!block.tableName) {
      errors.push(`L${block.startLine}: model ${block.name} 缺少 @@map（表名必须显式声明为 snake_case 单数）`)
    } else {
      const t = block.tableName
      if (!SNAKE_CASE.test(t)) {
        errors.push(`L${block.mapLine}: model ${block.name} 的 @@map("${t}") 不是合法 snake_case`)
      }
      if (PG_RESERVED.has(t) && !RESERVED_TABLE_WHITELIST.has(t)) {
        errors.push(`L${block.mapLine}: 表名 "${t}" 是 PostgreSQL 保留字，新表禁用（见规范 2.5 节）`)
      }
      const lastWord = t.split('_').pop()
      if (lastWord.length > 2 && lastWord.endsWith('s') && !lastWord.endsWith('ss') && !lastWord.endsWith('us') && !SINGULAR_S_WHITELIST.has(lastWord)) {
        warnings.push(`L${block.mapLine}: 表名 "${t}" 疑似复数（规范要求单数），请人工确认`)
      }
    }
  }
  void endLine
  block = null
}

for (let i = 0; i < lines.length; i++) {
  const lineNo = i + 1
  const raw = lines[i]
  const line = raw.replace(/\/\/.*$/, '').trimEnd() // 去掉行内注释
  const trimmed = line.trim()
  if (!trimmed) continue

  const blockStart = trimmed.match(/^(model|enum)\s+([A-Za-z0-9_]+)\s*\{/)
  if (blockStart) {
    block = { kind: blockStart[1], name: blockStart[2], startLine: lineNo }
    continue
  }
  if (trimmed === '}') {
    closeBlock(lineNo)
    continue
  }
  if (!block) continue

  if (block.kind === 'model') {
    const mapMatch = trimmed.match(/^@@map\("([^"]+)"\)/)
    if (mapMatch) {
      block.tableName = mapMatch[1]
      block.mapLine = lineNo
      continue
    }
    if (trimmed.startsWith('@@')) continue

    // 字段行：字段名 类型 [属性...]
    const fieldMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*)\s+([A-Za-z][A-Za-z0-9]*(\[\])?\??)\s*(.*)$/)
    if (!fieldMatch) continue
    const [, fieldName, fieldType, , attrs] = fieldMatch
    // 关系字段无物理列：列表关系（Type[]）或含 @relation
    if (fieldType.endsWith('[]') || attrs.includes('@relation')) continue

    const mapAttr = attrs.match(/@map\("([^"]+)"\)/)
    const hasUpper = /[A-Z]/.test(fieldName)
    if (hasUpper && !mapAttr) {
      errors.push(`L${lineNo}: ${block.name}.${fieldName} 为多词字段但缺少 @map（列名必须 snake_case）`)
      continue
    }
    if (mapAttr) {
      const col = mapAttr[1]
      if (!SNAKE_CASE.test(col)) {
        errors.push(`L${lineNo}: ${block.name}.${fieldName} 的 @map("${col}") 不是合法 snake_case`)
      } else if (col.replace(/_/g, '') !== fieldName.toLowerCase()) {
        errors.push(`L${lineNo}: ${block.name}.${fieldName} 与 @map("${col}") 不对应（去下划线后应一致）`)
      }
    }
  } else if (block.kind === 'enum') {
    if (ENUM_WHITELIST.has(block.name)) continue
    const valueMatch = trimmed.match(/^([A-Za-z0-9_]+)\s*(@map\("[^"]+"\))?\s*$/)
    if (!valueMatch) continue
    const [, value, valueMap] = valueMatch
    if (/[A-Z]/.test(value) && !valueMap) {
      errors.push(`L${lineNo}: 枚举 ${block.name} 的值 "${value}" 含大写字母（枚举值须小写 snake_case，见规范 2.6 节）`)
    }
  }
}

for (const w of warnings) console.warn(`[warn] ${w}`)
if (errors.length > 0) {
  console.error(`schema.prisma 命名规范检查未通过（${errors.length} 处违规）：`)
  for (const e of errors) console.error(`  [error] ${e}`)
  process.exit(1)
}
console.log(`schema.prisma 命名规范检查通过（warnings: ${warnings.length}）`)
