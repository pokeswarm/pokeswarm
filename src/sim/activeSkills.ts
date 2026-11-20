import type { Player, PlayerMove } from './entities/player';
import type { SimActiveSkill } from './rules';
import type { World } from './world';
import { fireRebirth, fireSacredFire, fireSkyLoop, skyLoopPath, fireDracoMeteor, fireLusterPurge, fireDragonPulse, fireHealPulse, fireMistBall, fireAeroblast, fireExtrasensory, fireHydroPump, fireThunderbolt, fireZapCannon, zapNetworkHit, burnUpCenter, eruptionCenter, extremeSpeedPath, fireBlizzard, fireBurnUp, fireHeatWave, fireSkyAttack, skyAttackPath, fireEnteiEruption, fireFreezeDry, fireIcyWind, fireExtremeSpeed, fireLavaPlume, fireMirrorShards, fireOverheat, fireRisingVoltage, fireSheerCold, fireSurfWave, lavaCracks, risingVoltageTargets, scaledMoveStats, skillMoveStats, strongestEnemyIndex } from './systems/attack';

/**
 * アクティブスキル（作者の案 2026年11月18日。07 の305・307章）: キー（SPACE・Q・E）で使う技。
 * ためておける回数があり、1 回分ずつ時間で戻る。技の枠の技（move）を持つスキルは、レベル・再使用・威力がその技の値。
 * 自分のプレイヤーだけを動かす（ほかのブラウザでは、届いた知らせで見た目だけを出す）
 */

/** 系統のスキルを持たせる（ランの始め。最初は満タン） */
export function initSkills(world: World, p: Player): void {
  const list = world.rules.activeSkills?.lines[p.line];
  if (!list || list.length === 0) return;
  p.skills = list.map((skill) => ({ skill, level: 1, charges: 0, rechargeTicks: 0 }));
  for (const s of p.skills) s.charges = maxCharges(world, p, s);
}

export function skillDef(world: World, skill: number): SimActiveSkill {
  return world.rules.activeSkills!.defs[skill]!;
}

/** スキルの技（技の枠の技。無ければ undefined） */
export function skillMove(world: World, p: Player, s: { skill: number }): PlayerMove | undefined {
  const d = skillDef(world, s.skill);
  return d.move >= 0 ? p.moves.find((m) => m.move === d.move) : undefined;
}

/** スキルのレベル（技の枠の技があれば、その技のレベル） */
export function skillLevel(world: World, p: Player, s: { skill: number; level: number }): number {
  return skillMove(world, p, s)?.level ?? s.level;
}

/** ためておける回数（レベルと、技の数の強化 = ポイントマックス） */
export function maxCharges(world: World, p: Player, s: { skill: number; level: number }): number {
  const d = skillDef(world, s.skill);
  return Math.max(1, d.baseCharges + Math.floor((skillLevel(world, p, s) - 1) * d.chargesPerLevel) + Math.max(0, p.mods.amountBonus));
}

/** 1 回分が戻るまでの更新回数（技の枠の技はその技の再使用。どちらも技の再使用の強化 = メトロノーム などで速くなる） */
export function rechargeTicksOf(world: World, p: Player, s: { skill: number }): number {
  const pm = skillMove(world, p, s);
  const seconds = pm ? skillMoveStats(world, p, pm).sc.cooldownSeconds : (skillDef(world, s.skill).rechargeSeconds ?? 8) * Math.max(0.2, 1 + p.mods.cooldownPct / 100);
  return Math.max(1, Math.round(seconds / world.dt));
}

/**
 * しんそく で駆け抜けている間（毎回の更新）: 折れ線に沿って速さ × 1 回分だけ進める（角をまたいでも止まらない）。
 * 体が動く技の間（dashTicks）は入力で動けない。終点に着いたら止まる
 */
function advanceExtremeSpeed(world: World, p: Player): void {
  const d = p.esDash!;
  let budget = d.speed * world.dt;
  p.dashVx = 0;
  p.dashVy = 0;
  // ためている間（ゴッドバード）は止まって待つ
  if (d.wait && d.wait > 0) {
    d.wait--;
    return;
  }
  while (budget > 0) {
    const q = d.pts[d.k];
    if (!q) break;
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const dist = Math.hypot(dx, dy);
    // 向き（8 方向）も進む方へ
    if (dist > 0.5) {
      p.facingX = dx / dist > 0.38 ? 1 : dx / dist < -0.38 ? -1 : 0;
      p.facingY = dy / dist > 0.38 ? 1 : dy / dist < -0.38 ? -1 : 0;
    }
    if (dist <= budget) {
      p.x = q.x;
      p.y = q.y;
      budget -= dist;
      d.k++;
      continue;
    }
    p.x += (dx / dist) * budget;
    p.y += (dy / dist) * budget;
    budget = 0;
  }
  if (!d.pts[d.k]) {
    p.esDash = undefined;
    p.dashTicks = 0;
  }
}

/** 毎回の更新: 回数を時間で戻す・強化の切れ目・ミラーコートの終わり・しんそく の駆け抜け */
export function stepSkills(world: World): void {
  for (const p of world.players) {
    // 止められた（押し飛ばし など）ら、駆け抜けもやめる
    if (p.esDash && !p.dashTicks) p.esDash = undefined;
    if (p.esDash) advanceExtremeSpeed(world, p);
    if (p.skillBuff && world.tick >= p.skillBuff.untilTick) p.skillBuff = undefined;
    if (p.calm && world.tick >= p.calm.untilTick) p.calm = undefined;
    if (p.overheat && world.tick >= p.overheat.untilTick) p.overheat = undefined;
    if (p.dance && world.tick >= p.dance.untilTick) p.dance = undefined;
    if (p.sacredFlame && world.tick >= p.sacredFlame.untilTick) p.sacredFlame = undefined;
    // もえつきる: 炎の玉が落ちたら ほのおタイプを失い、切れたら戻る
    if (p.burnedOut && world.tick >= p.burnedOut.offTick && world.tick < p.burnedOut.untilTick) p.types = p.burnedOut.types.filter((t) => t !== p.burnedOut!.lostType);
    if (p.burnedOut && world.tick >= p.burnedOut.untilTick) {
      p.types = p.burnedOut.types;
      p.burnedOut = undefined;
    }
    if (p.mirror && world.tick >= p.mirror.untilTick) releaseMirror(world, p);
    if (!p.skills || p.remote) continue;
    for (const s of p.skills) {
      const max = maxCharges(world, p, s);
      if (s.charges >= max) {
        s.charges = max;
        s.rechargeTicks = 0;
        continue;
      }
      if (s.rechargeTicks <= 0) s.rechargeTicks = rechargeTicksOf(world, p, s);
      // もえつきる の後は ゴッドバード の回数が速く戻る
      if (p.burnedOut && world.tick < p.burnedOut.untilTick && skillDef(world, s.skill).kind === 'skyAttack') s.rechargeTicks -= p.burnedOut.rechargeMultiplier - 1;
      if (--s.rechargeTicks <= 0) {
        s.charges++;
        if (s.charges < max) s.rechargeTicks = rechargeTicksOf(world, p, s);
      }
    }
  }
}

/** 向き（押している向き。押していなければ向いている向き）の単位ベクトル */
export function aimOf(p: Player): [number, number] {
  const dx = p.inputX !== 0 || p.inputY !== 0 ? p.inputX : p.facingX;
  const dy = p.inputX !== 0 || p.inputY !== 0 ? p.inputY : p.facingY;
  if (dx === 0 && dy === 0) return [0, 1];
  const d = Math.hypot(dx, dy);
  return [dx / d, dy / d];
}

/** テレポートの行き先（固定マップの中に収める。障害物は着いた後の更新で押し出される） */
export function teleportDestination(world: World, p: Player, skill: number): { x: number; y: number } {
  const d = skillDef(world, skill);
  const [ax, ay] = aimOf(p);
  let x = p.x + ax * (d.distance ?? 300);
  let y = p.y + ay * (d.distance ?? 300);
  const a = world.arena;
  if (a) {
    x = Math.max(a.x - a.halfWidth + p.radius, Math.min(a.x + a.halfWidth - p.radius, x));
    y = Math.max(a.y - a.halfHeight + p.radius, Math.min(a.y + a.halfHeight - p.radius, y));
  }
  return { x, y };
}

/** なみのりの通り道（狙いを見せる）: 長さと幅 */
export function surfLane(world: World, p: Player, skill: number): { length: number; width: number } | null {
  const pm = skillMove(world, p, { skill });
  if (!pm) return null;
  const { st, sc } = skillMoveStats(world, p, pm);
  return { length: st.range, width: sc.size * 1.6 * (Math.max(1, st.count) - 1) + sc.size * 2 };
}

/** しんそくの折れ線（狙いを見せる） */
export function extremeSpeedPreview(world: World, p: Player, skill: number): { x: number; y: number }[] | null {
  const pm = skillMove(world, p, { skill });
  if (!pm) return null;
  const [dx, dy] = aimOf(p);
  return extremeSpeedPath(world, p, pm, dx, dy);
}

/**
 * ライジングボルトの狙い（押している間に見せる）: コンボの相手（重ねきった敵）の位置。いなければ HP の一番高い敵の位置 1 つ（combo: false）
 */
export function risingVoltagePreview(world: World, p: Player, skill: number): { combo: boolean; spots: { x: number; y: number }[] } | null {
  const pm = skillMove(world, p, { skill });
  const cfg = skillDef(world, skill).risingVoltage;
  if (!pm || !cfg) return null;
  const e = world.enemies;
  const combo = risingVoltageTargets(world, p, pm, cfg.maxTargets);
  if (combo.length > 0) return { combo: true, spots: combo.map((i) => ({ x: e.x[i]!, y: e.y[i]! })) };
  const t = strongestEnemyIndex(world, p, skillMoveStats(world, p, pm).st.range);
  return { combo: false, spots: t !== -1 ? [{ x: e.x[t]!, y: e.y[t]! }] : [] };
}

/** ふんえん のスキルの技の番号（ふんか のコンボの相手。無ければ -1） */
function lavaPlumeMove(world: World): number {
  return world.rules.activeSkills?.defs.find((x) => x.kind === 'lavaPlume' && x.move >= 0)?.move ?? -1;
}

/**
 * ふんか の狙い（押している間に見せる。エンテイ。07 の313章）: 割れ目があれば割れ目（combo: true）、無ければ火山弾が落ちる区画の中心（向きの先の HP の一番高い敵）と半径
 */
export function eruptionPreview(world: World, p: Player, skill: number): { combo: boolean; x: number; y: number; r: number; cracks: { x: number; y: number; dx: number; dy: number; len: number }[]; count: number } | null {
  const pm = skillMove(world, p, { skill });
  const cfg = skillDef(world, skill).eruption;
  if (!pm || !cfg) return null;
  const { st } = skillMoveStats(world, p, pm);
  const cracks = lavaCracks(world, p, lavaPlumeMove(world)).filter((c) => Math.hypot(c.x - p.x, c.y - p.y) <= st.range);
  const [dx, dy] = aimOf(p);
  const center = eruptionCenter(world, p, st.range, dx, dy, cfg.areaDistance);
  const hp = Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp)));
  const count = Math.max(1, Math.round(st.count * (cfg.minCountPct / 100 + (1 - cfg.minCountPct / 100) * hp)));
  return { combo: cracks.length > 0, x: center.x, y: center.y, r: cfg.areaRadius, cracks, count };
}

/** オーバーヒート の炎の範囲（押している間に見せる）: 長さと半径 */
export function overheatReach(world: World, p: Player, skill: number): { length: number; radius: number } | null {
  const pm = skillMove(world, p, { skill });
  if (!pm) return null;
  const { st, sc } = skillMoveStats(world, p, pm);
  return { length: st.range, radius: sc.size };
}

/**
 * フリーザーの技の狙い（押している間に見せる。07 の314章）: フリーズドライ は霜の線の長さと向きの開き、ふぶき は帯の幅・奥行き・進む距離
 */
export function articunoReach(world: World, p: Player, skill: number): { length: number; spreadDegrees: number; count: number; width: number; depth: number; start: number } | null {
  const pm = skillMove(world, p, { skill });
  const d = skillDef(world, skill);
  if (!pm) return null;
  const { st, sc } = skillMoveStats(world, p, pm);
  if (d.freezeDry) return { length: st.range, spreadDegrees: d.freezeDry.spreadDegrees, count: Math.max(1, st.count), width: 0, depth: 0, start: 0 };
  if (d.blizzard) return { length: d.blizzard.startDistance + sc.speed * st.durationSeconds, spreadDegrees: 0, count: 1, width: d.blizzard.width, depth: sc.size * 2, start: d.blizzard.startDistance };
  return null;
}

/** ファイヤー・サンダー・ルギアの技の狙い（押している間に見せる。07 の315〜317章）: ハイドロポンプ は自分の所と水流の長さ（r）、エアロブラスト は竜巻の出る所。ゴッドバード・ドリルくちばし は突き抜ける道、もえつきる は炎の玉が落ちる所と半径 */
export function moltresAim(world: World, p: Player, skill: number): { path?: { x: number; y: number }[]; width?: number; x?: number; y?: number; r?: number } | null {
  const pm = skillMove(world, p, { skill });
  const d = skillDef(world, skill);
  if (!pm) return null;
  const [dx, dy] = aimOf(p);
  const { st, sc } = skillMoveStats(world, p, pm);
  if (d.skyAttack || d.drillPeck) return { path: skyAttackPath(world, p, pm, dx, dy), width: sc.size };
  if (d.burnUp) {
    const c = burnUpCenter(world, p, st.range, dx, dy, d.burnUp.areaDistance);
    return { x: c.x, y: c.y, r: sc.size };
  }
  if (d.skyLoop) return { path: skyLoopPath(world, p, st.range, dx, dy, d.skyLoop), width: sc.size };
  if (d.sacredFire) {
    const c = burnUpCenter(world, p, st.range, dx, dy, d.sacredFire.areaDistance);
    return { x: c.x, y: c.y, r: sc.size };
  }
  if (d.lusterPurge) {
    const c = burnUpCenter(world, p, st.range, dx, dy, d.lusterPurge.areaDistance);
    return { x: c.x, y: c.y, r: sc.size, path: [c, { x: c.x + dx * d.lusterPurge.spacing * Math.max(0, st.count - 1), y: c.y + dy * d.lusterPurge.spacing * Math.max(0, st.count - 1) }] };
  }
  if (d.dracoMeteor) {
    const c = burnUpCenter(world, p, st.range, dx, dy, d.dracoMeteor.areaDistance);
    return { x: c.x, y: c.y, r: d.dracoMeteor.areaRadius };
  }
  if (d.aeroblast) {
    const c = burnUpCenter(world, p, st.range, dx, dy, d.aeroblast.areaDistance);
    return { x: c.x, y: c.y, r: d.aeroblast.tornadoRadius };
  }
  if (d.hydroPump) return { x: p.x, y: p.y, r: st.range };
  return null;
}

/** 10まんボルト の稲妻の道（押している間に見せる。07 の316章）: 始まり・向き・長さと、自分の でんじほう に当たるか */
export function thunderboltAim(world: World, p: Player, skill: number): { x: number; y: number; dx: number; dy: number; len: number; hits: boolean } | null {
  const pm = skillMove(world, p, { skill });
  if (!pm || !skillDef(world, skill).thunderbolt) return null;
  const [dx, dy] = aimOf(p);
  const { st, sc } = skillMoveStats(world, p, pm);
  return { x: p.x, y: p.y, dx, dy, len: st.range, hits: zapNetworkHit(world, p.id, p.x, p.y, dx, dy, st.range, sc.size).spheres.length > 0 };
}

/** じゅうでん の 1 つ分の威力（%） */
export function chargePct(world: World, p: Player, skill: number): number {
  const d = skillDef(world, skill);
  const pm = skillMove(world, p, { skill });
  if (!d.charge) return 0;
  return d.charge.powerPct + ((pm?.level ?? 1) - 1) * d.charge.powerPctPerLevel;
}

/** 今スキルを使えるか（回数があり、動ける状態） */
export function canUseSkill(p: Player, slot: number): boolean {
  const s = p.skills?.[slot];
  if (!s || s.charges <= 0 || p.down) return false;
  // 体が動く技・押し飛ばし・眠り・凍り・泣いている・反動の間は使えない
  return !p.dashTicks && !p.pushTicks && !p.sleepTicks && !p.frozenTicks && !p.cryTicks && !p.recoverTicks && !(p.sleep && (p.sleep.asleep || p.sleep.wakeTicks > 0));
}

/** スキルを使う（枠の番号。キーの順） */
export function useSkill(world: World, p: Player, slot: number): void {
  if (p.remote || !canUseSkill(p, slot)) return;
  const s = p.skills![slot]!;
  const d = skillDef(world, s.skill);
  const pm = skillMove(world, p, s);
  if (d.move >= 0 && !pm) return;
  const max = maxCharges(world, p, s);
  if (s.charges >= max) s.rechargeTicks = rechargeTicksOf(world, p, s);
  s.charges--;
  const [dx, dy] = aimOf(p);
  const fromX = p.x;
  const fromY = p.y;
  runSkill(world, p, d, pm, dx, dy);
  world.events.push({ type: 'skillUsed', playerId: p.id, skill: s.skill, slot, fromX, fromY, toX: p.x, toY: p.y, dirX: dx, dirY: dy, stacks: p.skillBuff?.stacks ?? p.charged?.stacks ?? 0 });
}

/** スキルの中身（自分のブラウザ: 当たりも効き目も。ほかのブラウザ: 見た目だけ。当たりは当てた人のブラウザで決まる） */
function runSkill(world: World, p: Player, d: SimActiveSkill, pm: PlayerMove | undefined, dx: number, dy: number): void {
  switch (d.kind) {
    case 'teleport': {
      if (p.remote) return;
      const to = teleportDestination(world, p, world.rules.activeSkills!.defs.indexOf(d));
      p.x = p.prevX = to.x;
      p.y = p.prevY = to.y;
      if (d.buff) {
        const live = p.skillBuff && world.tick < p.skillBuff.untilTick;
        const stacks = Math.min(d.buff.maxStacks, (live ? p.skillBuff!.stacks : 0) + 1);
        p.skillBuff = { stacks, pct: stacks * d.buff.powerPct, untilTick: world.tick + Math.round(d.buff.seconds / world.dt) };
      }
      return;
    }
    case 'surf': {
      if (!pm || !d.surf) return;
      fireSurfWave(world, p, pm, p.x, p.y, dx, dy, d.surf);
      // 自分も波に乗って進む（体が動く技と同じ。入力では動けない）
      if (!p.remote && d.surf.rideSeconds > 0) {
        const speed = scaledMoveStats(world, p, pm, skillMoveStats(world, p, pm).st).speed * 0.85;
        p.dashTicks = Math.round(d.surf.rideSeconds / world.dt);
        p.dashBusyTicks = p.dashTicks;
        p.dashVx = dx * speed;
        p.dashVy = dy * speed;
      }
      return;
    }
    case 'sheerCold': {
      if (!pm || !d.sheerCold) return;
      const surf = world.rules.activeSkills!.defs.find((x) => x.kind === 'surf' && x.move >= 0);
      fireSheerCold(world, p, pm, dx, dy, surf?.move ?? -1, d.sheerCold);
      return;
    }
    case 'extremeSpeed': {
      if (!pm) return;
      const run = fireExtremeSpeed(world, p, pm, dx, dy);
      // 自分は折れ線に沿って駆け抜ける（体が動く技と同じ。入力では動けない。ほかのブラウザのプレイヤーは位置で届く）
      if (!p.remote && run.pts.length > 1) {
        p.esDash = { pts: run.pts, k: 1, speed: run.speed };
        p.dashTicks = Math.ceil(run.seconds / world.dt) + 1;
        p.dashBusyTicks = p.dashTicks;
        p.dashVx = 0;
        p.dashVy = 0;
      }
      return;
    }
    case 'charge': {
      if (!d.charge) return;
      // じゅうでん: 次の ライジングボルト の威力を 1 つ分上げる（重ねられる）
      const pct = chargePct(world, p, world.rules.activeSkills!.defs.indexOf(d));
      const stacks = Math.min(d.charge.maxStacks, (p.charged?.stacks ?? 0) + 1);
      p.charged = { stacks, pct: stacks * pct };
      return;
    }
    case 'risingVoltage': {
      if (!pm || !d.risingVoltage) return;
      fireRisingVoltage(world, p, pm, dx, dy, d.risingVoltage);
      return;
    }
    case 'eruption': {
      if (!pm || !d.eruption) return;
      fireEnteiEruption(world, p, pm, dx, dy, lavaPlumeMove(world), d.eruption);
      return;
    }
    case 'lavaPlume': {
      if (!pm || !d.lavaPlume) return;
      fireLavaPlume(world, p, pm, dx, dy, d.lavaPlume);
      return;
    }
    case 'overheat': {
      if (!pm || !d.overheat) return;
      fireOverheat(world, p, pm, dx, dy, d.overheat);
      return;
    }
    case 'freezeDry': {
      if (!pm || !d.freezeDry) return;
      fireFreezeDry(world, p, pm, dx, dy, d.freezeDry);
      return;
    }
    case 'icyWind': {
      if (!pm || !d.icyWind) return;
      fireIcyWind(world, p, pm, dx, dy, d.icyWind);
      return;
    }
    case 'blizzard': {
      if (!pm || !d.blizzard) return;
      fireBlizzard(world, p, pm, dx, dy, d.blizzard);
      return;
    }
    case 'skyAttack': {
      if (!pm || !d.skyAttack) return;
      const run = fireSkyAttack(world, p, pm, dx, dy, d.skyAttack);
      // ためてから、まっすぐ突き抜ける（体が動く技と同じ。入力では動けない。ほかのブラウザのプレイヤーは位置で届く）
      if (!p.remote && run.pts.length > 1) {
        const wait = Math.round(d.skyAttack.chargeSeconds / world.dt);
        p.esDash = { pts: run.pts, k: 1, speed: run.speed, wait };
        p.dashTicks = wait + Math.ceil(run.seconds / world.dt) + 1;
        p.dashBusyTicks = p.dashTicks;
        p.dashVx = 0;
        p.dashVy = 0;
      }
      return;
    }
    case 'skyLoop': {
      if (!pm || !d.skyLoop) return;
      const run = fireSkyLoop(world, p, pm, dx, dy, d.skyLoop);
      // 楕円をたどって行って帰ってくる（体が動く技と同じ。入力では動けない）
      if (!p.remote && run.pts.length > 1) {
        p.esDash = { pts: run.pts, k: 1, speed: run.speed };
        p.dashTicks = Math.ceil(run.seconds / world.dt) + 1;
        p.dashBusyTicks = p.dashTicks;
        p.dashVx = 0;
        p.dashVy = 0;
      }
      return;
    }
    case 'rebirth': {
      if (!d.rebirth) return;
      fireRebirth(world, p, d.rebirth);
      return;
    }
    case 'sacredFire': {
      if (!pm || !d.sacredFire) return;
      fireSacredFire(world, p, pm, dx, dy, d.sacredFire);
      p.sacredFlame = { fromTick: world.tick, untilTick: world.tick + Math.round(d.sacredFire.stateSeconds / world.dt) };
      return;
    }
    case 'lusterPurge': {
      if (!pm || !d.lusterPurge) return;
      fireLusterPurge(world, p, pm, dx, dy, d.lusterPurge);
      return;
    }
    case 'dragonDance': {
      if (!d.dragonDance) return;
      // りゅうのまい: 重ねる（切れていれば 1 から）
      const live = p.dance && world.tick < p.dance.untilTick;
      const stacks = Math.min(d.dragonDance.maxStacks, (live ? p.dance!.stacks : 0) + 1);
      p.dance = { stacks, powerPct: d.dragonDance.powerPct, speedPct: d.dragonDance.speedPct, untilTick: world.tick + Math.round(d.dragonDance.seconds / world.dt) };
      return;
    }
    case 'dracoMeteor': {
      if (!pm || !d.dracoMeteor) return;
      const stacks = p.dance && world.tick < p.dance.untilTick ? p.dance.stacks : 0;
      fireDracoMeteor(world, p, pm, dx, dy, d.dracoMeteor, stacks);
      p.dance = undefined;
      return;
    }
    case 'mistBall': {
      if (!pm || !d.mistBall) return;
      fireMistBall(world, p, pm, dx, dy, d.mistBall);
      return;
    }
    case 'dragonPulse': {
      if (!pm || !d.dragonPulse) return;
      fireDragonPulse(world, p, pm, dx, dy, d.dragonPulse);
      return;
    }
    case 'healPulse': {
      if (!pm || !d.healPulse) return;
      fireHealPulse(world, p, pm, d.healPulse);
      return;
    }
    case 'aeroblast': {
      if (!pm || !d.aeroblast) return;
      fireAeroblast(world, p, pm, dx, dy, d.aeroblast);
      return;
    }
    case 'extrasensory': {
      if (!pm || !d.extrasensory) return;
      fireExtrasensory(world, p, pm, dx, dy, d.extrasensory);
      return;
    }
    case 'hydroPump': {
      if (!pm || !d.hydroPump) return;
      fireHydroPump(world, p, pm, dx, dy, d.hydroPump);
      return;
    }
    case 'drillPeck': {
      if (!pm || !d.drillPeck) return;
      const run = fireSkyAttack(world, p, pm, dx, dy, { chargeSeconds: d.drillPeck.chargeSeconds, featherSpacing: 1, featherSeconds: 0, featherPowerPct: 0 });
      if (!p.remote && run.pts.length > 1) {
        const wait = Math.round(d.drillPeck.chargeSeconds / world.dt);
        p.esDash = { pts: run.pts, k: 1, speed: run.speed, wait };
        p.dashTicks = wait + Math.ceil(run.seconds / world.dt) + 1;
        p.dashBusyTicks = p.dashTicks;
        p.dashVx = 0;
        p.dashVy = 0;
      }
      return;
    }
    case 'zapCannon': {
      if (!pm || !d.zapCannon) return;
      fireZapCannon(world, p, pm, dx, dy, d.zapCannon);
      return;
    }
    case 'thunderbolt': {
      if (!pm || !d.thunderbolt) return;
      fireThunderbolt(world, p, pm, dx, dy, d.thunderbolt);
      return;
    }
    case 'heatWave': {
      if (!pm || !d.heatWave) return;
      fireHeatWave(world, p, pm, dx, dy, d.heatWave);
      return;
    }
    case 'burnUp': {
      if (!pm || !d.burnUp) return;
      fireBurnUp(world, p, pm, dx, dy, d.burnUp);
      if (p.remote) return;
      // 燃え尽きる: すぐ体が軽くなり、炎の玉が落ちた後に技のタイプ（ほのお）を失う（玉そのものはタイプが一致したまま。重ねて使っても元のタイプを覚えておく）
      const types = p.burnedOut?.types ?? p.types;
      p.types = types;
      p.burnedOut = {
        untilTick: world.tick + Math.round((d.burnUp.chargeSeconds + d.burnUp.burnoutSeconds) / world.dt),
        fromTick: world.tick,
        offTick: world.tick + Math.round((d.burnUp.chargeSeconds + d.burnUp.flightSeconds) / world.dt) + 2,
        lostType: world.rules.moves[pm.move]!.type,
        speedPct: d.burnUp.speedPct,
        rechargeMultiplier: d.burnUp.rechargeMultiplier,
        types,
      };
      return;
    }
    case 'mirrorCoat': {
      if (!pm || !d.mirror) return;
      const { st } = skillMoveStats(world, p, pm);
      p.mirror = { untilTick: world.tick + Math.round(st.durationSeconds / world.dt), absorbed: 0, hits: 0, slot: world.rules.activeSkills!.defs.indexOf(d) };
      return;
    }
  }
}

/** ミラーコートの終わり: 吸った分だけ鏡の破片を飛ばす */
function releaseMirror(world: World, p: Player): void {
  const m = p.mirror!;
  p.mirror = undefined;
  const d = skillDef(world, m.slot);
  const pm = d.move >= 0 ? p.moves.find((x) => x.move === d.move) : undefined;
  if (!pm || !d.mirror) return;
  const { st } = skillMoveStats(world, p, pm);
  const count = Math.min(d.mirror.maxShards, Math.max(1, st.count) + Math.round(m.hits * d.mirror.shardsPerHit));
  const mult = 1 + (m.absorbed / Math.max(1, p.maxHp)) * (d.mirror.absorbPowerPct / 100);
  fireMirrorShards(world, p, pm, count, mult, d.mirror.shardSpeed);
  world.events.push({ type: 'mirrorReleased', playerId: p.id, count });
}

/** ミラーコートが効いているか */
export function mirrorActive(world: World, p: Player): boolean {
  return !!p.mirror && world.tick < p.mirror.untilTick;
}

/** ミラーコートに吸わせる（ダメージを受けない。少しの間は続けて吸わない） */
export function absorbIntoMirror(world: World, p: Player, amount: number): void {
  const m = p.mirror!;
  m.absorbed += amount;
  m.hits++;
  p.invincibleTicks = Math.round(world.rules.stats.hurtInvincibleSeconds / world.dt);
  world.events.push({ type: 'mirrorAbsorbed', playerId: p.id, amount });
}

/** ほかのブラウザのプレイヤーが使ったスキルを、見た目だけ出す（位置と向きは届いた値） */
export function replaySkill(world: World, p: Player, slot: number, x: number, y: number, dx: number, dy: number): void {
  const s = p.skills?.[slot];
  if (!s || !p.remote) return;
  const d = skillDef(world, s.skill);
  const pm = skillMove(world, p, s);
  const ox = p.x;
  const oy = p.y;
  p.x = x;
  p.y = y;
  if (d.kind === 'mirrorCoat' && pm) p.mirror = { untilTick: world.tick + Math.round(skillMoveStats(world, p, pm).st.durationSeconds / world.dt), absorbed: 0, hits: 0, slot: s.skill };
  else runSkill(world, p, d, pm, dx, dy);
  p.x = ox;
  p.y = oy;
}

/**
 * キーで使う技（pattern "skill"）を、スキルの枠に無いプレイヤーが持っているとき（技の表を測るミュウ など）: 使えるようになるたびに出す。
 * スキルの枠にあれば何もしない（キーで使う）
 */
export function autoSkillMove(world: World, p: Player, pm: PlayerMove): void {
  const defs = world.rules.activeSkills?.defs ?? [];
  const di = defs.findIndex((d) => d.move === pm.move);
  if (di === -1 || p.skills?.some((s) => s.skill === di)) return;
  pm.cooldown -= world.dt;
  if (pm.cooldown > 0) return;
  const { sc } = skillMoveStats(world, p, pm);
  pm.cooldown = sc.cooldownSeconds;
  const [dx, dy] = aimOf(p);
  runSkill(world, p, defs[di]!, pm, dx, dy);
}

/** スキルの強化で上がる技の威力（%） */
export function skillPowerPct(world: World, p: Player): number {
  const dance = p.dance && world.tick < p.dance.untilTick ? p.dance.stacks * p.dance.powerPct : 0;
  return (p.skillBuff && world.tick < p.skillBuff.untilTick ? p.skillBuff.pct : 0) + dance;
}
