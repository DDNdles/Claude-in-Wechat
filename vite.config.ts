import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import electronRenderer from 'vite-plugin-electron-renderer';
import path from 'node:path';

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: [
                'electron',
                'electron-updater',
                'builder-util-runtime',
                'js-yaml',
                'semver',
                'lazy-val',
              ],
            },
          },
        },
      },
    ]),
    electronRenderer(),
  ],
  server: {
    watch: {
      ignored: ['**/release/**', '**/node_modules/**', '**/dist/**', '**/dist-electron/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});