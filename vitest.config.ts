import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      include: ['src/**/*.ts'],
    },
    pool: 'threads',
    maxWorkers: 1,
  },
})
