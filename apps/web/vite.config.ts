import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => ({
  root: 'apps/web',
  plugins: [react()],
  define: {
    __PRODUCT_NAME__: JSON.stringify(loadEnv(mode, process.cwd(), '').PRODUCT_NAME || 'ElevateBox'),
    __DRAFT_ENDPOINT__: JSON.stringify(loadEnv(mode, process.cwd(), '').UI_DRAFT_ENDPOINT || ''),
  },
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    proxy: { '/api': 'http://localhost:3000', '/ws': { target: 'ws://localhost:3000', ws: true } },
  },
}));
