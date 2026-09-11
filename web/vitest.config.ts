/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: [
        'src/lib/utils.ts',
        'src/lib/permissions.ts',
        'src/lib/sanitize.ts',
        'src/lib/file-validation.ts',
        'src/lib/subject-tree.ts',
        'src/hooks/**',
        'src/components/data-table/**',
        'src/components/subject-tree/**',
        'src/components/layout/require-permission.tsx',
      ],
    },
  },
})
