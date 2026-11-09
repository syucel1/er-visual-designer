import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build:preview` produces one self-contained HTML file (../../preview/index.html)
// that opens straight from disk without a server.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'preview' ? [viteSingleFile()] : [])],
  base: './',
  build: mode === 'preview'
    ? { outDir: '../../preview', emptyOutDir: true, chunkSizeWarningLimit: 4000 }
    : { outDir: 'dist', chunkSizeWarningLimit: 2000 },
}));
