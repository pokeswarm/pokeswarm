import type { PlayerId } from '../commands';
import type { Player } from '../entities/player';
import { deriveStats } from '../species';
import { addModifiers, emptyModifiers } from '../upgrades';
import { checkEvolution } from './evolution';
import type { SimDerivation } from '../upgrades';
import type { UpgradeOffer, World } from '../world';

/**
 * 経験値を足し、必要な分が貯まったらレベルを上げる（経験値とレベルは全員で共有。01_game_design.md 3.1）。
 * 上がった回数だけ、後でレベルアップの選択を行う。
 */
export function addXp(world: World, amount: number): void {
  const cfg = world.rules.leveling;
  world.xp += amount;
  if (world.level >= cfg.maxLevel) return;
  world.xpIntoLevel += amount;
  while (world.level < cfg.maxLevel && world.xpIntoLevel >= cfg.xpToNext[world.level]!) {
    world.xpIntoLevel -= cfg.xpToNext[world.level]!;
    world.level++;
    world.pendingLevelUps++;
    world.events.push({ type: 'levelUp', level: world.level });
  }
  if (world.level >= cfg.maxLevel) world.xpIntoLevel = 0;
  // レベルでステータスが伸びる
  for (const p of world.players) recomputeModifiers(world, p);
}

/**
 * 選択を待っているレベルアップがあれば、選択を始める（ゲームを止める）。
 * 協力プレイでの全員同時のレベルアップと候補の配布はフェーズ3で作るので、今はソロだけ選択を行う。
 */
export function openLevelUpIfPending(world: World): void {
  if (world.levelUp || world.pendingLevelUps === 0) return;
  if (world.role !== 'solo') {
    world.pendingLevelUps = 0;
    return;
  }
  const offers = new Map<PlayerId, UpgradeOffer[]>();
  for (const p of world.players) offers.set(p.id, makeOffers(world, p));
  world.levelUp = {
    level: world.level - world.pendingLevelUps + 1,
    offers,
    done: new Set(),
    ticksLeft: Math.round(world.rules.leveling.choiceSeconds / world.dt),
  };
}

/** 選択中の1回分の更新: 時間を進め、全員が選び終えるか時間切れなら閉じる */
export function stepLevelUp(world: World): void {
  const lu = world.levelUp;
  if (!lu) return;
  lu.ticksLeft--;
  const allDone = world.players.every((p) => lu.done.has(p.id));
  if (!allDone && lu.ticksLeft > 0) return;
  // 時間切れは「見送る」と同じ扱い（リロール権 +1）
  for (const p of world.players) if (!lu.done.has(p.id)) p.rerolls++;
  world.levelUp = null;
  world.pendingLevelUps--;
  if (world.pendingLevelUps > 0) {
    openLevelUpIfPending(world);
    return;
  }
  // 再開時に全員へごく短い無敵時間
  const ticks = Math.round(world.rules.leveling.resumeInvincibleSeconds / world.dt);
  for (const p of world.players) p.invincibleTicks = Math.max(p.invincibleTicks, ticks);
}

export function chooseUpgrade(world: World, playerId: PlayerId, index: number): void {
  const lu = world.levelUp;
  const p = world.players.find((x) => x.id === playerId);
  if (!lu || !p || lu.done.has(playerId)) return;
  const offer = lu.offers.get(playerId)?.[index];
  if (!offer) return;
  applyOffer(world, p, offer);
  lu.done.add(playerId);
}

export function skipUpgrade(world: World, playerId: PlayerId): void {
  const lu = world.levelUp;
  const p = world.players.find((x) => x.id === playerId);
  if (!lu || !p || lu.done.has(playerId)) return;
  p.rerolls++;
  lu.done.add(playerId);
}

export function rerollUpgrades(world: World, playerId: PlayerId): void {
  const lu = world.levelUp;
  const p = world.players.find((x) => x.id === playerId);
  if (!lu || !p || lu.done.has(playerId) || p.rerolls <= 0) return;
  p.rerolls--;
  lu.offers.set(playerId, makeOffers(world, p));
}

/** 派生していない技（タイプの技）かどうか。派生先・固有技は候補に直接は出さない */
function isBaseMove(world: World, move: number): boolean {
  return !world.rules.derivations.some((d) => d.to === move);
}

/**
 * 候補を作る（01_game_design.md 3.2・3.3、4.2）。
 * - 派生・固有技の条件（元の技が最大レベル ＋ 材料の持ち物）がそろっていれば必ず出す
 * - 残りは、技（自分のタイプとノーマル。枠が空いていれば新しい技、覚えている技の強化）・持ち物（誰かが持っているものは出さない）・パッシブから選ぶ
 */
export function makeOffers(world: World, p: Player): UpgradeOffer[] {
  const rules = world.rules;
  const count = rules.leveling.offerCount;
  const guaranteed: UpgradeOffer[] = [];
  p.moves.forEach((pm, slot) => {
    if (pm.level < rules.moves[pm.move]!.levels.length) return;
    for (const d of rules.derivations) {
      if (d.from !== pm.move || !p.items.some((it) => it.item === d.item)) continue;
      if (d.line !== null && d.line !== p.line) continue;
      if (p.moves.some((m) => m.move === d.to)) continue;
      guaranteed.push({ kind: 'derive', slot, to: d.to, item: d.item, unique: d.line !== null });
    }
  });

  const pool: UpgradeOffer[] = [];
  const normal = rules.types.names.indexOf('normal');
  p.moves.forEach((pm, slot) => {
    if (pm.level < rules.moves[pm.move]!.levels.length) pool.push({ kind: 'moveUp', slot });
  });
  if (p.moves.length < rules.combat.maxMoveSlots) {
    rules.moves.forEach((m, move) => {
      if (!isBaseMove(world, move) || p.moves.some((pm) => pm.move === move)) return;
      if (m.type === normal || p.types.includes(m.type)) pool.push({ kind: 'moveNew', move });
    });
  }
  p.items.forEach((it, slot) => {
    if (it.level < rules.items[it.item]!.maxLevel) pool.push({ kind: 'itemUp', slot });
  });
  if (p.items.length < rules.leveling.maxItemSlots) {
    rules.items.forEach((_, item) => {
      // 協力プレイ: 誰かがすでに持っている持ち物は候補に出さない
      if (world.players.some((q) => q.items.some((it) => it.item === item))) return;
      pool.push({ kind: 'itemNew', item });
    });
  }
  rules.passives.forEach((def, passive) => {
    const owned = p.passives.findIndex((x) => x.passive === passive);
    if (owned === -1) pool.push({ kind: 'passiveNew', passive });
    else if (p.passives[owned]!.level < def.maxLevel) pool.push({ kind: 'passiveUp', slot: owned });
  });

  // 必ず出すものを先に、残りは乱数で選ぶ（シード付きの乱数なので再現できる）
  const out = guaranteed.slice(0, count);
  while (out.length < count && pool.length > 0) {
    out.push(pool.splice(world.rng.int(pool.length), 1)[0]!);
  }
  return out;
}

export function applyOffer(world: World, p: Player, offer: UpgradeOffer): void {
  switch (offer.kind) {
    case 'moveNew':
      p.moves.push({ move: offer.move, level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 });
      break;
    case 'moveUp':
      p.moves[offer.slot]!.level++;
      break;
    case 'itemNew':
      p.items.push({ item: offer.item, level: 1 });
      break;
    case 'itemUp':
      p.items[offer.slot]!.level++;
      break;
    case 'passiveNew':
      p.passives.push({ passive: offer.passive, level: 1 });
      break;
    case 'passiveUp':
      p.passives[offer.slot]!.level++;
      break;
    case 'derive': {
      p.moves[offer.slot] = { move: offer.to, level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 };
      // 進化の石などは使うとなくなる（持ち物の枠が空く）
      if (world.rules.items[offer.item]!.consumable) p.items = p.items.filter((it) => it.item !== offer.item);
      break;
    }
  }
  world.events.push({ type: 'upgradeChosen', playerId: p.id, offer });
  recomputeModifiers(world, p);
  // 石を取ったら進化することがある（イーブイなど）
  checkEvolution(world, p);
}

/**
 * ステータスを作り直す: 種族値のランク・レベル（01_game_design.md 5.1）と、持ち物・パッシブの効果を合わせる。
 * 最大HPが増えた分は今の HP にも足す。
 */
export function recomputeModifiers(world: World, p: Player): void {
  const mods = emptyModifiers(world.rules.types.names.length);
  for (const it of p.items) addModifiers(mods, world.rules.items[it.item]!.perLevel, it.level);
  for (const ps of p.passives) addModifiers(mods, world.rules.passives[ps.passive]!.perLevel, ps.level);
  p.mods = mods;
  const sp = world.rules.species[p.species];
  const d = sp ? deriveStats(world.rules.stats, sp, world.level) : null;
  const oldMax = p.maxHp;
  p.maxHp = (d?.maxHp ?? 100) * Math.max(0.1, 1 + mods.maxHpPct / 100);
  if (p.maxHp > oldMax && !p.down) p.hp += p.maxHp - oldMax;
  p.hp = Math.min(p.hp, p.maxHp);
  p.physicalPower = d?.physicalPower ?? 1;
  p.specialPower = d?.specialPower ?? 1;
  p.defense = (d?.defense ?? 0) * Math.max(0, 1 + mods.defensePct / 100);
  p.moveSpeed = p.baseMoveSpeed * (d?.speed ?? 1) * (1 + mods.moveSpeedPct / 100);
  p.pickupRange = p.basePickupRange * (1 + mods.pickupRangePct / 100);
}

/**
 * この候補を取ると、派生（固有技を含む）の条件がそろうなら、その派生を返す（そろわなければ null）。
 * 選択画面で「進化できる！」を出すかの判定に使う（出すのは、以前に達成したことのある派生だけ）。
 */
export function derivationCompletedBy(world: World, p: Player, offer: UpgradeOffer): SimDerivation | null {
  const rules = world.rules;
  const maxOf = (move: number): number => rules.moves[move]!.levels.length;
  const lineOk = (d: SimDerivation): boolean => d.line === null || d.line === p.line;
  const notYet = (d: SimDerivation): boolean => !p.moves.some((m) => m.move === d.to);
  for (const d of rules.derivations) {
    if (!lineOk(d) || !notYet(d)) continue;
    const hasItem = p.items.some((it) => it.item === d.item);
    const fromAtMax = p.moves.some((m) => m.move === d.from && m.level >= maxOf(d.from));
    switch (offer.kind) {
      case 'itemNew':
        if (offer.item === d.item && fromAtMax) return d;
        break;
      case 'moveUp': {
        const pm = p.moves[offer.slot]!;
        if (pm.move === d.from && pm.level + 1 >= maxOf(d.from) && hasItem) return d;
        break;
      }
      case 'moveNew':
        if (offer.move === d.from && maxOf(d.from) <= 1 && hasItem) return d;
        break;
      default:
        break;
    }
  }
  return null;
}
