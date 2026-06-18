import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The client lives in ./client. All calls to /api are proxied to the Node
// server (which holds the credentials and forwards to Hello Retail).
export default defineConfig({
  root: 'client',
  // Relative base so the built site works both at the GitHub Pages subpath
  // (/hr-api-tester/) and when served locally from the root.
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
})
