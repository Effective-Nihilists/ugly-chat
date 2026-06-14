import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { dataSourcePlugin } from 'ugly-app/vite';

export default defineConfig({
  plugins: [dataSourcePlugin(), react()],
  root: 'client',
  base: process.env.VITE_CDN_BASE || '/',
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    rollupOptions: {
      // Server-only native deps reached via gated `await import(...)` branches
      // deep in ugly-app (e.g. the avatar GLTFLoader decoding images with
      // `sharp` server-side). tsc strips the `/* @vite-ignore */` hint when it
      // compiles to dist, so without this the client build fails to resolve
      // `sharp` whenever it isn't installed. These branches never run in the
      // browser; keeping the import external lets the bundle build.
      external: ['sharp', 'canvas'],
    },
  },
});
