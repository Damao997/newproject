#!/usr/bin/env node
/**
 * ZJYPH 生产库账号与权限初始化（Windows / 非 Docker 环境）
 *
 * 在 prisma migrate deploy 之后执行：基于 prisma/init-roles.sql 的最小权限
 * 设计（业务账号仅 DML、无 DDL），参数化到生产库 zjyph_prod / 账号 zjyph_app。
 *
 * 用法（cwd = server 目录，读取 server/.env）：
 *   node scripts/init-zjyph-roles.mjs
 *
 * 幂等：可重复执行（账号已存在则同步密码，GRANT 重复执行无副作用）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import pg from 'pg'

dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const migrateUrl = process.env.MIGRATE_DATABASE_URL
const appUrl = process.env.DATABASE_URL
if (!migrateUrl || !appUrl) {
  console.error('[init-zjyph-roles] 错误：.env 缺少 MIGRATE_DATABASE_URL 或 DATABASE_URL')
  process.exit(1)
}

// 业务账号密码取自 DATABASE_URL（由部署脚本生成，字母数字字符集，无引号风险）
const appPwd = new URL(appUrl).password
if (!appPwd || appPwd.length < 12) {
  console.error('[init-zjyph-roles] 错误：DATABASE_URL 中的业务账号密码缺失或过短（要求 ≥12 字符）')
  process.exit(1)
}

const sql = readFileSync(path.join(__dirname, '..', 'prisma', 'init-roles.sql'), 'utf8')
  .replace(/\\set ON_ERROR_STOP on/g, '')
  .replace(/yipinhui_app/g, 'zjyph_app')
  .replace(/yipinhui/g, 'zjyph_prod')
  // psql 变量插值改为字面量（密码为字母数字，直接拼接安全）
  .replace(/:'app_password'/g, `'${appPwd.replace(/'/g, "''")}'`)

const client = new pg.Client({ connectionString: migrateUrl })
try {
  await client.connect()
  await client.query(sql)
  console.log('[init-zjyph-roles] zjyph_app 账号与权限初始化完成（仅 DML，无 DDL）')
} finally {
  await client.end()
}
