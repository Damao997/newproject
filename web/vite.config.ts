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
  server: {
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
