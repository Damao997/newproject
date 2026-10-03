// 只允许独立测试库；真实连接信息从本地开发配置读取，不写入输出或日志。
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { Client } = require('pg')
require('dotenv').config()
async function main() {
  const source = new URL(process.env.DATABASE_URL)
  if (!['127.0.0.1', 'localhost'].includes(source.hostname) || source.port !== '5434') throw new Error('仅允许本机开发数据库实例 5434')
  const name = 'zjyph_personal_test_' + Date.now()
  const adminUrl = new URL(source); adminUrl.pathname = '/postgres'
  const admin = new Client({ connectionString: adminUrl.toString() })
  await admin.connect(); await admin.query('CREATE DATABASE "' + name + '"'); await admin.end()
  const testUrl = new URL(source); testUrl.pathname = '/' + name
  fs.mkdirSync('.cache', { recursive: true })
  fs.writeFileSync('.cache/personal-test-database.json', JSON.stringify({ name, host: source.hostname, port: source.port }))
  const binary = process.env.PERSONAL_PG_BIN || 'D:/ZJYPHFA/tools/pgsql/bin'
  const backup = path.resolve('.cache/personal-before-migration.dump')
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(source.password), DATABASE_URL: testUrl.toString() }
  const dump = spawnSync(path.join(binary, 'pg_dump.exe'), ['--host', source.hostname, '--port', source.port, '--username', decodeURIComponent(source.username), '--format=custom', '--file', backup, name], { env, windowsHide: true })
  if (dump.status !== 0) throw new Error('测试库备份失败，已停止迁移')
  const verify = spawnSync(path.join(binary, 'pg_restore.exe'), ['--list', backup], { windowsHide: true })
  if (verify.status !== 0 || fs.statSync(backup).size < 100) throw new Error('测试库备份不可恢复，已停止迁移')
  console.log('测试库已创建，空库备份与恢复目录检查通过：' + name)
  const cli = require.resolve('prisma/build/index.js')
  const migration = spawnSync(process.execPath, [cli, 'migrate', 'deploy'], { env, stdio: 'inherit', windowsHide: true })
  if (migration.status !== 0) throw new Error('隔离测试迁移失败，备份已保留')
  console.log('隔离测试库迁移完成，未连接生产实例')
}
main().catch(cause => { console.error(cause.message); process.exitCode = 1 })
