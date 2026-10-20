import type { Axis, InputCommand, PlayerId } from '../sim/commands';
import type { World } from '../sim/world';
import { round2, type NetMessage } from './protocol';

/** 命中のメッセージ（'d'）と効果のメッセージ（'fx'）の1件あたりの数値の数 */
const DAMAGE_STRIDE = 8;
const EFFECT_STRIDE = 7;

export interface SyncRate {
  playerStateIntervalTicks: number;
  correctionIntervalTicks: number;
}

/**
 * シミュレーションと通信の間の変換（03_network.md 3.2）。Phaser にも通信手段にも依存しない。
 * - 送る: その更新で起きた出来事（出現・撃破・命中）と、自分の位置、ホストなら敵の位置の補正
 * - 受け取る: 届いたメッセージをシミュレーションの入力コマンドに直す
 */
export class SyncSession {
  private rate: SyncRate;
  private readonly replies: NetMessage[] = [];
  /** 直近の往復時間（ms） */
  rttMs: number | null = null;

  constructor(
    private readonly remotePlayerId: PlayerId,
    rate: SyncRate,
    private readonly pingIntervalTicks: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.rate = rate;
  }

  setRate(rate: SyncRate): void {
    this.rate = rate;
  }

  /** 1回の更新の後に呼び、送るメッセージを返す */
  outgoing(world: World): NetMessage[] {
    const out: NetMessage[] = this.replies.splice(0);
    const role = world.role;
    const local = world.players.find((p) => p.id === world.localPlayerId);
    if (local && world.tick % this.rate.playerStateIntervalTicks === 0) {
      out.push({
        t: 'p',
        x: round2(local.x),
        y: round2(local.y),
        fx: local.facingX,
        fy: local.facingY,
        ix: local.inputX,
        iy: local.inputY,
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
    for (const ev of world.events) {
      switch (ev.type) {
        case 'enemySpawned':
          if (role === 'host') spawns.push(ev.id, ev.kind, ev.x, ev.y);
          break;
        case 'enemyKilled':
          if (role === 'host') kills.push(ev.enemyId, ev.by);
          break;
        case 'enemyRetired':
          if (role === 'host') retired.push(ev.id);
          break;
        case 'enemyAffected':
          if (role === 'host') effects.push(ev.enemyId, ev.by, round2(ev.kbx), round2(ev.kby), ev.kbTicks, ev.status, ev.statusTicks);
          break;
        case 'gemSpawned':
          if (role === 'host') gemSpawns.push(ev.id, round2(ev.x), round2(ev.y), ev.value);
          break;
        case 'gemMerged':
          if (role === 'host') gemMerges.push(ev.id, ev.value);
          break;
        case 'gemCollected':
          if (role === 'host') gemCollects.push(ev.id, ev.by, ev.value);
          break;
        case 'pickupRequested':
          if (role === 'guest') pickups.push(ev.id, ev.by);
          break;
        case 'damageDealt':
          if (role === 'guest') damages.push(ev.enemyId, ev.amount, ev.by, round2(ev.kbx), round2(ev.kby), ev.kbTicks, ev.status, ev.statusTicks);
          break;
        case 'projectileHit':
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

    if (role === 'host' && world.tick % this.rate.correctionIntervalTicks === 0 && world.enemies.count > 0) {
      const e = world.enemies;
      const data: number[] = [];
      for (let i = 0; i < e.count; i++) {
        if (e.hp[i]! > 0) data.push(e.id[i]!, Math.round(e.x[i]! * 10) / 10, Math.round(e.y[i]! * 10) / 10);
      }
      out.push({ t: 'c', e: data });
    }
    if (world.tick % this.pingIntervalTicks === 0) out.push({ t: 'ping', s: this.now() });
    return out;
  }

  /** 届いたメッセージを入力コマンドに直す（次の更新で適用する） */
  incoming(world: World, messages: readonly NetMessage[]): InputCommand[] {
    const cmds: InputCommand[] = [];
    const guest = world.role === 'guest';
    const host = world.role === 'host';
    for (const m of messages) {
      switch (m.t) {
        case 'p':
          cmds.push({
            type: 'remotePlayer',
            playerId: this.remotePlayerId,
            x: m.x,
            y: m.y,
            facingX: m.fx as Axis,
            facingY: m.fy as Axis,
            inputX: m.ix as Axis,
            inputY: m.iy as Axis,
          });
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
              cmds.push({ type: 'damageEnemy', id, amount, by, kbx, kby, kbTicks, status, statusTicks });
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
          if (host) for (let k = 0; k + 1 < m.e.length; k += 2) cmds.push({ type: 'requestPickup', id: m.e[k]!, by: m.e[k + 1]! });
          break;
        case 'c':
          if (guest) cmds.push({ type: 'correctEnemies', data: m.e });
          break;
        case 'ping':
          this.replies.push({ t: 'pong', s: m.s });
          break;
        case 'pong':
          this.rttMs = this.now() - m.s;
          break;
      }
    }
    return cmds;
  }
}
