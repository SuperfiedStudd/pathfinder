import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const esm = process.env.PF_SDK_FORMAT === 'esm';
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } },
  build: {
    outDir: 'dist/sdk',
    emptyOutDir: !esm,
    lib: {
      entry: path.resolve(__dirname, esm ? 'client/src/sdk/index.tsx' : 'client/src/sdk/auto-init.ts'),
      name: 'PathfinderSDK',
      formats: [esm ? 'es' : 'iife'],
      fileName: () => esm ? 'pathfinder.es.js' : 'pathfinder.js',
    },
  },
});
