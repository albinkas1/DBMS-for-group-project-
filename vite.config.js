import { defineConfig } from 'vite';
export default defineConfig({
  root: 'client',
  envPrefix: 'PUBLIC_',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          editor: [
            '@codemirror/state',
            '@codemirror/view',
            '@codemirror/commands',
            '@codemirror/lang-sql',
            '@codemirror/autocomplete',
            '@codemirror/language',
          ],
        },
      },
    },
  },
});
