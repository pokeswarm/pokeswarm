import { describe, expect, it } from 'vitest';
import ja from './ja.json';
import en from './en.json';
import fr from './fr.json';
import de from './de.json';
import es from './es.json';
import itMessages from './it.json';

/** 訳さなくてよい文（開発用の表示） */
const untranslated = (key: string): boolean => key.startsWith('debug.') || key.startsWith('net.role.') || key.startsWith('net.mode.');
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();

describe('翻訳（作者の決定: フランス語・ドイツ語・スペイン語・イタリア語を足す）', () => {
  it('英語は日本語とすべて同じ文がそろう', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });

  for (const [lang, messages] of [['fr', fr], ['de', de], ['es', es], ['it', itMessages]] as const) {
    it(`${lang}: 開発用の表示のほかは、すべての文があり、{ } の差し込みが英語と同じ`, () => {
      const m = messages as Record<string, string>;
      const missing = Object.keys(en).filter((k) => !untranslated(k) && !(k in m));
      expect(missing, `${lang} に無い文`).toEqual([]);
      const extra = Object.keys(m).filter((k) => !(k in en));
      expect(extra, `${lang} にだけある文`).toEqual([]);
      for (const [k, v] of Object.entries(m)) expect(placeholders(v), `${lang} ${k}`).toEqual(placeholders((en as Record<string, string>)[k]!));
    });
  }
});
