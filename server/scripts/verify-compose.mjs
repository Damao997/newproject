// 校验 docker-compose.yml 的结构关键点（YAML 语法 + 部署正确性断言）
// 用法：node scripts/verify-compose.mjs
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const raw = execFileSync('npx', ['--yes', 'js-yaml', 'docker-compose.yml'], {
  encoding: 'utf8',
  shell: true,
})
const j = JSON.parse(raw)
const s = j.services
let failed = false

const check = (label, cond, detail = '') => {
  if (cond) {
    console.log(`  OK   ${label}${detail ? ' -> ' + detail : ''}`)
  } else {
    failed = true
    console.error(`  FAIL ${label}${detail ? ' -> ' + detail : ''}`)
  }
}

console.log('[1] YAML 解析成功，服务：' + Object.keys(s).join(', '))

check('四个服务齐备', ['postgres', 'backend', 'frontend', 'db-backup'].every((k) => k in s))
check('两个卷齐备', ['pg_data', 'backup_data'].every((k) => k in j.volumes))
check('未声明已废弃的 version 字段', !('version' in j))

// postgres
const pg = s.postgres
check('pg command 为数组形式（避免 YAML 折行被当成单串）', Array.isArray(pg.command))
check(
  'pg 挂载 backup_data（archive_command 的目标卷，规范原文遗漏会导致归档失败）',
  pg.volumes.some((v) => String(v).includes('backup_data')),
)
check(
  'pg 注入 DB_APP_PASSWORD（initdb 创建业务账号所需，规范原文遗漏）',
  'DB_APP_PASSWORD' in pg.environment,
)
check(
  'pg 端口仅绑回环',
  pg.ports.every((p) => String(p).startsWith('127.0.0.1:')),
)
check(
  'initdb 挂载 .sh 包装器（.sql 无法接收 psql 变量）',
  pg.volumes.some((v) => String(v).includes('docker-entrypoint-initdb.d') && String(v).includes('.sh')),
)

// backend
const be = s.backend
check(
  'backend 健康检查指向顶层 /health',
  be.healthcheck.test.some((t) => String(t).includes('/health') && !String(t).includes('/api/v1/health')),
  JSON.stringify(be.healthcheck.test),
)
check('backend 依赖 pg healthy', be.depends_on?.postgres?.condition === 'service_healthy')
check('backend 不发布宿主端口（仅内网可达）', !('ports' in be))
check('backend 声明必填密钥的缺失校验', String(be.environment.JWT_SECRET).includes(':?'))

// frontend
check('frontend 依赖 backend healthy', s.frontend.depends_on?.backend?.condition === 'service_healthy')
check('frontend 暴露 80', s.frontend.ports.includes('80:80'))

// db-backup
const bk = s['db-backup']
check('backup 挂载 backup_data', bk.volumes.some((v) => String(v).includes('backup_data')))
check(
  'backup 挂载 backup.sh 且只读',
  bk.volumes.some((v) => String(v).includes('backup.sh') && String(v).endsWith(':ro')),
)
check('backup cron 含全量任务', String(bk.command).includes('backup.sh full'))
check('backup cron 含 WAL 轮转', String(bk.command).includes('backup.sh rotate'))
check('backup cron 含黑名单清理', String(bk.command).includes('cleanup-blacklist'))

// 引用的宿主文件必须真实存在，否则 compose 会把它们当目录挂载
console.log('[2] 校验挂载源文件存在')
const mountSources = Object.values(s)
  .flatMap((svc) => svc.volumes ?? [])
  .map((v) => String(v).split(':')[0])
  .filter((p) => p.startsWith('./'))
for (const p of new Set(mountSources)) {
  let exists = true
  try {
    readFileSync(p)
  } catch {
    exists = false
  }
  check(`挂载源存在：${p}`, exists)
}

console.log(failed ? '\nRESULT: FAILED' : '\nRESULT: ALL PASSED')
process.exitCode = failed ? 1 : 0
