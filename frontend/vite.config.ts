import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${loadEnv(mode, process.cwd(), 'BACKEND_').BACKEND_PORT || '8000'}` } },
  },
}))
