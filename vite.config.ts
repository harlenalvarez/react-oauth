/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import path from 'node:path'
import css from 'vite-plugin-css-injected-by-js'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    css(),
    dts({
      insertTypesEntry: true,
      bundleTypes: true,
      include: ['src/lib/'],
    })
  ],
  resolve: {
    alias: {
      '@huddle-ai/auth': path.resolve(import.meta.dirname, './src/lib/index.ts'),
      "@": path.resolve(import.meta.dirname, "./src/lib"),
    }
  },
  build: {
    lib: {
      entry: path.resolve(import.meta.dirname, './src/lib/index.ts'),
      formats: ['es'],
      fileName: 'react-oauth',
    },
    rolldownOptions: {
      external: (id) => /^(react|react-dom)(\/|$)/.test(id),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test.setup.ts'
  }
})
