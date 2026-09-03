import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
    host: true, // 开启内网访问：监听所有网卡，局域网设备可经 http://<本机IP>:<端口> 访问
    port: 5173,
    // 允许经 frp 隧道用域名访问（Vite 会校验 Host 头，未列入则拒绝）
    allowedHosts: ['damaospace.ltd'],
    proxy: {
      // 开发期将 /api/v1 反代到后端服务（见 server，端口 3001）
      '/api/v1': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
