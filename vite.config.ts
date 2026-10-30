import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** 版（data/site.json の appVersion。タイトル画面に出す。0.<地方>.<追加>.<修正>。06_roadmap.md 1章） */
const version = (JSON.parse(readFileSync(new URL('./data/site.json', import.meta.url), 'utf8')) as { appVersion: string }).appVersion;

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      // 開発サーバーは起動した時の版を出し続けるので、site.json が変わったら起動し直す（作者の指摘 2026年10月28日: localhost が v0.5.2 のままだった）
      name: 'restart-on-version-change',
      configureServer(server) {
        const pkg = fileURLToPath(new URL('./data/site.json', import.meta.url));
        server.watcher.add(pkg);
        server.watcher.on('change', (file) => {
          if (resolve(file) === resolve(pkg)) void server.restart();
        });
      },
    },
  ],
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
