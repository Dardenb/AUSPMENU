import { defineConfig } from 'vite';

export default defineConfig({
  // '/' is right for Firebase Hosting at a domain root.
  // Change to './' if you ever serve this from a subdirectory (e.g. GitHub Pages).
  base: '/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096, // keep the sprites as real files, never re-inlined
  },
});
