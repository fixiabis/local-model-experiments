import { defineConfig } from 'vite';

export default defineConfig({
  base: '/local-model-experiments/chat-bot/',

  server: {
    headers: {
      // Dev server injects these directly; GitHub Pages uses coi-serviceworker.js instead
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
});
