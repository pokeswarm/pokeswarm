import type { Axis, InputCommand, PlayerId } from '../sim/commands';
import { levelUpSnapshot } from '../sim/systems/leveling';
import { ITEM_KINDS } from '../sim/systems/items';
import type { World } from '../sim/world';
import { round2, type NetMessage } from './protocol';

/** 命中のメッセージ（'d'）と効果のメッセージ（'fx'）の1件あたりの数値の数 */
const DAMAGE_STRIDE = 8;
const EFFECT_STRIDE = 7;

export interface SyncRate {
  playerStateIntervalTicks: number;
  correctionIntervalTicks: number;
}

/** ホストが中継する、あるゲストから届いたメッセージ（そのゲスト以外へ送る） */
export interface Forward {
  readonly from: PlayerId;
  readonly messages: NetMessage[];
}

/**
 * シミュレーションと通信の間の変換（03_network.md 3.2）。Phaser にも通信手段にも依存しない。
 * つなぎ方はホストを中心にした形（ホスト ↔ 各ゲスト）。ゲストどうしの情報（位置・HP）はホストが中継する。
 * - 送る: その更新で起きた出来事（出現・撃破・命中など）と、自分の状態、ホストなら敵の位置の補正・ボスの HP
 * - 受け取る: 届いたメッセージをシミュレーションの入力コマンドに直す
 */
export class SyncSession {
  private rate: SyncRate;
  private readonly replies: NetMessage[] = [];
  private readonly requests: NetMessage[] = [];
  private readonly forwards: Forward[] = [];
  /** 最後に送ったレベルアップの状態（残り時間を除く。変わったときだけ送る） */
  private lastLevelUp = '';
  /** 直近の往復時間（ms） */
  rttMs: number | null = null;
  private lastPingAt = -Infinity;

  constructor(
    rate: SyncRate,
    /** 往復時間の計測を送る間隔（実際の時間。止まっている間も送るので、生存の確認にもなる） */
    private readonly pingIntervalMs: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.rate = rate;
  }

  setRate(rate: SyncRate): void {
    this.rate = rate;
  }

  /** ゲスト: レベルアップの選択（選ぶ・見送る・リロール）をホストへ頼む */
  requestUpgrade(kind: 'c' | 's' | 'r' | 'b', index = 0): void {
    this.requests.push({ t: 'rq', k: kind, n: index });
  }

  /** ホスト: ゲストから届いて、ほかのゲストへ中継するメッセージを取り出す */
  takeForwards(): Forward[] {
    return this.forwards.splice(0);
  }

  /** 1回の更新の後に呼び、送るメッセージを返す（ホストは全ゲストへ、ゲストはホストへ） */
  outgoing(world: World): NetMessage[] {
    const out: NetMessage[] = [...this.replies.splice(0), ...this.requests.splice(0)];
    const role = world.role;
    const host = role === 'host';
    const local = world.players.find((p) => p.id === world.localPlayerId);
    if (local && world.tick % this.rate.playerStateIntervalTicks === 0) {
      out.push({
        t: 'p',
        i: local.id,
        x: round2(local.x),
        y: round2(local.y),
        fx: local.facingX,
        fy: local.facingY,
        ix: local.inputX,
        iy: local.inputY,
        h: round2(local.hp),
        m: round2(local.maxHp),
        dn: local.down ? 1 : 0,
      });
    }

    const spawns: number[] = [];
    const kills: number[] = [];
    const retired: number[] = [];
    const damages: number[] = [];
    const effects: number[] = [];
    const gemSpawns: number[] = [];
    const gemMerges: number[] = [];
    const gemCollects: number[] = [];
    const pickups: number[] = [];
    const hazards: number[] = [];
    const movers: number[] = [];
    const itemSpawns: number[] = [];
    const itemRequests: number[] = [];
    const itemCollects: number[] = [];
    for (const ev of world.events) {
      switch (ev.type) {
        case 'enemySpawned':
          if (host && (ev.vx || ev.vy)) movers.push(ev.id, ev.kind, round2(ev.x), round2(ev.y), round2(ev.vx ?? 0), round2(ev.vy ?? 0));
          else if (host) spawns.push(ev.id, ev.kind, ev.x, ev.y);
          break;
        case 'enemyKilled':
          if (host) kills.push(ev.enemyId, ev.by);
          break;
        case 'enemyRetired':
          if (host) retired.push(ev.id);
          break;
        case 'enemyAffected':
          if (host) effects.push(ev.enemyId, ev.by, round2(ev.kbx), round2(ev.kby), ev.kbTicks, ev.status, ev.statusTicks);
          break;
        case 'gemSpawned':
          if (host) gemSpawns.push(ev.id, round2(ev.x), round2(ev.y), ev.value);
          break;
        case 'gemMerged':
          if (host) gemMerges.push(ev.id, ev.value);
          break;
        case 'gemCollected':
          if (host) gemCollects.push(ev.id, ev.by, ev.value);
          break;
        case 'pickupRequested':
          if (role === 'guest') pickups.push(ev.id, ev.by);
          break;
        case 'damageDealt':
          if (role === 'guest') damages.push(ev.enemyId, ev.amount, ev.by, round2(ev.kbx), round2(ev.kby), ev.kbTicks, ev.status, ev.statusTicks);
          break;
        case 'upgradeChosen':
          if (host) out.push({ t: 'ua', i: ev.playerId, o: ev.offer });
          break;
        case 'hazardTelegraphed':
          if (host) hazards.push(ev.move, round2(ev.x), round2(ev.y), round2(ev.dirX), round2(ev.dirY), ev.dasher);
          break;
        case 'legendaryWarning':
          if (host) out.push(ev.enraged ? { t: 'lw', k: ev.kind, r: 1 } : { t: 'lw', k: ev.kind });
          break;
        case 'runEnded':
          if (host) out.push({ t: 'end', o: ev.outcome, lg: ev.legendary });
          break;
        case 'sectionAdvanced':
          if (host) out.push({ t: 'sa', s: ev.section });
          break;
        case 'itemSpawned':
          if (host) itemSpawns.push(ev.id, ITEM_KINDS.indexOf(ev.kind), round2(ev.x), round2(ev.y));
          break;
        case 'itemRequested':
          if (role === 'guest') itemRequests.push(ev.id);
          break;
        case 'itemCollected':
          if (host) itemCollects.push(ev.id, ev.by, ITEM_KINDS.indexOf(ev.kind), ev.levels);
          break;
        case 'playerLeft':
          if (host) out.push({ t: 'rm', i: ev.playerId });
          break;
        case 'playerRevived':
          if (host) out.push({ t: 'rv', i: ev.playerId, n: ev.revives });
          break;
        default:
          break;
      }
    }
    if (spawns.length) out.push({ t: 'sp', e: spawns });
    if (kills.length) out.push({ t: 'k', e: kills });
    if (retired.length) out.push({ t: 'rt', e: retired });
    if (damages.length) out.push({ t: 'd', e: damages });
    if (effects.length) out.push({ t: 'fx', e: effects });
    if (gemSpawns.length) out.push({ t: 'g', e: gemSpawns });
    if (gemMerges.length) out.push({ t: 'gm', e: gemMerges });
    if (gemCollects.length) out.push({ t: 'gc', e: gemCollects });
    if (pickups.length) out.push({ t: 'pr', e: pickups });
    if (hazards.length) out.push({ t: 'hz', e: hazards });
    if (movers.length) out.push({ t: 'sv', e: movers });
    if (itemSpawns.length) out.push({ t: 'is', e: itemSpawns });
    if (itemRequests.length) out.push({ t: 'iq', e: itemRequests });
    if (itemCollects.length) out.push({ t: 'ic', e: itemCollects });

    if (host) {
      // レベルアップの選択の状態は、変わったときだけ送る（残り時間はゲストが自分で減らす）
      // リロール権は、選択が閉じた後（時間切れの見送りで増えた分など）も送る
      const s = levelUpSnapshot(world);
      const r = world.players.map((p): [number, number] => [p.id, p.rerolls]);
      const key = JSON.stringify([s ? { ...s, ticksLeft: 0 } : null, r]);
      if (key !== this.lastLevelUp) {
        this.lastLevelUp = key;
        out.push({ t: 'lu', s, r });
      }
      if (world.tick % this.rate.correctionIntervalTicks === 0) {
        const e = world.enemies;
        const data: number[] = [];
        for (let i = 0; i < e.count; i++) {
          if (e.hp[i]! <= 0) continue;
          data.push(e.id[i]!, Math.round(e.x[i]! * 10) / 10, Math.round(e.y[i]! * 10) / 10);
        }
        out.push({ t: 'c', e: data, k: world.tick });
      }
      // 中ボス・ボスの HP は、HP のバーが動いて見えるよう補正より短い間隔で送る
      if (world.tick % Math.max(1, Math.round(this.rate.correctionIntervalTicks / 3)) === 0) {
        const e = world.enemies;
        const bosses: number[] = [];
        for (let i = 0; i < e.count; i++) {
          if (e.hp[i]! > 0 && (world.rules.enemies.kinds[e.kind[i]!]?.rank ?? 'normal') !== 'normal') {
            bosses.push(e.id[i]!, Math.ceil(e.hp[i]!), Math.ceil(e.maxHp[i]!), round2(e.x[i]!), round2(e.y[i]!));
          }
        }
        if (bosses.length) out.push({ t: 'bh', e: bosses });
      }
    }
    const now = this.now();
    if (now - this.lastPingAt >= this.pingIntervalMs) {
      this.lastPingAt = now;
      out.push({ t: 'ping', s: now });
    }
    return out;
  }

  /** 届いたメッセージを入力コマンドに直す（次の更新で適用する）。from は送り手（ゲストから見ればホスト） */
  incoming(world: World, messages: readonly NetMessage[], from: PlayerId): InputCommand[] {
    const cmds: InputCommand[] = [];
    const guest = world.role === 'guest';
    const host = world.role === 'host';
    const relay: NetMessage[] = [];
    for (const m of messages) {
      switch (m.t) {
        case 'p':
          // 自分の分（中継で戻ってきたもの）は無視する
          if (m.i === world.localPlayerId) break;
          cmds.push({
            type: 'remotePlayer',
            playerId: m.i,
            x: m.x,
            y: m.y,
            facingX: m.fx as Axis,
            facingY: m.fy as Axis,
            inputX: m.ix as Axis,
            inputY: m.iy as Axis,
            hp: m.h,
            maxHp: m.m,
            down: m.dn === 1,
          });
          // ホスト: ゲストの状態をほかのゲストへ中継する（なりすましを防ぐため、送り手の分だけ）
          if (host && m.i === from) relay.push(m);
          break;
        case 'sp':
          if (guest) {
            for (let k = 0; k + 3 < m.e.length; k += 4) {
              cmds.push({ type: 'spawnEnemy', id: m.e[k]!, kind: m.e[k + 1]!, x: m.e[k + 2]!, y: m.e[k + 3]! });
            }
          }
          break;
        case 'k':
          if (guest) for (let k = 0; k + 1 < m.e.length; k += 2) cmds.push({ type: 'killEnemy', id: m.e[k]!, by: m.e[k + 1]! });
          break;
        case 'rt':
          if (guest) for (const id of m.e) cmds.push({ type: 'retireEnemy', id });
          break;
        case 'd':
          if (host) {
            for (let k = 0; k + DAMAGE_STRIDE - 1 < m.e.length; k += DAMAGE_STRIDE) {
              const [id, amount, by, kbx, kby, kbTicks, status, statusTicks] = m.e.slice(k, k + DAMAGE_STRIDE) as [
                number, number, number, number, number, number, number, number,
              ];
              if (by === from) cmds.push({ type: 'damageEnemy', id, amount, by, kbx, kby, kbTicks, status, statusTicks });
            }
          }
          break;
        case 'fx':
          if (guest) {
            for (let k = 0; k + EFFECT_STRIDE - 1 < m.e.length; k += EFFECT_STRIDE) {
              const [id, by, kbx, kby, kbTicks, status, statusTicks] = m.e.slice(k, k + EFFECT_STRIDE) as [
                number, number, number, number, number, number, number,
              ];
              cmds.push({ type: 'affectEnemy', id, by, kbx, kby, kbTicks, status, statusTicks });
            }
          }
          break;
        case 'g':
          if (guest) for (let k = 0; k + 3 < m.e.length; k += 4) cmds.push({ type: 'spawnGem', id: m.e[k]!, x: m.e[k + 1]!, y: m.e[k + 2]!, value: m.e[k + 3]! });
          break;
        case 'gm':
          if (guest) for (let k = 0; k + 1 < m.e.length; k += 2) cmds.push({ type: 'mergeGem', id: m.e[k]!, value: m.e[k + 1]! });
          break;
        case 'gc':
          if (guest) for (let k = 0; k + 2 < m.e.length; k += 3) cmds.push({ type: 'collectGem', id: m.e[k]!, by: m.e[k + 1]!, value: m.e[k + 2]! });
          break;
        case 'pr':
          if (host) for (let k = 0; k + 1 < m.e.length; k += 2) if (m.e[k + 1] === from) cmds.push({ type: 'requestPickup', id: m.e[k]!, by: from });
          break;
        case 'c':
          if (guest) cmds.push({ type: 'correctEnemies', data: m.e, tick: m.k });
          break;
        case 'lu':
          if (guest) cmds.push({ type: 'levelUpState', state: m.s, rerolls: m.r });
          break;
        case 'ua':
          if (guest) cmds.push({ type: 'applyUpgrade', playerId: m.i, offer: m.o });
          break;
        case 'rq':
          if (host) {
            if (m.k === 'c') cmds.push({ type: 'chooseUpgrade', playerId: from, index: m.n });
            else if (m.k === 's') cmds.push({ type: 'skipUpgrade', playerId: from });
            else if (m.k === 'b') cmds.push({ type: 'banUpgrade', playerId: from, index: m.n });
            else cmds.push({ type: 'rerollUpgrades', playerId: from });
          }
          break;
        case 'hz':
          if (guest) {
            for (let k = 0; k + 5 < m.e.length; k += 6) {
              cmds.push({ type: 'addHazard', move: m.e[k]!, x: m.e[k + 1]!, y: m.e[k + 2]!, dirX: m.e[k + 3]!, dirY: m.e[k + 4]!, dasher: m.e[k + 5]! });
            }
          }
          break;
        case 'bh':
          if (guest) for (let k = 0; k + 4 < m.e.length; k += 5) cmds.push({ type: 'bossHp', id: m.e[k]!, hp: m.e[k + 1]!, maxHp: m.e[k + 2]!, x: m.e[k + 3]!, y: m.e[k + 4]! });
          break;
        case 'sv':
          if (guest) {
            for (let k = 0; k + 5 < m.e.length; k += 6) {
              cmds.push({ type: 'spawnEnemy', id: m.e[k]!, kind: m.e[k + 1]!, x: m.e[k + 2]!, y: m.e[k + 3]!, vx: m.e[k + 4]!, vy: m.e[k + 5]! });
            }
          }
          break;
        case 'lw':
          if (guest) cmds.push({ type: 'legendaryWarning', kind: m.k, enraged: m.r === 1 });
          break;
        case 'end':
          if (guest) cmds.push({ type: 'endRun', outcome: m.o, legendary: m.lg });
          break;
        case 'sa':
          if (guest) cmds.push({ type: 'setSection', section: m.s });
          break;
        case 'is':
          if (guest) for (let k = 0; k + 3 < m.e.length; k += 4) cmds.push({ type: 'spawnItem', id: m.e[k]!, kind: ITEM_KINDS[m.e[k + 1]!]!, x: m.e[k + 2]!, y: m.e[k + 3]! });
          break;
        case 'iq':
          if (host) for (const id of m.e) cmds.push({ type: 'requestItem', id, by: from });
          break;
        case 'ic':
          if (guest) {
            for (let k = 0; k + 3 < m.e.length; k += 4) {
              cmds.push({ type: 'collectItem', id: m.e[k]!, by: m.e[k + 1]!, kind: ITEM_KINDS[m.e[k + 2]!]!, levels: m.e[k + 3]! });
            }
          }
          break;
        case 'rm':
          if (guest) cmds.push({ type: 'removePlayer', playerId: m.i });
          break;
        case 'rv':
          if (guest) cmds.push({ type: 'revivePlayer', playerId: m.i, revives: m.n });
          break;
        case 'ping':
          this.replies.push({ t: 'pong', s: m.s });
          break;
        case 'pong':
          this.rttMs = this.now() - m.s;
          break;
      }
    }
    if (relay.length) this.forwards.push({ from, messages: relay });
    return cmds;
  }
}
