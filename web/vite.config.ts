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
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-query': ['@tanstack/react-query'],
          'vendor-charts': ['echarts', 'echarts-for-react'],
          'vendor-excel': ['exceljs', 'xlsx'],
        },
      },
    },
  },
  server: {
    host: true, // 开启内网访问：监听所有网卡，局域网设备可经 http://<本机IP>:<端口> 访问
    port: 5173,
    proxy: {
      // 开发期将 /api/v1 反代到后端服务（见 server，端口 3001）
      '/api/v1': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
