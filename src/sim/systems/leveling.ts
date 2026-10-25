import type { LevelUpSnapshot, PlayerId } from '../commands';
import type { Player } from '../entities/player';
import { deriveStats } from '../species';
import { addModifiers, emptyModifiers, resolveModifiers } from '../upgrades';
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
  world.xpIntoLevel += amount;
  // 最大レベルの後も経験値を数え、たまるたびに回復かコインを選ぶ（表記は MAX のまま。作者の決定 2026年10月25日）
  if (world.level >= cfg.maxLevel) {
    const need = cfg.xpToNext[cfg.maxLevel]!;
    while (world.xpIntoLevel >= need) {
      world.xpIntoLevel -= need;
      world.pendingLevelUps++;
      world.maxLevelUps++;
      world.events.push({ type: 'levelUp', level: world.level });
    }
    return;
  }
  while (world.level < cfg.maxLevel && world.xpIntoLevel >= cfg.xpToNext[world.level]!) {
    world.xpIntoLevel -= cfg.xpToNext[world.level]!;
    world.level++;
    world.pendingLevelUps++;
    world.events.push({ type: 'levelUp', level: world.level });
  }
  // レベルでステータスが伸びる
  for (const p of world.players) recomputeModifiers(world, p);
}

/**
 * 選択を待っているレベルアップがあれば、選択を始める（全員のゲームを止める。03_network.md 3.5）。
 * 候補はソロ・ホストが全員分を作る。同じ回で同じ持ち物を2人に出さない。
 * ゲストは自分では始めず、ホストから届く状態に合わせる（mirrorLevelUp）。
 */
export function openLevelUpIfPending(world: World): void {
  if (world.levelUp || world.pendingLevelUps === 0) return;
  if (world.role === 'guest') {
    world.pendingLevelUps = 0;
    world.maxLevelUps = 0;
    return;
  }
  // 全員分の候補をホストが作る（同じアイテムがほかの人の候補に出ていてもよい。作者の決定で重複を防ぐ決まりは廃止）
  // 先にレベルが上がった回を選び、最大レベルの後の回（回復とコインだけ）はその後
  const normal = world.pendingLevelUps - world.maxLevelUps;
  const overMax = normal <= 0;
  const offers = new Map<PlayerId, UpgradeOffer[]>();
  for (const p of world.players) offers.set(p.id, overMax ? [{ kind: 'heal' }, { kind: 'coins' }] : makeOffers(world, p));
  world.levelUp = {
    serial: ++world.levelUpSerial,
    level: overMax ? world.level : world.level - normal + 1,
    offers,
    done: new Set(),
    ticksLeft: Math.round(world.rules.leveling.choiceSeconds / world.dt),
    ...(overMax ? { overMax } : {}),
  };
}

/** 選択中の1回分の更新: 時間を進め、全員が選び終えるか時間切れなら閉じる */
export function stepLevelUp(world: World): void {
  const lu = world.levelUp;
  if (!lu) return;
  lu.ticksLeft--;
  // ゲストは閉じるのもホストに合わせる（残り時間は表示のために減らすだけ）
  if (world.role === 'guest') {
    lu.ticksLeft = Math.max(0, lu.ticksLeft);
    return;
  }
  const allDone = world.players.every((p) => lu.done.has(p.id));
  if (!allDone && lu.ticksLeft > 0) return;
  // 協力プレイで全員が選び終えたら、ほんの少しだけ間を取ってから再開する（時間切れはすぐ）
  if (allDone && world.players.length > 1) {
    lu.closingTicks ??= Math.round(world.rules.leveling.coopResumeDelaySeconds / world.dt);
    if (lu.closingTicks-- > 0) return;
  }
  // 時間切れは「見送る」と同じ扱い（リロール権 +1）
  for (const p of world.players) if (!lu.done.has(p.id)) p.rerolls++;
  if (lu.overMax) world.maxLevelUps--;
  world.levelUp = null;
  world.pendingLevelUps--;
  if (world.pendingLevelUps > 0) {
    openLevelUpIfPending(world);
    return;
  }
  resumeInvincible(world);
}

/** 再開時に全員へごく短い無敵時間 */
export function resumeInvincible(world: World): void {
  const ticks = Math.round(world.rules.leveling.resumeInvincibleSeconds / world.dt);
  for (const p of world.players) p.invincibleTicks = Math.max(p.invincibleTicks, ticks);
}

/** ホスト: 今のレベルアップの選択の状態（ゲストへ送る） */
export function levelUpSnapshot(world: World): LevelUpSnapshot | null {
  const lu = world.levelUp;
  if (!lu) return null;
  return {
    serial: lu.serial,
    level: lu.level,
    ticksLeft: lu.ticksLeft,
    offers: [...lu.offers.entries()],
    done: [...lu.done],
    rerolls: world.players.map((p) => [p.id, p.rerolls] as const),
    bans: world.players.map((p) => [p.id, p.bans] as const),
  };
}

/** ゲスト: ホストから届いたレベルアップの選択の状態に合わせる。閉じたら再開時の無敵時間を付ける */
export function mirrorLevelUp(world: World, s: LevelUpSnapshot | null): void {
  if (!s) {
    if (world.levelUp) {
      world.levelUp = null;
      resumeInvincible(world);
    }
    return;
  }
  // 新しい回（最大レベルの後は、閉じずに次の回へ続くことがある）
  const opening = !world.levelUp || world.levelUp.serial !== s.serial;
  world.levelUp = {
    serial: s.serial,
    level: s.level,
    ticksLeft: s.ticksLeft,
    offers: new Map(s.offers.map(([id, list]) => [id, [...list]])),
    done: new Set(s.done),
  };
  for (const [id, n] of s.rerolls) {
    const p = world.players.find((x) => x.id === id);
    if (p) p.rerolls = n;
  }
  for (const [id, n] of s.bans) {
    const p = world.players.find((x) => x.id === id);
    if (p) p.bans = n;
  }
  if (opening) world.events.push({ type: 'levelUp', level: s.level });
}

/** 選ぶ・見送る・リロールは、協力プレイではホストが確定する（ゲストは要望をホストへ送るだけ） */
export function chooseUpgrade(world: World, playerId: PlayerId, index: number): void {
  if (world.role === 'guest') return;
  const lu = world.levelUp;
  const p = world.players.find((x) => x.id === playerId);
  if (!lu || !p || lu.done.has(playerId)) return;
  const offer = lu.offers.get(playerId)?.[index];
  if (!offer) return;
  applyOffer(world, p, offer);
  lu.done.add(playerId);
}

export function skipUpgrade(world: World, playerId: PlayerId): void {
  if (world.role === 'guest') return;
  const lu = world.levelUp;
  const p = world.players.find((x) => x.id === playerId);
  if (!lu || !p || lu.done.has(playerId)) return;
  p.rerolls++;
  lu.done.add(playerId);
}

export function rerollUpgrades(world: World, playerId: PlayerId): void {
  if (world.role === 'guest') return;
  const lu = world.levelUp;
  const p = world.players.find((x) => x.id === playerId);
  if (!lu || !p || lu.done.has(playerId) || p.rerolls <= 0) return;
  p.rerolls--;
  lu.offers.set(playerId, makeOffers(world, p));
}

/**
 * 候補の除外（BAN。01_game_design.md 8.3）の対象を表す名前。技・持ち物・パッシブごと（新しく覚える・強化の両方）。
 * 派生・固有技は除外できない（null）
 */
export function banKey(p: Player, offer: UpgradeOffer): string | null {
  switch (offer.kind) {
    case 'moveNew':
      return `move:${offer.move}`;
    case 'moveUp':
      return `move:${p.moves[offer.slot]?.move}`;
    case 'itemNew':
      return `item:${offer.item}`;
    case 'itemUp':
      return `item:${p.items[offer.slot]?.item}`;
    default:
      return null;
  }
}

/**
 * 候補を除外する: そのランでは二度と候補に出さず、その候補だけ引き直す（除外の回数を1つ使う）。
 * ほかの候補はそのまま。代わりが無ければ、その候補は消える
 */
export function banUpgrade(world: World, playerId: PlayerId, index: number): void {
  if (world.role === 'guest') return;
  const lu = world.levelUp;
  const p = world.players.find((x) => x.id === playerId);
  const list = lu?.offers.get(playerId);
  if (!lu || !p || !list || lu.done.has(playerId) || p.bans <= 0) return;
  const offer = list[index];
  const key = offer ? banKey(p, offer) : null;
  if (!key) return;
  p.bans--;
  p.banned.add(key);
  // 代わり: 今の候補と重ならないもの
  const same = (a: UpgradeOffer, b: UpgradeOffer): boolean => JSON.stringify(a) === JSON.stringify(b);
  const replacement = makeOffers(world, p).find((o) => !list.some((x) => same(x, o)));
  const next = [...list];
  if (replacement) next[index] = replacement;
  else next.splice(index, 1);
  lu.offers.set(playerId, next);
}

/** 派生していない技（タイプの技）かどうか。派生先・固有技は候補に直接は出さない */
function isBaseMove(world: World, move: number): boolean {
  return !world.rules.derivations.some((d) => d.to === move);
}

/**
 * 候補を作る（01_game_design.md 3.2・3.3、4.2）。
 * - 派生・固有技の条件（元の技が最大レベル ＋ 材料の持ち物）がそろっていれば必ず出す
 * - 残りは、技（自分のタイプとノーマル。枠が空いていれば新しい技、覚えている技の強化）・持ち物から選ぶ
 */
/**
 * 持ち物がこのプレイヤーの候補に出るか（作者の決定。07_content_draft.md 21）。
 * タイプのアイテム（もくたん など）は、自分のタイプとノーマルのものだけ出す。ステータスのアイテムと進化の道具は、だれにでも出る
 * （進化の石は、ほかのポケモンの固有技の隠れた材料にもなる）。でんきだま など系統の決まったものは、その系統だけ
 */
function itemFitsPlayer(world: World, p: Player, item: number): boolean {
  return itemFits(world.rules, p, item);
}

/** 持ち物が候補に出るか（プレイヤーの形だけで判定する。ラン開始時の持ち物を選ぶ画面でも使う） */
export function itemFits(
  rules: World['rules'],
  p: Pick<Player, 'unlockedItems' | 'line' | 'species' | 'items' | 'types' | 'moveTypes'>,
  item: number,
): boolean {
  const def = rules.items[item]!;
  // まだ解放していない持ち物は出さない（実績で解放する。作者の決定 07 24章）
  if (p.unlockedItems && !p.unlockedItems.has(item)) return false;
  if (def.lines && !def.lines.includes(p.line)) return false;
  if (def.forms && !def.forms.includes(p.species)) return false;
  // 今の姿がこの持ち物で進化できるときだけ（つながりのヒモ: ゴーリキーになってから）
  if (def.onlyWhenEvolves && !rules.species[p.species]?.evolutions.some((e) => e.trigger !== 'level' && e.item === item)) return false;
  // 一緒に持てない持ち物（でんきだま と かみなりのいし）は、どちらか片方だけ
  if (p.items.some((it) => def.excludes?.includes(it.item) || rules.items[it.item]?.excludes?.includes(item))) return false;
  if (def.category !== 'type') return true;
  const normal = rules.types.names.indexOf('normal');
  const types: number[] = [];
  def.perLevel.typePowerPct.forEach((v, t) => v && types.push(t));
  return types.some((t) => t === normal || p.types.includes(t) || p.moveTypes.includes(t));
}

export function makeOffers(world: World, p: Player): UpgradeOffer[] {
  const rules = world.rules;
  const count = rules.leveling.offerCount;
  const guaranteed: UpgradeOffer[] = [];
  p.moves.forEach((pm, slot) => {
    if (pm.level < rules.moves[pm.move]!.levels.length) return;
    for (const d of rules.derivations) {
      if (d.from !== pm.move || (d.item !== -1 && !p.items.some((it) => it.item === d.item))) continue;
      if (d.line !== null && d.line !== p.line) continue;
      if (d.minLevel && world.level < d.minLevel) continue;
      if (d.forms && !d.forms.includes(p.species)) continue;
      if (p.moves.some((m) => m.move === d.to)) continue;
      // ほかにも最大レベルで持っていないといけない技（ばくれつパンチ）
      if (d.withMoves && !d.withMoves.every((w) => p.moves.some((m) => m.move === w && m.level >= rules.moves[w]!.levels.length))) continue;
      guaranteed.push({ kind: 'derive', slot, to: d.to, item: d.item, unique: d.line !== null });
    }
  });

  const pool: UpgradeOffer[] = [];
  const normal = rules.types.names.indexOf('normal');
  p.moves.forEach((pm, slot) => {
    if (pm.level < rules.moves[pm.move]!.levels.length) pool.push({ kind: 'moveUp', slot });
  });
  // 技を覚えないポケモン（プリン）は、新しい技を候補に出さない
  if (p.moves.length < rules.combat.maxMoveSlots && !p.fixedMoves) {
    rules.moves.forEach((m, move) => {
      // 進化で使った技（派生・固有技の元の技）は、もう候補に出さない（作者の指摘 2026年10月25日）
      if (!isBaseMove(world, move) || m.teachOnly || p.moves.some((pm) => pm.move === move) || p.consumedMoves?.includes(move)) return;
      // 覚えられる系統が決まっている技（ノーマルの技・各ポケモン専用の技）は、その系統だけ（ミュウは何でも）
      if (m.learners && !p.learnsAll && !m.learners.includes(p.line)) return;
      if (m.type === normal || p.types.includes(m.type) || p.moveTypes.includes(m.type)) pool.push({ kind: 'moveNew', move });
    });
  }
  p.items.forEach((it, slot) => {
    if (it.level < rules.items[it.item]!.maxLevel) pool.push({ kind: 'itemUp', slot });
  });
  if (p.items.length < rules.leveling.maxItemSlots + p.extraItemSlots) {
    rules.items.forEach((_, item) => {
      // 自分がすでに持っている持ち物は「強化」で出す（ほかの人が持っていても出る。作者の決定で「誰かが持っていれば出さない」は廃止）
      if (p.items.some((it) => it.item === item)) return;
      if (!itemFitsPlayer(world, p, item)) return;
      pool.push({ kind: 'itemNew', item });
    });
  }

  // 除外したものは出さない
  for (let k = pool.length - 1; k >= 0; k--) {
    const key = banKey(p, pool[k]!);
    if (key && p.banned.has(key)) pool.splice(k, 1);
  }
  // 必ず出すものを先に、残りは乱数で選ぶ（シード付きの乱数なので再現できる）
  const out = guaranteed.slice(0, count);
  // 技は持ち物の2倍の重みで選ぶ（作者の決定。07_content_draft.md 21）
  const weightOf = (o: UpgradeOffer): number => (o.kind === 'moveNew' || o.kind === 'moveUp' ? rules.leveling.moveOfferWeight : 1);
  while (out.length < count && pool.length > 0) {
    let r = world.rng.next() * pool.reduce((sum, o) => sum + weightOf(o), 0);
    let k = 0;
    while (k < pool.length - 1 && r >= weightOf(pool[k]!)) r -= weightOf(pool[k++]!);
    out.push(pool.splice(k, 1)[0]!);
  }
  // 何も無いとき（技も持ち物も強化しきった・枠が埋まって組み合わせが合わない）は、回復かコインを選べる（作者の決定 2026年10月23日）
  if (out.length === 0) return [{ kind: 'heal' }, { kind: 'coins' }];
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
    case 'heal':
      p.hp = Math.min(p.maxHp, p.hp + (p.maxHp * world.rules.leveling.fallback.healPct) / 100);
      break;
    case 'coins':
      p.bonusCoins = (p.bonusCoins ?? 0) + world.rules.leveling.fallback.coins;
      break;
    case 'derive': {
      // 元の技は進化で使ったので、もう候補に出さない
      p.consumedMoves = [...(p.consumedMoves ?? []), p.moves[offer.slot]!.move];
      p.moves[offer.slot] = { move: offer.to, level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 };
      // ほかの技も使って進化する技（ばくれつパンチ）: 使った技はなくなり、持ち物で覚え直さない
      // 持っていれば消費する技（ばくれつパンチ: ほのおのパンチ・かみなりパンチ）も同じ
      const d = world.rules.derivations.find((x) => x.to === offer.to && (x.withMoves || x.consumes));
      const used = [...(d?.withMoves ?? []), ...(d?.consumes ?? [])];
      if (used.length) {
        p.moves = p.moves.filter((m) => !used.includes(m.move));
        p.consumedMoves = [...(p.consumedMoves ?? []), ...used];
      }
      // 進化の石などは使うとなくなる（持ち物の枠が空く）
      if (offer.item !== -1 && world.rules.items[offer.item]!.consumable) p.items = p.items.filter((it) => it.item !== offer.item);
      break;
    }
  }
  world.events.push({ type: 'upgradeChosen', playerId: p.id, offer });
  teachItemMoves(world, p);
  recomputeModifiers(world, p);
  // 石を取ったら進化することがある（イーブイなど）
  checkEvolution(world, p);
}

/** 持つと技を覚える持ち物（ワンリキーの ほのおのいし・かみなりのいし）: 持っていて、まだ覚えておらず消費もしていなければ覚える */
function teachItemMoves(world: World, p: Player): void {
  for (const im of world.rules.itemMoves ?? []) {
    if (im.line !== p.line || !p.items.some((it) => it.item === im.item)) continue;
    if (p.moves.some((m) => m.move === im.move) || p.consumedMoves?.includes(im.move)) continue;
    p.moves.push({ move: im.move, level: 1, cooldown: 0, burstLeft: 0, burstTimer: 0 });
    world.events.push({ type: 'moveTaught', playerId: p.id, move: im.move });
  }
}

/**
 * ステータスを作り直す: 種族値のランク・レベル（01_game_design.md 5.1）と、持ち物の効果を合わせる。
 * 最大HPが増えた分は今の HP にも足す。
 */
export function recomputeModifiers(world: World, p: Player): void {
  const mods = emptyModifiers(world.rules.types.names.length);
  if (p.permanent) addModifiers(mods, p.permanent, 1);
  for (const it of p.items) addModifiers(mods, world.rules.items[it.item]!.perLevel, it.level);
  // 箱の一時的な強化
  for (const b of p.buffs ?? []) {
    const def = world.rules.pickups.items.buff?.buffs[b.index];
    if (def) addModifiers(mods, resolveModifiers(def.mods, world.rules.types.names), 1);
  }
  // いつも効く技（かくばる・テクスチャー）: そのレベルまでの効果
  for (const pm of p.moves) {
    const passive = world.rules.moves[pm.move]?.passive[pm.level - 1];
    if (passive) addModifiers(mods, passive, 1);
  }
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
    if (d.minLevel && world.level < d.minLevel) continue;
    if (d.forms && !d.forms.includes(p.species)) continue;
    const hasItem = p.items.some((it) => it.item === d.item);
    const fromAtMax = p.moves.some((m) => m.move === d.from && m.level >= maxOf(d.from));
    // ほかにも最大で持っていないといけない技（ばくれつパンチ）: この候補で最大になる技も数える
    const atMaxAfter = (move: number): boolean =>
      p.moves.some((m, slot) => m.move === move && (m.level >= maxOf(move) || (offer.kind === 'moveUp' && offer.slot === slot && m.level + 1 >= maxOf(move))));
    if (d.withMoves) {
      if (!atMaxAfter(d.from) || !d.withMoves.every(atMaxAfter)) continue;
      // 持ち物もいる（とっておき: かわらずのいし）: この候補で持ち物がそろうときも進化する
      if (d.item !== -1 && !hasItem) {
        if (offer.kind === 'itemNew' && offer.item === d.item) return d;
        continue;
      }
      if (offer.kind === 'moveUp' && [d.from, ...d.withMoves].includes(p.moves[offer.slot]!.move) && p.moves[offer.slot]!.level + 1 >= maxOf(p.moves[offer.slot]!.move)) return d;
      continue;
    }
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
