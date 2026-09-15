import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../dist', emptyOutDir: true },
  // En dev : tunnel SSH vers le panel du VPS (ssh -L 4030:127.0.0.1:4030 ...)
  server: { proxy: { '/api': 'http://127.0.0.1:4030' } },
});
