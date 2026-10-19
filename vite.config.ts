import { defineConfig } from 'vite';

export default defineConfig({
  // Cloudflare Pages はルートで配信するので base は既定のまま
  build: {
    target: 'es2022',
    // Phaser 本体が大きいため、警告の閾値だけ上げる
    chunkSizeWarningLimit: 2000,
  },
});
