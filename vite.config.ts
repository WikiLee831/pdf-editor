import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173, open: true },
  build: { chunkSizeWarningLimit: 4000, target: 'es2022' },
  optimizeDeps: { exclude: ['pdfjs-dist'] },
});
