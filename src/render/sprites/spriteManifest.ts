import { spriteAnimsSchema, type SpriteAnims } from '../../data/schema';

export function spriteBaseUrl(key: string): string {
  return `${import.meta.env.BASE_URL}sprites/${key}/`;
}

/**
 * public/sprites/<key>/anims.json を読む。
 * スプライトは npm run sprites で取得するもので、無い環境（公開版など）もあるため、無ければ null を返す。
 */
export async function loadSpriteManifest(key: string): Promise<SpriteAnims | null> {
  try {
    const res = await fetch(`${spriteBaseUrl(key)}anims.json`);
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return null;
    const parsed = spriteAnimsSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(`sprites/${key}/anims.json の形式が正しくありません`, parsed.error);
      return null;
    }
    for (const m of parsed.data.missing) {
      console.warn(`[sprites] ${key}: 動作 ${m.animation} が欠けています（代わり: ${m.usedInstead ?? 'なし'}）`);
    }
    return parsed.data;
  } catch {
    return null;
  }
}
