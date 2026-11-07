import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), ['PRODUCT_NAME', 'UI_DRAFT_ENDPOINT']);
  // The server's local NODE_ENV must not select React's development JSX runtime in a web build.
  if (command === 'build') {
    process.env.NODE_ENV = 'production';
    delete process.env.VITE_USER_NODE_ENV;
  }
  return {
    root: 'apps/web',
    plugins: [react()],
    define: {
      __PRODUCT_NAME__: JSON.stringify(env.PRODUCT_NAME || 'ElevateBox'),
      __DRAFT_ENDPOINT__: JSON.stringify(env.UI_DRAFT_ENDPOINT || ''),
    },
    build: { outDir: 'dist', emptyOutDir: true },
    server: {
      proxy: {
        '/api': 'http://localhost:3000',
        '/ws': { target: 'ws://localhost:3000', ws: true },
      },
    },
  };
});
