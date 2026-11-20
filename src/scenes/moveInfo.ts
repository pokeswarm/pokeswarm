import { generated } from '../data';
import { localName } from '../data/simRules';
import { getLocale, t, tMaybe } from '../i18n';
import type { MoveStats, SimMoveDef } from '../sim/moves';
import type { SimRules } from '../sim/rules';
import { modifierLinesOf } from './levelUpPanel';

/**
 * 技の説明（わざ図鑑の技の詳細。07 の263章）: ダメージのほかに何が起こるかを、技の定義から 1 行ずつの文にする。
 * 文はデータから作るので、数値を変えても書き直さなくてよい。ゲームの中で、ダメージ以外の効き目を見られる唯一の場所
 */

/** 最初の Lv と最大の Lv で比べる数値（変わらないものは 1 つだけ出す） */
const STATS: { key: keyof MoveStats; seconds?: boolean }[] = [
  { key: 'power' },
  { key: 'cooldownSeconds', seconds: true },
  { key: 'count' },
  { key: 'range' },
  { key: 'size' },
  { key: 'durationSeconds', seconds: true },
  { key: 'pierce' },
];

const round = (v: number): number => Math.round(v * 100) / 100;
const pct = (v: number): number => Math.round(v * 100);

function statText(v: number, seconds: boolean): string {
  if (!Number.isFinite(v)) return t('info.infinite');
  return seconds ? t('info.seconds', { v: round(v) }) : String(round(v));
}

/** 数値の表: [名前, Lv1 の値, 最大 Lv の値（同じなら null）] */
export function moveStatRows(def: SimMoveDef): [string, string, string | null][] {
  const a = def.levels[0]!;
  const b = def.levels[def.levels.length - 1]!;
  const rows: [string, string, string | null][] = [];
  if (def.passive.length > 0 || def.harmless || def.pattern === 'metronome') return rows;
  for (const s of STATS) {
    const x = a[s.key];
    const y = b[s.key];
    // 出し方に関係しない数（速さ 0 の技の数など）は出さない
    if (s.key === 'range' && !x && !y) continue;
    if (s.key === 'durationSeconds' && def.pattern === 'nearest' && x === y) continue;
    const xs = statText(x, !!s.seconds);
    const ys = statText(y, !!s.seconds);
    rows.push([t(`info.stat.${s.key}` as Parameters<typeof t>[0]), xs, xs === ys ? null : ys]);
  }
  return rows;
}

function typeName(rules: SimRules, type: number): string {
  const key = rules.types.names[type] ?? '';
  return localName(generated.types[key]?.names, getLocale(), key);
}

function statusName(rules: SimRules, status: number): string {
  const id = rules.status.kinds[status]?.id ?? '';
  return tMaybe(`status.${id}`) || id;
}

/** 状態異常が何をするか（data/game/status.json の数値から） */
function statusDesc(rules: SimRules, status: number): string {
  const k = rules.status.kinds[status];
  if (!k) return '';
  const parts: string[] = [];
  if (k.speedMultiplier === 0) parts.push(t('info.st.stop'));
  else if (k.speedMultiplier < 1) parts.push(t('info.st.slow', { v: pct(1 - k.speedMultiplier) }));
  if (k.damagePerSecond > 0) parts.push(t(k.healsAttacker ? 'info.st.drain' : 'info.st.dot'));
  if (k.damageTakenMultiplier > 1) parts.push(t('info.st.weak', { v: pct(k.damageTakenMultiplier - 1) }));
  if (k.contactDamageMultiplier !== undefined && k.contactDamageMultiplier < 1) parts.push(t('info.st.soft', { v: pct(1 - k.contactDamageMultiplier) }));
  if (k.flees) parts.push(t('info.st.flee'));
  if (k.breaksOnDamage) parts.push(t('info.st.wake'));
  if (k.notOnBoss) parts.push(t('info.st.notBoss'));
  return parts.join(t('info.listSep'));
}

/** 効き方の部品（moves.json の effects）を 1 行に */
function effectLine(e: SimMoveDef['effects'][number]): string | null {
  const what = e.pickup
    ? t('info.do.pickup')
    : e.explode
      ? t(e.trigger === 'hurt' ? 'info.do.explodeHurt' : 'info.do.explode')
      : e.puddle
        ? t('info.do.puddle')
        : e.split
          ? t('info.do.split', { v: e.split.count })
          : e.chain
            ? t('info.do.chain', { v: e.chain.count })
            : e.orbit
              ? t('info.do.orbit', { v: e.orbit.count })
              : e.spikes
                ? t('info.do.spikes', { v: e.spikes.count })
                : e.cluster
                  ? t('info.do.cluster', { v: e.cluster.count })
                  : e.crack
                    ? t('info.do.crack', { v: e.crack.count })
                    : e.wave
                      ? t('info.do.wave')
                      : null;
  if (!what) return null;
  const when = e.trigger === 'every' ? t('info.when.every', { v: round(e.everySeconds ?? 1) }) : t(`info.when.${e.trigger}` as Parameters<typeof t>[0]);
  const chance = e.chance !== undefined && e.chance < 1 ? t('info.chance', { v: pct(e.chance) }) : '';
  return t('info.effectLine', { when, chance, what });
}

/** 技の効き目（ダメージのほかに起こること）を 1 行ずつ。いつも効く技は効果の一覧 */
export function moveInfoLines(rules: SimRules, def: SimMoveDef): string[] {
  const out: string[] = [];
  const max = def.levels[def.levels.length - 1]!;
  const first = def.levels[0]!;
  const range = (f: (s: MoveStats) => number, scale = 1): string => {
    const a = round(f(first) * scale);
    const b = round(f(max) * scale);
    return a === b ? String(b) : `${a} → ${b}`;
  };
  if (def.passive.length > 0) {
    const mods = modifierLinesOf(rules, def.passive[def.passive.length - 1]!);
    if (mods.length) {
      out.push(def.hurtBuffSeconds ? t('info.hurtBuff', { seconds: def.hurtBuffSeconds }) : t('info.passive'));
      out.push(...mods.map((l) => `・${l}`));
      // つるぎのまい: シルクのスカーフ（ノーマルの強化）で効果が上がる（07 の324章）
      if (def.passiveScalesWithType) {
        const typeKey = rules.types.names[def.type] ?? '';
        out.push(`・${t('info.passiveTypeScaled', { type: localName(generated.types[typeKey]?.names, getLocale(), typeKey) })}`);
      }
    }
    if (def.pledge) out.push(t('info.pledge', { v: def.pledge.powerPct, o: def.pledge.perOtherPct }));
    return out;
  }
  if (def.pattern === 'metronome') out.push(t('info.metronome'));
  if (def.sequence?.length) out.push(t('info.sequence'));
  if (def.harmless) out.push(t('info.harmless'));
  if (def.onlyWhileAsleep) out.push(t('info.onlyAsleep'));
  if (def.randomStatuses.length > 0) {
    out.push(t('info.randomStatus', { chance: range((s) => s.statusChance, 100), list: def.randomStatuses.map((s) => statusName(rules, s)).join(t('info.listSep')), seconds: round(max.statusSeconds) }));
  } else if (max.status >= 0 && max.statusChance > 0) {
    out.push(t('info.status', { chance: range((s) => s.statusChance, 100), status: statusName(rules, max.status), seconds: round(max.statusSeconds) }));
  }
  const statuses = new Set<number>(def.randomStatuses.length ? def.randomStatuses : max.status >= 0 && max.statusChance > 0 ? [max.status] : []);
  for (const s of statuses) {
    const desc = statusDesc(rules, s);
    if (desc) out.push(`・${statusName(rules, s)}: ${desc}`);
  }
  if (max.lifestealPct > 0) out.push(t('info.lifesteal', { v: range((s) => s.lifestealPct) }));
  if (max.healPct > 0) out.push(t(def.healZone ? 'info.healZone' : 'info.heal', { v: range((s) => s.healPct) }));
  if (def.allyHealPct) out.push(t('info.allyHeal', { v: def.allyHealPct }));
  if (max.guardPct > 0) out.push(t('info.guard', { v: range((s) => s.guardPct), seconds: round(max.durationSeconds) }));
  if (max.critChancePct > 0) out.push(t('info.crit', { v: range((s) => s.critChancePct) }));
  if (max.instakillChance > 0) out.push(t('info.instakill', { v: range((s) => s.instakillChance, 100) }));
  if (max.statusBonusPct > 0) out.push(t('info.statusBonus', { v: range((s) => s.statusBonusPct) }));
  if (max.perMovePowerPct > 0) out.push(t('info.perMove', { v: range((s) => s.perMovePowerPct) }));
  if (def.lowHpBonus) out.push(t('info.lowHp', { threshold: def.lowHpBonus.thresholdPct, v: def.lowHpBonus.powerPct }));
  if (def.echo) out.push(t('info.echo', { v: def.echo.maxStacks }));
  if (def.growOnHit) out.push(t('info.grow', { v: def.growOnHit.maxMultiplier }));
  if (def.magnitude) out.push(t('info.magnitude'));
  if (def.aimStrongest) out.push(t('info.aimStrongest'));
  if (def.stopOnBoss) out.push(t('info.stopOnBoss'));
  if (def.groundOnly) out.push(t('info.groundOnly'));
  if (def.delayedBlast) out.push(t('info.delayedBlast', { seconds: def.delayedBlast.seconds }));
  if (def.dash) out.push(t(def.dash.invincible ? 'info.dashInvincible' : 'info.dash'));
  if (def.chargeWhileMoving) out.push(t('info.chargeMoving'));
  if (def.speedScale) out.push(t('info.speedScale'));
  if (def.burstCountMin) out.push(t('info.burstCount', { min: def.burstCountMin }));
  if (def.hurtRelease) out.push(t('info.hurtRelease'));
  if (def.rainBoost) out.push(t('info.rainBoost', { type: typeName(rules, def.rainBoost.type), v: def.rainBoost.pct }));
  if (def.pledge) out.push(t('info.pledge', { v: def.pledge.powerPct, o: def.pledge.perOtherPct }));
  for (const x of def.extraTypes ?? []) out.push(t('info.extraType', { type: typeName(rules, x) }));
  if (def.coinGain) { const c = def.coinGain; out.push(t('info.coin', { v: c.perLevel ? `${round(c.perUse)} → ${round(c.perUse + c.perLevel * (def.levels.length - 1))}` : round(c.perUse) })); }
  if (def.hpCost) out.push(t(def.hpCost.onHit ? 'info.hpRecoil' : 'info.hpCost', { pct: def.hpCost.pct, min: def.hpCost.minHpPct }));
  if (def.selfBuff) {
    out.push(t('info.selfBuff', { seconds: def.selfBuff.seconds }));
    out.push(...modifierLinesOf(rules, def.selfBuff.mods).map((l) => `・${l}`));
  }
  const seen = new Set<string>();
  for (const e of def.effects) {
    const line = effectLine(e);
    if (line && !seen.has(line)) {
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}
