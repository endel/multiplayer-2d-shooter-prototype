import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    wasm(),
    topLevelAwait()
  ],
  server: {
    allowedHosts: ['width-lol-sit-ending.trycloudflare.com'],
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'battle-royale': resolve(__dirname, 'battle-royale.html'),
        'rapier-demo': resolve(__dirname, 'rapier-demo.html'),
      },
    },
  },
});

