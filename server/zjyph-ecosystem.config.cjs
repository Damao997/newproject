/**
 * ZJYPH 生产环境 PM2 进程配置（Windows / 非 Docker）
 *
 * 三个进程，全部由 PM2 托管（自动重启 + 开机自启）：
 *   zjyph-postgres  生产 PostgreSQL（嵌入式实例，127.0.0.1:5433，数据目录 D:\ZJYPH-data）
 *   zjyph-backend   后端 API（dist/server.js，端口 3100，读取 server/.env）
 *   zjyph-frontend  前端静态托管（web/dist，端口 8080，SPA fallback，依赖全局 serve 包）
 *
 * 用法：
 *   pm2 start zjyph-ecosystem.config.cjs
 *   pm2 save && pm2 startup   （首次配置开机自启）
 * 日志输出：D:\ZJYPH-prod\logs\（由 pm2-logrotate 轮转，保留 30 天）
 */
const path = require('path')

const LOG_DIR = 'D:/ZJYPH-prod/logs'

module.exports = {
  apps: [
    {
      name: 'zjyph-postgres',
      cwd: __dirname,
      script: 'scripts/prod-db.ts',
      interpreter: 'node',
      node_args: ['--import', 'tsx'],
      autorestart: true,
      max_memory_restart: '1G',
      out_file: path.join(LOG_DIR, 'postgres.out.log'),
      error_file: path.join(LOG_DIR, 'postgres.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
    {
      name: 'zjyph-backend',
      cwd: __dirname,
      script: 'dist/src/server.js',
      autorestart: true,
      // 1.5G：导入走 multer memoryStorage（上限 200MB × 解析峰值），500M 会被 PM2 误杀大文件导入
      max_memory_restart: '1.5G',
      out_file: path.join(LOG_DIR, 'backend.out.log'),
      error_file: path.join(LOG_DIR, 'backend.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'zjyph-frontend',
      cwd: path.join(__dirname, '..', 'web'),
      script: 'serve-static.cjs',
      autorestart: true,
      out_file: path.join(LOG_DIR, 'frontend.out.log'),
      error_file: path.join(LOG_DIR, 'frontend.err.log'),
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      merge_logs: true,
    },
  ],
}
