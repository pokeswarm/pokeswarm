import Phaser from 'phaser';
import { uiConfig } from '../data';
import { DMG_CRIT, DMG_NOT_VERY, DMG_STAB, DMG_SUPER, type DamageNumberEvent } from '../sim/events';
import { hexColor } from './color';

const FONT_KEY = 'damage-digits';

interface Slot {
  text: Phaser.GameObjects.BitmapText;
  enemyId: number;
  amount: number;
  flags: number;
  /** 出した時刻（ms）と、最後に足した時刻（ms） */
  bornAt: number;
  mergedAt: number;
  x: number;
  y: number;
  active: boolean;
}

/**
 * 細いドットの字（data/render/ui.json の glyphs。1点 = 1画素）で数字と「!」の画像を作り、レトロフォントとして登録する。
 * 白い字のまわりに1点の黒い縁。色は tint で付け、大きさは拡大で（ドット絵向けの拡大なのでにじまない）
 */
function ensureFont(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(FONT_KEY)) return;
  const glyphs = uiConfig.damageNumbers.glyphs;
  const chars = Object.keys(glyphs).join('');
  const rows = glyphs[chars[0]!]!;
  const cellW = rows[0]!.length + 2;
  const cellH = rows.length + 2;
  const tex = scene.textures.createCanvas(FONT_KEY, cellW * chars.length, cellH);
  if (!tex) return;
  const ctx = tex.getContext();
  for (const [pass, color] of [[0, '#000000'], [1, '#ffffff']] as const) {
    ctx.fillStyle = color;
    for (let k = 0; k < chars.length; k++) {
      glyphs[chars[k]!]!.forEach((row, y) => {
        for (let x = 0; x < row.length; x++) {
          if (row[x] !== '#') continue;
          // 縁: 点のまわり 3×3 を黒で塗ってから、点を白で重ねる
          if (pass === 0) ctx.fillRect(k * cellW + x, y, 3, 3);
          else ctx.fillRect(k * cellW + x + 1, y + 1, 1, 1);
        }
      });
    }
  }
  tex.refresh();
  const data = Phaser.GameObjects.RetroFont.Parse(scene, {
    image: FONT_KEY,
    width: cellW,
    height: cellH,
    chars,
    charsPerRow: chars.length,
    'spacing.x': 0,
    'spacing.y': 0,
    'offset.x': 0,
    'offset.y': 0,
    lineSpacing: 0,
  });
  scene.cache.bitmapFont.add(FONT_KEY, data);
}

/**
 * 自分の攻撃のダメージの数字（設定でオン。07 の102章）。
 * 数字は先に作った決まった数（maxActive）を使い回す。同じ敵に続けて当たった分は1つの数字に足す。
 * 色はタイプ相性、タイプ一致は少し大きく、きゅうしょは「!」を付けて大きく
 */
export class DamageNumbers {
  private readonly slots: Slot[] = [];
  /** 敵 id → 出ている数字（足すため） */
  private readonly byEnemy = new Map<number, Slot>();
  private readonly cfg = uiConfig.damageNumbers;
  private readonly colors = {
    normal: hexColor(this.cfg.colors.normal),
    super: hexColor(this.cfg.colors.superEffective),
    notVery: hexColor(this.cfg.colors.notVeryEffective),
  };

  constructor(scene: Phaser.Scene, depth: number) {
    ensureFont(scene);
    for (let k = 0; k < this.cfg.maxActive; k++) {
      const text = scene.add.bitmapText(0, 0, FONT_KEY, '').setLetterSpacing(-1).setOrigin(0.5, 1).setDepth(depth).setVisible(false);
      this.slots.push({ text, enemyId: -1, amount: 0, flags: 0, bornAt: 0, mergedAt: 0, x: 0, y: 0, active: false });
    }
  }

  add(ev: DamageNumberEvent, now: number): void {
    const merging = this.byEnemy.get(ev.enemyId);
    if (merging && merging.active && now - merging.mergedAt <= this.cfg.mergeSeconds * 1000) {
      merging.amount += ev.amount;
      merging.flags |= ev.flags;
      merging.mergedAt = now;
      merging.bornAt = now;
      merging.x = ev.x;
      merging.y = ev.y;
      this.paint(merging);
      return;
    }
    const slot = this.slots.find((s) => !s.active) ?? this.evict(ev.flags);
    if (!slot) return;
    if (slot.active && this.byEnemy.get(slot.enemyId) === slot) this.byEnemy.delete(slot.enemyId);
    Object.assign(slot, { enemyId: ev.enemyId, amount: ev.amount, flags: ev.flags, bornAt: now, mergedAt: now, x: ev.x, y: ev.y, active: true });
    this.byEnemy.set(ev.enemyId, slot);
    slot.text.setVisible(true);
    this.paint(slot);
  }

  /** あふれたとき: ばつぐん・きゅうしょなら、いちばん古いふつうの数字と入れ替える（ふつうの数字は出さない） */
  private evict(flags: number): Slot | undefined {
    if (!(flags & (DMG_SUPER | DMG_CRIT))) return undefined;
    let oldest: Slot | undefined;
    for (const s of this.slots) if (!(s.flags & (DMG_SUPER | DMG_CRIT)) && (!oldest || s.bornAt < oldest.bornAt)) oldest = s;
    return oldest;
  }

  private paint(s: Slot): void {
    const f = s.flags;
    const n = Math.max(1, Math.round(s.amount));
    s.text.setText(f & DMG_CRIT ? `${n}!` : String(n));
    s.text.setTint(f & DMG_SUPER ? this.colors.super : f & DMG_NOT_VERY ? this.colors.notVery : this.colors.normal);
    // 大きさは整数の倍率にそろえる（ドットの大きさがばらつかないように）
    s.text.setScale(Math.max(1, Math.round(this.cfg.scale * (f & DMG_STAB ? this.cfg.stabScale : 1) * (f & DMG_CRIT ? this.cfg.critScale : 1))));
  }

  /** 毎フレーム: 上へ動かし、終わりに近づいたら薄くし、時間が来たら片づける */
  update(now: number): void {
    const life = this.cfg.lifeSeconds * 1000;
    for (const s of this.slots) {
      if (!s.active) continue;
      const k = (now - s.bornAt) / life;
      if (k >= 1) {
        s.active = false;
        s.text.setVisible(false);
        if (this.byEnemy.get(s.enemyId) === s) this.byEnemy.delete(s.enemyId);
        continue;
      }
      s.text.setPosition(s.x, s.y - 10 - this.cfg.risePixels * k).setAlpha(k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4);
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.active = false;
      s.text.setVisible(false);
    }
    this.byEnemy.clear();
  }
}
