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
  build: {
    outDir: 'dist',
    rollupOptions: {
      // Tauri plugins are only available in the desktop app — mark as external
      // so the web build doesn't fail on dynamic imports that never execute
      external: [
        '@tauri-apps/plugin-global-shortcut',
        '@tauri-apps/plugin-updater',
        '@tauri-apps/plugin-process',
        '@tauri-apps/api/core',
      ],
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/livekit': {
        target: 'ws://localhost:7881',
        ws: true,
        rewrite: (path) => path.replace(/^\/livekit/, ''),
      },
    },
  },
});
