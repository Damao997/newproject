import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { buildThemeCss, THEME_BOOT_SCRIPT } from './src/lib/theme-css'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 后端端口单一来源：server/.env 的 PORT（loadEnv 直接读取相邻包，避免与 dev-up 双份解析）
  const serverEnv = loadEnv(mode, path.resolve(__dirname, '../server'), '')
  const apiPort = Number(serverEnv.PORT || 3001)
  // 前端 dev 端口：默认 5173，可用 VITE_DEV_PORT（建议写入 web/.env.local，该文件已被 gitignore）覆盖
  const webPort = Number(loadEnv(mode, __dirname, '').VITE_DEV_PORT || 5173)

  return {
    plugins: [react(), {
      name: 'app-theme-bootstrap',
      transformIndexHtml: {
        order: 'pre',
        handler: () => [
          { tag: 'script', children: THEME_BOOT_SCRIPT, injectTo: 'head-prepend' },
          { tag: 'style', attrs: { id: 'app-theme-tokens' }, children: buildThemeCss(), injectTo: 'head-prepend' },
        ],
      },
    }],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    build: {
      rollupOptions: {
        output: {
          // 仅对"必然进首屏"的框架层做手动分组，便于长期缓存。
          // 刻意不再手动分组 echarts / exceljs / jspdf / docx：
          //   前者已改为 echarts/core 按需注册（components/charts/echarts-core.ts），
          //   后者已改为导出时动态 import（lib/export.ts、report-export.ts、import-template.ts）。
          //   若在此处显式分组，Rollup 会把它们重新拉成静态 chunk，
          //   动态 import 的按需加载效果会被完全抵消。
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-query': ['@tanstack/react-query'],
          },
        },
      },
    },
    server: {
      // 截图与导出验收产物不是源文件；Windows 下载写入期间可能占用文件。
      watch: { ignored: ['**/audit/**', '**/screenshots/**'] },
      host: true, // 开启内网访问：监听所有网卡，局域网设备可经 http://<本机IP>:<端口> 访问
      port: webPort,
      strictPort: true, // 端口被占用即失败，避免静默漂移到 5174 使代理与 CORS 白名单失配
      // 允许经 frp 隧道用域名访问（Vite 会校验 Host 头，未列入则拒绝）
      allowedHosts: ['damaospace.ltd'],
      proxy: {
        // 开发期将 /api/v1 反代到后端服务（端口跟随 server/.env 的 PORT）
        '/api/v1': {
          target: `http://127.0.0.1:${apiPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
