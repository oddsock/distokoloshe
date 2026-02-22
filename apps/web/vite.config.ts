import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@distokoloshe/ui': path.resolve(__dirname, '../../packages/ui/src'),
    },
  },
  build: { outDir: 'dist' },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/livekit': {
        target: 'ws://localhost:7880',
        ws: true,
        rewrite: (path) => path.replace(/^\/livekit/, ''),
      },
    },
  },
});
