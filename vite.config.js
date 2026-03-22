import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// ── Build mode selection ────────────────────────────────────────────────────
// VITE_BUILD_TARGET=webview → builds the VSCode webview bundle
// Default (no env var)      → builds the Electron / browser bundle
const isWebviewBuild = process.env.VITE_BUILD_TARGET === 'webview';

export default defineConfig({
  plugins: [react()],
  root: '.',
  base: isWebviewBuild ? './' : './',
  build: {
    outDir: isWebviewBuild ? 'dist/webview' : 'dist',
    emptyOutDir: true,
    ...(isWebviewBuild
      ? {
          rollupOptions: {
            input: path.resolve(__dirname, 'webview.html'),
            output: {
              // Flat asset names so the extension can easily resolve them
              entryFileNames: 'assets/[name]-[hash].js',
              chunkFileNames: 'assets/[name]-[hash].js',
              assetFileNames: 'assets/[name]-[hash].[ext]',
            },
          },
        }
      : {}),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/ui'),
    },
  },
});
