import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** バージョン（package.json。タイトル画面に出す。0.<フェーズ>.<修正>、カントーが完成したら 1.0.0。06_roadmap.md） */
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

export default defineConfig(({ mode }) => ({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      // 開発サーバーは起動した時の版を出し続けるので、package.json が変わったら起動し直す（作者の指摘 2026年10月28日: localhost が v0.5.2 のままだった）
      name: 'restart-on-version-change',
      configureServer(server) {
        const pkg = fileURLToPath(new URL('./package.json', import.meta.url));
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
