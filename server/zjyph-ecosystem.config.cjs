/**
 * ZJYPH Windows 生产环境 PM2 配置。
 *
 * 路径默认从当前仓库根目录推导，不绑定盘符；端口可由本地
 * ops-panel/runtime-config.json 或 ZJYPH_* 环境变量覆盖。
 * runtime-config.json 含现场配置，不进入 Git；缺失时使用安全默认值。
 */
const fs = require('node:fs')
const path = require('node:path')

const PROD_ROOT = path.resolve(__dirname, '..')
const RUNTIME_FILE = process.env.ZJYPH_RUNTIME_CONFIG || path.join(PROD_ROOT, 'ops-panel', 'runtime-config.json')
const DEFAULT_RUNTIME = {
  services: { postgresPort: 5433, backendPort: 3100, frontendPort: 8080 },
  access: { frontendOrigin: '' },
}

function loadRuntime() {
  try {
    const value = JSON.parse(fs.readFileSync(RUNTIME_FILE, 'utf8'))
    return {
      services: { ...DEFAULT_RUNTIME.services, ...(value.services || {}) },
      access: { ...DEFAULT_RUNTIME.access, ...(value.access || {}) },
    }
  } catch {
    return DEFAULT_RUNTIME
  }
}

function port(name, runtimeValue) {
  const value = Number(process.env[name] || runtimeValue)
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} 端口非法`)
  return value
}

const runtime = loadRuntime()
const postgresPort = port('ZJYPH_PG_PORT', runtime.services.postgresPort)
const backendPort = port('ZJYPH_BACKEND_PORT', runtime.services.backendPort)
const frontendPort = port('ZJYPH_FRONTEND_PORT', runtime.services.frontendPort)
const logDir = path.resolve(process.env.ZJYPH_LOG_DIR || path.join(PROD_ROOT, 'logs'))
const backendEnv = { NODE_ENV: 'production', PORT: String(backendPort) }
const frontendOrigin = process.env.ZJYPH_FRONTEND_ORIGIN || runtime.access.frontendOrigin
if (frontendOrigin) backendEnv.FRONTEND_ORIGIN = frontendOrigin

module.exports = {
  apps: [
    {
      name: 'zjyph-postgres',
      cwd: __dirname,
      script: 'scripts/prod-db.ts',
      interpreter: 'node',
      node_args: ['--import', 'tsx'],
      env: { ZJYPH_PG_PORT: String(postgresPort) },
      autorestart: true,
      max_memory_restart: '1G',
      out_file: path.join(logDir, 'postgres.out.log'),
      error_file: path.join(logDir, 'postgres.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      name: 'zjyph-backend',
      cwd: __dirname,
      script: 'dist/src/server.js',
      autorestart: true,
      // 导入使用 memoryStorage（上限 200MB × 解析峰值）
      max_memory_restart: '1536M',
      out_file: path.join(logDir, 'backend.out.log'),
      error_file: path.join(logDir, 'backend.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      env: backendEnv,
    },
    {
      name: 'zjyph-frontend',
      cwd: path.join(PROD_ROOT, 'web'),
      script: 'serve-static.cjs',
      autorestart: true,
      out_file: path.join(logDir, 'frontend.out.log'),
      error_file: path.join(logDir, 'frontend.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      env: {
        PORT: String(frontendPort),
        BACKEND_PORT: String(backendPort),
      },
    },
  ],
}
