import Phaser from 'phaser';
import { generated, networkConfig, playablesConfig, unlocksConfig } from '../data';
import { isPlayableUnlocked } from '../meta/progress';
import { localName } from '../data/simRules';
import type { SpriteAnims } from '../data/schema';
import { getLocale, t, type MessageKey } from '../i18n';
import type { Room, RoomPlayer } from '../net/room';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';
import { formatTag } from '../meta/nickname';
import { session } from '../meta/session';
import type { RunSceneData } from './RunScene';

export interface LobbySceneData {
  /** host: 部屋を作る、join: roomId の部屋に入る */
  mode: 'host' | 'join';
  roomId?: string;
  /** 確認用: 直接接続を試さず中継で始める・直接接続をわざと失敗させる */
  forceRelay?: boolean;
  simulateP2PFailure?: boolean;
}

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'padding:10px 18px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';

/**
 * 協力プレイの待合室（DOM。見た目の作り込みはフェーズ4）。
 * 参加用 URL を送って最大4人が集まり、各自がポケモンを選ぶ。ホストが開始すると全員のランが始まる。
 */
export class LobbyScene extends Phaser.Scene {
  private params!: LobbySceneData;
  private root!: HTMLDivElement;
  private room: Room | null = null;
  private readonly sprites = new Map<string, SpriteAnims | null>();
  private message: { key: MessageKey; params?: Record<string, string | number> } | null = null;
  private starting = false;
  /** 招待を送ったフレンド */
  private invited = new Set<string>();

  constructor() {
    super('lobby');
  }

  init(data: LobbySceneData): void {
    this.params = data;
    this.room = null;
    this.message = null;
    this.starting = false;
    this.invited = new Set();
  }

  create(): void {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(760px,92vw);padding:24px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box';
    document.body.appendChild(this.root);
    const onKey = (ev: KeyboardEvent): void => this.onKey(ev);
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      window.removeEventListener('keydown', onKey);
      this.root.remove();
      // 開始せずに抜けたら部屋を出る（開始したらランの画面が使う）
      if (this.room && !this.starting) void this.room.leave();
      if (this.room) {
        this.room.onChange = null;
        this.room.onStart = null;
      }
    });
    // 全員のポケモンのスプライトを読んでおく（ランの画面でほかの人のポケモンを描くため）
    for (const [key, p] of Object.entries(playablesConfig.pokemon)) {
      void loadPokemonAtRuntime(this, p.sprite).then((loaded) => this.sprites.set(key, loaded?.manifest ?? null));
    }
    session.setPresence('lobby');
    // フレンドのオンライン状態が変わったら、招待の一覧を作り直す
    let offSocial: (() => void) | null = null;
    const bind = (): void => {
      offSocial?.();
      offSocial = session.social?.onChange(() => this.render()) ?? null;
      this.render();
    };
    const offStatus = session.onStatus(bind);
    offSocial = session.social?.onChange(() => this.render()) ?? null;
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      offStatus();
      offSocial?.();
      // 送った招待は取り消す（開始した・部屋を出た）
      void session.social?.cancelInvites();
    });
    this.message = { key: this.params.mode === 'host' ? 'lobby.creating' : 'lobby.joining' };
    this.render();
    void this.connect();
  }

  private async connect(): Promise<void> {
    try {
      const { Room } = await import('../net/room');
      const options = { forceRelay: this.params.forceRelay, simulateP2PFailure: this.params.simulateP2PFailure };
      const room = this.params.mode === 'host' ? await Room.create(networkConfig, options) : await Room.join(networkConfig, this.params.roomId ?? '', options);
      if (!this.sys.isActive()) {
        void room.leave();
        return;
      }
      this.room = room;
      this.message = null;
      // 自分の強化のレベルを知らせる（ほかの人の画面でも同じ強さで動かすため）
      void room.setUpgrades(session.store.current.upgrades, session.store.current.achievements);
      room.onChange = () => this.render();
      room.onStart = (players) => this.startRun(players);
      room.onLeave = (id) => {
        if (id === 1) {
          this.message = { key: 'net.hostLeft' };
          this.render();
        }
      };
      this.render();
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'notFound') this.message = { key: 'net.notFound' };
      else if (code === 'full') this.message = { key: 'net.full', params: { max: networkConfig.maxPlayers } };
      else if (code === 'started') this.message = { key: 'net.started' };
      else this.message = { key: 'net.failed', params: { message: err instanceof Error ? err.message : String(err) } };
      this.render();
    }
  }

  private startRun(players: RoomPlayer[]): void {
    const room = this.room;
    if (!room || this.starting) return;
    const me = players.find((p) => p.id === room.localId);
    if (!me) return;
    this.starting = true;
    const data: RunSceneData = {
      pokemon: me.pokemon,
      playerSprite: this.sprites.get(me.pokemon) ?? null,
      coop: { room, players, sprites: new Map(this.sprites) },
    };
    this.scene.start('run', data);
  }

  private choose(index: number): void {
    const key = this.choosable()[index];
    if (key && this.room) void this.room.choosePokemon(key);
  }

  private onKey(ev: KeyboardEvent): void {
    if (ev.repeat) return;
    const n = Number(ev.key);
    if (n >= 1 && n <= 9) this.choose(n - 1);
    else if (ev.key === 'Enter' && this.room?.canStart) void this.room.start();
    else if (ev.key === 'Escape') this.scene.start('title');
  }

  /** 選べるポケモン（解放していて、遊べるもの） */
  private choosable(): string[] {
    return Object.keys(playablesConfig.pokemon).filter((k) =>
      isPlayableUnlocked(session.store.current, unlocksConfig, k, playablesConfig.pokemon[k]!.unlock),
    );
  }

  private pokemonName(key: string): string {
    return localName(generated.pokemon[key]?.names, getLocale(), key);
  }

  private render(): void {
    const room = this.room;
    const title = document.createElement('div');
    title.style.cssText = 'font-size:24px;font-weight:bold;margin-bottom:12px';
    title.textContent = t('lobby.title');
    const children: HTMLElement[] = [title];

    if (this.message) {
      const msg = document.createElement('div');
      msg.style.cssText = 'margin:12px 0';
      msg.textContent = t(this.message.key, this.message.params);
      children.push(msg);
    }

    if (room) {
      if (room.role === 'host') {
        const url = new URL(window.location.href);
        url.search = new URLSearchParams({ join: room.roomId }).toString();
        const hint = document.createElement('div');
        hint.textContent = t('lobby.joinHint', { max: networkConfig.maxPlayers });
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;margin:6px 0 16px';
        const input = document.createElement('input');
        Object.assign(input, { value: url.toString(), readOnly: true });
        input.style.cssText = 'flex:1;font-family:inherit;font-size:16px;padding:6px';
        const copy = document.createElement('button');
        copy.style.cssText = BUTTON;
        copy.textContent = t('net.copy');
        copy.onclick = () => void navigator.clipboard.writeText(url.toString()).then(() => (copy.textContent = t('net.copied')));
        row.append(input, copy);
        children.push(hint, row);
      }

      const list = document.createElement('div');
      list.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:16px';
      for (let id = 1; id <= networkConfig.maxPlayers; id++) {
        const m = room.memberList.find((x) => x.id === id);
        const cell = document.createElement('div');
        cell.style.cssText = `padding:10px 12px;border-radius:6px;border:2px solid ${id === room.localId ? '#ffb300' : '#f8f8f8'};background:#000000;min-height:52px`;
        const name = document.createElement('div');
        name.style.fontWeight = 'bold';
        name.textContent = t('lobby.player', { n: id }) + (id === 1 ? t('lobby.host') : '') + (id === room.localId ? t('lobby.you') : '');
        const state = document.createElement('div');
        state.style.cssText = 'font-size:16px;opacity:0.85';
        state.textContent = !m ? t('lobby.empty') : !m.connected ? t('lobby.connecting') : m.pokemon ? this.pokemonName(m.pokemon) : t('lobby.choosing');
        cell.append(name, state);
        list.append(cell);
      }
      children.push(list);

      const chooseLabel = document.createElement('div');
      chooseLabel.textContent = t('lobby.choose');
      const choices = document.createElement('div');
      choices.style.cssText = 'display:flex;gap:8px;margin:6px 0 16px';
      const mine = room.memberList.find((m) => m.id === room.localId)?.pokemon;
      this.choosable().forEach((key, i) => {
        const b = document.createElement('button');
        b.style.cssText = BUTTON + `;flex:1;${mine === key ? 'border-color:#ffb300;background:#3d2a08' : ''}`;
        b.textContent = `${i + 1}. ${this.pokemonName(key)}`;
        b.onclick = () => this.choose(i);
        choices.append(b);
      });
      children.push(chooseLabel, choices);

      // ホスト: オンラインのフレンドを招待する（Google でログインしてニックネームを登録しているとき）
      const social = session.social;
      if (room.role === 'host' && social?.profile) {
        const label = document.createElement('div');
        label.textContent = t('lobby.friends');
        const list = document.createElement('div');
        list.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 16px';
        const online = social.friends.filter((f) => f.presence);
        if (online.length === 0) {
          const none = document.createElement('div');
          none.style.opacity = '0.75';
          none.textContent = t('lobby.noFriendsOnline');
          list.append(none);
        }
        for (const f of online) {
          const b = document.createElement('button');
          const invited = this.invited.has(f.uid);
          b.style.cssText = BUTTON + (invited ? ';opacity:0.6' : '');
          b.textContent = `${formatTag(f.nickname, f.tag)}　${t(invited ? 'lobby.invited' : 'lobby.invite')}`;
          b.disabled = invited;
          b.onclick = () => {
            this.invited.add(f.uid);
            void social.invite(f.uid, room.roomId);
            this.render();
          };
          list.append(b);
        }
        children.push(label, list);
      }
    }

    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;gap:8px;align-items:center';
    if (room?.role === 'host') {
      const start = document.createElement('button');
      start.style.cssText = BUTTON + ';flex:1';
      start.textContent = t('lobby.start');
      start.disabled = !room.canStart;
      if (!room.canStart) start.style.opacity = '0.5';
      start.onclick = () => void room.start();
      footer.append(start);
    } else if (room) {
      const wait = document.createElement('div');
      wait.style.flex = '1';
      wait.textContent = t('lobby.waitStart');
      footer.append(wait);
    }
    const leave = document.createElement('button');
    leave.style.cssText = BUTTON;
    leave.textContent = t('lobby.leave');
    leave.onclick = () => this.scene.start('title');
    footer.append(leave);
    children.push(footer);
    if (room?.role === 'host' && !room.canStart) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:16px;opacity:0.75;margin-top:8px';
      note.textContent = t('lobby.waitAll');
      children.push(note);
    }
    this.root.replaceChildren(...children);
  }
}
