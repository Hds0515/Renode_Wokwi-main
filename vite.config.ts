/**
 * Vite build configuration for the Electron renderer.
 *
 * Development serves assets from root, while production uses relative paths so
 * the bundled Electron app can load dist/index.html from disk.
 */
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : './',
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    hmr: process.env.DISABLE_HMR !== 'true',
  },
}));
