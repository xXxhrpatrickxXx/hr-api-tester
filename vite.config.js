import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The client lives in ./client. All calls to /api are proxied to the Node
// server (which holds the credentials and forwards to Hello Retail).
export default defineConfig({
  root: 'client',
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
