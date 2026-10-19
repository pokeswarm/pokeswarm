import ja from './ja.json';
import en from './en.json';

/** ゲーム独自の文章の翻訳。キーは ja.json を基準にする */
export type MessageKey = keyof typeof ja;
export type Locale = 'ja' | 'en';

const messages: Record<Locale, Record<MessageKey, string>> = { ja, en };

let current: Locale = detectLocale();

function detectLocale(): Locale {
  const lang = typeof navigator !== 'undefined' ? navigator.language : 'ja';
  return lang.toLowerCase().startsWith('ja') ? 'ja' : 'en';
}

export function setLocale(locale: Locale): void {
  current = locale;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = messages[current][key] ?? messages.ja[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
