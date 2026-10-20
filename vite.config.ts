import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Cloudflare Workers の静的アセット配信はルートで配信するので base は既定のまま
  build: {
    target: 'es2022',
    // Phaser 本体が大きいため、警告の閾値だけ上げる
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // 処理時間の計測（*.perf.ts）は npm run bench、1ランの通し（*.balance.ts）は npm run balance のときだけ動かす
    include: mode === 'bench' ? ['src/**/*.perf.ts'] : mode === 'balance' ? ['src/**/*.balance.ts'] : ['src/**/*.test.ts'],
  },
}));
