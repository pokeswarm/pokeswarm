import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generated, movesConfig, sfxConfig } from '../data';

describe('効果音のデータ', () => {
  it('技のタイプごとに、技を使う音がある', () => {
    for (const key of Object.keys(movesConfig.moves)) {
      const type = generated.moves[key]!.type;
      expect(sfxConfig.sounds[`move.${type}`], `move.${type}（${key}）`).toBeDefined();
    }
  });

  it('コードで鳴らしている音は、すべて data/audio/sfx.json にある', () => {
    const files = ['src/audio/runSounds.ts', 'src/scenes/RunScene.ts', 'src/scenes/SettingsScene.ts'];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/sfx\.play\('([^'`]+)'/g)) expect(sfxConfig.sounds[m[1]!], `${f}: ${m[1]}`).toBeDefined();
    }
  });
});
