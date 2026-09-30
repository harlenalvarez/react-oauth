/// <reference types="vitest" />
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import path from 'node:path'
import svgr from 'vite-plugin-svgr'
import css from 'vite-plugin-css-injected-by-js'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    svgr(),
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
      name: 'ReactOauth',
      fileName: 'react-oauth',
    },
    rollupOptions: {
      external: (id) => /^(react|react-dom)(\/|$)/.test(id),
      output: {
        globals: {
          react: 'react',
          'react-dom': 'ReactDOM',
          'react/jsx-runtime': 'ReactJSXRuntime',
        },
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './test.setup.ts'
  }
})
