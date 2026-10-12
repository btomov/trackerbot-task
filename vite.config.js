import { defineConfig } from 'vite';
import { cpSync } from 'node:fs';

// React is bundled; the background/parser remain readable native JS modules.
export default defineConfig({
  base: './',
  publicDir: false,
  esbuild: { jsx: 'automatic' },
  plugins: [{ name: 'copy-extension-files', closeBundle() { cpSync('public', 'dist', { recursive: true }); } }],
  build: { target: 'chrome116', minify: false },
});
