import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  resolve: { dedupe: ['three'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
});
