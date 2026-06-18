import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  // Multi-page app — one entry per HTML file
  build: {
    rollupOptions: {
      input: {
        main:       resolve(__dirname, 'index.html'),
        breakdowns: resolve(__dirname, 'breakdowns.html'),
        machines:   resolve(__dirname, 'machines.html'),
        spareparts: resolve(__dirname, 'spareparts.html'),
        kpi:        resolve(__dirname, 'kpi.html'),
        reports:    resolve(__dirname, 'reports.html'),
        documents:  resolve(__dirname, 'documents.html'),
      },
    },
    outDir: 'dist',
    emptyOutDir: true,
  },

  // Dev server settings
  server: {
    port: 3000,
    open: true,   // auto-opens browser on npm run dev
  },
});
