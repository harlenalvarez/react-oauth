/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import dts from 'vite-plugin-dts'
import path from 'node:path'
import svgr from 'vite-plugin-svgr'
import css from 'vite-plugin-css-injected-by-js'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    svgr(),
    react(),
    css(),
    dts({
      insertTypesEntry: true,
      include: ['src/lib/'],
    })
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/lib"),
    }
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, './src/lib/index.ts'),
      name: 'ReactOauth',
      fileName: 'react-oauth',
    },
    rollupOptions: {
      external: ['react', 'react-dom'],
      output: {
        globals: {
          react: 'react',
          'react-dom': 'ReactDOM',
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
