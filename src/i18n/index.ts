import ja from './ja.json';
import en from './en.json';
import fr from './fr.json';
import de from './de.json';
import es from './es.json';
import it from './it.json';

/** ゲーム独自の文章の翻訳。キーは ja.json を基準にする */
export type MessageKey = keyof typeof ja;
export type Locale = 'ja' | 'en' | 'fr' | 'de' | 'es' | 'it';

/**
 * 日本語・英語はすべての文がそろう。フランス語・ドイツ語・スペイン語・イタリア語は Claude が英語から訳した（作者の決定 2026年10月22日）。
 * 開発用の表示（F3 の詳しい表示など）は訳さず、無い文は英語 → 日本語の順に使う
 */
const messages: Record<Locale, Partial<Record<MessageKey, string>>> = { ja, en, fr, de, es, it };

/** 設定画面で選んだ言語を覚えておく場所（ブラウザに保存する） */
const STORAGE_KEY = 'pokeswarm.locale';
/** 選べる言語（設定画面に並べる順） */
export const LOCALES: readonly Locale[] = ['ja', 'en', 'fr', 'de', 'es', 'it'];

let current: Locale = detectLocale();

/** 設定画面で選んだ言語。選んでいなければブラウザの言語（日本語でなければ英語） */
function detectLocale(): Locale {
  try {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // 保存できないブラウザ（プライベートモードなど）では、ブラウザの言語を使う
  }
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'ja').toLowerCase().slice(0, 2);
  return (LOCALES as readonly string[]).includes(lang) ? (lang as Locale) : 'en';
}

export function getLocale(): Locale {
  return current;
}

/** 言語を変える（設定画面）。次に開いたときも同じ言語になるよう、ブラウザに保存する */
export function setLocale(locale: Locale): void {
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // 保存できなくても、今の間は切り替わる
  }
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = messages[current][key] ?? messages.en[key] ?? messages.ja[key]!;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** キーを組み立てて引くとき用（例: `itemDesc.${key}`）。無いキーなら空文字 */
export function tMaybe(key: string, params?: Record<string, string | number>): string {
  if (!(key in messages.ja)) return '';
  return t(key as MessageKey, params);
}
