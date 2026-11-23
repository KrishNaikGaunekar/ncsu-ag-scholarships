import { defineConfig } from 'vite';

// Relative base so the build works under the GitHub Pages subpath.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', assetsDir: 'assets' },
});
