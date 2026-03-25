import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: resolve(__dirname),
  base: './',
  resolve: {
    alias: {
      '@': resolve(__dirname),
      '@vercel/analytics/next': resolve(__dirname, 'lib/analytics-noop.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, '../desktop/dist/renderer'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'electron-index.html'),
    },
  },
  define: {
    'process.env.NODE_ENV': '"production"',
  },
})
