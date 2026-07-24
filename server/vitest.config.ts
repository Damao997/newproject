import { defineConfig } from 'vitest/config'

// 后端测试配置：Node 环境，覆盖核心逻辑（AuthService / 中间件 / lib）
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // DB 集成测试共享同一库，禁用文件级并行避免状态竞争
    fileParallelism: false,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/test/**',
        'src/server.ts',
        'src/types/**',
      ],
    },
  },
})
