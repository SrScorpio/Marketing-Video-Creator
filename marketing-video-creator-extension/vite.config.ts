import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/panel',
    emptyOutDir: true,
    // Nombre de salida estable (sin hash): extension.ts referencia
    // dist/panel/index.js para cargar el webview.
    rollupOptions: {
      input: resolve(__dirname, 'src/panel/index.html'),
      output: {
        entryFileNames: 'index.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'index.[ext]'
      }
    }
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/panel')
    }
  }
});
