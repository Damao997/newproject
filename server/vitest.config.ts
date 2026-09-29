import { defineConfig } from 'vitest/config'

// 后端测试配置：Node 环境，覆盖核心逻辑（AuthService / 中间件 / lib）
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // DB 集成测试共享同一库，禁用文件级并行避免状态竞争
    fileParallelism: false,
    // 真实 DB 夹具准备/清理（beforeAll/afterAll）在本机嵌入式 PG 上实测可达 40s+，留足余量
    hookTimeout: 120_000,
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
      // 覆盖率 ratchet 门禁（M12）：阈值锚定当前实测水位（73.98%），只能向上提升；
      // npm run test:coverage 低于阈值即失败。testing.md 目标 80%，提升任务另行排期
      thresholds: {
        lines: 73,
        branches: 75,
        functions: 78,
        statements: 73,
      },
    },
  },
})
