import { describe, expect, it } from 'vitest';
import { buildSimRules } from '../data/simRules';
import { shownDamageClass } from './levelUpPanel';

/** 技の種類（ぶつり／とくしゅ）の札は、ダメージを出す技にだけ出す（07 の267章） */
describe('技の種類の札', () => {
  const rules = buildSimRules('hoenn');
  const def = (key: string) => rules.moves.find((m) => m.key === key)!;

  it('いつも効く技・ねむる・ゆびをふる・ダメージの無い技には出さない', () => {
    for (const key of ['swords-dance', 'iron-defense', 'agility', 'fire-pledge', 'facade', 'rest', 'metronome', 'mimic', 'milk-drink']) {
      expect(shownDamageClass(def(key)), key).toBeNull();
    }
  });

  it('ダメージを出す技には今までどおり出す', () => {
    expect(shownDamageClass(def('ember'))).toBe('special');
    expect(shownDamageClass(def('scratch'))).toBe('physical');
    // 原作では変化技でも、ダメージを出す技（ステルスロック）は出す
    expect(shownDamageClass(def('stealth-rock'))).not.toBeNull();
  });
});
