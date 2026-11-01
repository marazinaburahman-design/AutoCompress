import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
  base: './',
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    strictPort: true,
    port: 5173,
  },
  build: {
    outDir: 'dist/renderer',
  },
})
