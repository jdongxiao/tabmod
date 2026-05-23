import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json' with { type: 'json' };
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        popup: 'src/popup/popup.html',
        onboarding: 'src/popup/onboarding.html',
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
