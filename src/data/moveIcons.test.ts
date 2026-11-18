import { describe, expect, it } from 'vitest';
import { moveIcons, movesConfig } from './index';

/**
 * 技を足したら、アイコンの絵も作る（作者の決まり 2026年11月15日。07 の265・266章、docs/09 の「技のアイコン」）。
 * 絵は npm run move-icons（scripts/make-move-icons.ts）が技の名前ごと（nameOf でまとめる）に作る
 */
describe('技のアイコン', () => {
  it('すべての技の名前に絵がある', () => {
    // 技のキーの絵があればそれ（名前を借りる技でも自分の絵を持てる。セレビィ・ライコウ）、無ければ名前（nameOf）の絵
    const missing = [...new Set(Object.entries(movesConfig.moves).filter(([key, def]) => !moveIcons.icons[key] && !moveIcons.icons[def.nameOf ?? key]).map(([key, def]) => def.nameOf ?? key))];
    expect(missing, `アイコンの絵が無い技（npm run move-icons を回す。止まったら ICONS に描く）: ${missing.join(', ')}`).toEqual([]);
  });

  it('絵に黒の輪郭線の色を使わない（黒に近い色は描かない）', () => {
    const dark: string[] = [];
    for (const [name, art] of Object.entries(moveIcons.icons)) {
      for (const c of art.palette) {
        const n = parseInt(c.slice(1), 16);
        const l = (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
        if (l < 0.06) dark.push(`${name} ${c}`);
      }
    }
    expect(dark).toEqual([]);
  });
});
