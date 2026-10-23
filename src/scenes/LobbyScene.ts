import Phaser from 'phaser';
import { generated, networkConfig, playablesConfig, regionsConfig, uiConfig } from '../data';
import { localName } from '../data/simRules';
import type { SpriteAnims } from '../data/schema';
import { getLocale, t, type MessageKey } from '../i18n';
import type { Room, RoomPlayer } from '../net/room';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';
import { shinySpriteKey } from '../meta/loadoutOptions';
import { LoadoutOptionsPanel } from './loadoutOptionsPanel';
import { formatTag } from '../meta/nickname';
import { compactScreen } from '../render/pixelUi';
import { session } from '../meta/session';
import type { RunSceneData } from './RunScene';
import { pokemonIconImage, PokemonPicker } from './pokemonPicker';
import { defaultRegion } from './RegionScene';

export interface LobbySceneData {
  /** host: 部屋を作る、join: roomId の部屋に入る */
  mode: 'host' | 'join';
  roomId?: string;
  /** host: マップの選択で選んだ地方。ゲストは部屋に書いてある地方を使う */
  region?: string;
  /** 確認用: 直接接続を試さず中継で始める・直接接続をわざと失敗させる */
  forceRelay?: boolean;
  simulateP2PFailure?: boolean;
}

// 原作をまねた白い窓のボタン（作者の決定。2026年10月22日。src/render/pixelUi.ts の windowCss と同じ見た目）
const BUTTON = 'min-height:44px;padding:10px 18px;cursor:pointer;font:inherit;font-size:16px;background:#f8f8f8;color:#383848;border:4px solid #383848;border-radius:6px;box-shadow:inset 0 0 0 3px #f8f8f8,inset 0 0 0 5px #a8b8c8';

/**
 * 協力プレイの待合室（DOM。見た目の作り込みはフェーズ4）。
 * 参加用 URL を送って最大4人が集まり、各自がポケモンを選ぶ。ホストが開始すると全員のランが始まる。
 * 上に4つの枠（ホスト・ゲスト・ゲスト・ゲスト）を並べ、選んだポケモンのアイコンを出す。真ん中にソロと同じポケモンの一覧（作者の案 2026年10月22日）
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
  private picker: PokemonPicker | null = null;
  /** 最初の持ち物・色違い */
  private options: LoadoutOptionsPanel | null = null;

  constructor() {
    super('lobby');
  }

  init(data: LobbySceneData): void {
    this.params = data;
    this.room = null;
    this.message = null;
    this.starting = false;
    this.invited = new Set();
    this.picker = null;
    this.options = null;
  }

  create(): void {
    this.root = document.createElement('div');
    this.root.style.cssText =
      'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,96vw);max-height:96vh;overflow:auto;padding:16px 24px;background:#000;color:#f8f8f8;border:4px solid #f8f8f8;box-shadow:inset 0 0 0 2px #000,inset 0 0 0 4px #f8f8f8;font-family:inherit;font-size:16px;line-height:1.6;border-radius:6px;z-index:20;box-sizing:border-box';
    // 低い画面（横向きのスマホ）では余白をつめる
    if (compactScreen()) this.root.style.cssText += ';padding:8px 12px';
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
    // 全員のポケモンのスプライトを読んでおく（ランの画面でほかの人のポケモンを描くため。色違いは開始するときに読む）
    for (const p of Object.values(playablesConfig.pokemon)) {
      void loadPokemonAtRuntime(this, p.sprite).then((loaded) => this.sprites.set(p.sprite, loaded?.manifest ?? null));
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
      const room = this.params.mode === 'host' ? await Room.create(networkConfig, this.params.region ?? defaultRegion(), options) : await Room.join(networkConfig, this.params.roomId ?? '', options);
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
    const spriteOf = (p: RoomPlayer): string => {
      const key = playablesConfig.pokemon[p.pokemon]?.sprite ?? p.pokemon;
      return p.shiny ? shinySpriteKey(key) : key;
    };
    // 色違いのスプライトを読んでから始める
    const shiny = [...new Set(players.filter((p) => p.shiny).map(spriteOf))].filter((k) => !this.sprites.has(k));
    void Promise.all(shiny.map((k) => loadPokemonAtRuntime(this, k).then((loaded) => this.sprites.set(k, loaded?.manifest ?? null)))).then(() => {
      if (!this.sys.isActive()) return;
      const data: RunSceneData = {
        pokemon: me.pokemon,
        playerSprite: this.sprites.get(spriteOf(me)) ?? null,
        coop: { room, players, sprites: new Map(this.sprites) },
      };
      this.scene.start('run', data);
    });
  }

  private onKey(ev: KeyboardEvent): void {
    const dir: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dir[ev.key];
    if (d) {
      ev.preventDefault();
      this.picker?.move(d[0], d[1]);
      return;
    }
    if (ev.repeat) return;
    if (ev.key === 'Enter' && this.room?.canStart) void this.room.start();
    else if (ev.key === 'Escape') this.scene.start('title');
  }

  private pokemonName(key: string): string {
    return localName(generated.pokemon[key]?.names, getLocale(), key);
  }

  private render(): void {
    const room = this.room;
    const title = document.createElement('div');
    title.style.cssText = 'display:flex;align-items:baseline;gap:16px;flex-wrap:wrap;margin-bottom:6px';
    const titleText = document.createElement('span');
    titleText.style.cssText = `font-size:${compactScreen() ? 20 : 24}px;font-weight:bold`;
    titleText.textContent = this.room ? `${t('lobby.title')} - ${localName(generated.regions[this.room.region]?.names, getLocale(), this.room.region)}` : t('lobby.title');
    title.append(titleText);
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
        // 案内はタイトルの横に（縦に収めるため）
        const hint = document.createElement('span');
        hint.style.opacity = '0.85';
        if (compactScreen()) hint.style.display = 'none';
        hint.textContent = t('lobby.joinHint', { max: networkConfig.maxPlayers });
        const row = document.createElement('div');
        row.style.cssText = `display:flex;gap:8px;margin:${compactScreen() ? 0 : '0 0 10px'}`;
        const input = document.createElement('input');
        Object.assign(input, { value: url.toString(), readOnly: true });
        input.style.cssText = 'flex:1;font-family:inherit;font-size:16px;padding:6px';
        const copy = document.createElement('button');
        // 低い画面では列の幅いっぱい（左の列の部品はすべて同じ幅にそろえる）
        copy.style.cssText = BUTTON + (compactScreen() ? ';width:100%' : '');
        copy.textContent = t('net.copy');
        copy.onclick = () => void navigator.clipboard.writeText(url.toString()).then(() => (copy.textContent = t('net.copied')));
        // 低い画面では URL の欄を出さず、コピーのボタンだけ（幅が足りない）
        if (compactScreen()) row.append(copy);
        else row.append(input, copy);
        title.append(hint);
        children.push(row);
      }

      // 上の4つの枠: ホスト・ゲスト・ゲスト・ゲスト。選んだポケモンのアイコンを出す
      const slots = document.createElement('div');
      // 低い画面では 2×2（左の列に収める）
      slots.style.cssText = `display:grid;grid-template-columns:repeat(${compactScreen() ? 2 : networkConfig.maxPlayers},1fr);gap:${compactScreen() ? 4 : 8}px;margin-bottom:${compactScreen() ? 0 : 10}px`;
      for (let id = 1; id <= networkConfig.maxPlayers; id++) {
        const m = room.memberList.find((x) => x.id === id);
        const cell = document.createElement('div');
        const small = compactScreen();
        cell.style.cssText = `padding:${small ? 2 : 6}px;border-radius:6px;border:4px solid ${id === room.localId ? uiConfig.picker.selected : '#f8f8f8'};background:#000;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center;min-width:0`;
        const role = document.createElement('div');
        role.textContent = t(id === 1 ? 'lobby.slotHost' : 'lobby.slotGuest') + (id === room.localId ? t('lobby.you') : '');
        const box = document.createElement('div');
        box.style.cssText = `width:${small ? 32 : 48}px;height:${small ? 32 : 48}px;background:${uiConfig.window.fill};border-radius:4px;opacity:${m ? 1 : 0.25}`;
        if (m?.pokemon) box.append(pokemonIconImage(m.pokemon, small ? 32 : 48));
        const state = document.createElement('div');
        state.style.cssText = 'font-size:16px;opacity:0.85;overflow-wrap:anywhere';
        state.textContent = !m ? t('lobby.empty') : !m.connected ? t('lobby.connecting') : m.pokemon ? this.pokemonName(m.pokemon) : t('lobby.choosing');
        // 低い画面では状態の文を出さない（アイコンと枠の明るさで分かる）
        if (small) cell.append(role, box);
        else cell.append(role, box, state);
        slots.append(cell);
      }
      children.push(slots);

      // 真ん中: ポケモンの一覧（選ぶとすぐ自分の枠に出る）
      const mine = room.memberList.find((m) => m.id === room.localId)?.pokemon ?? null;
      const region = regionsConfig.regions.find((r) => r.id === room.region && r.available) ?? regionsConfig.regions.find((r) => r.id === defaultRegion())!;
      this.options ??= new LoadoutOptionsPanel((o) => void this.room?.setLoadoutOptions(o.startItem, o.shiny));
      this.picker ??= new PokemonPicker({
        playables: region.playables,
        onSelect: (key) => {
          void this.room?.choosePokemon(key);
          this.options?.setPokemon(key);
        },
      });
      this.picker.setSelected(mine);
      this.options.setPokemon(mine);
      this.picker.element.style.marginBottom = '10px';
      children.push(this.picker.element, this.options.element);

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
      // 開始できないときの案内は、ボタンの左に
      const note = document.createElement('div');
      note.style.cssText = 'flex:1;opacity:0.75';
      // 低い画面では出さない（細い列で縦に長くなる。開始のボタンが押せないことで分かる）
      if (!room.canStart && !compactScreen()) note.textContent = t('lobby.waitAll');
      footer.append(note);
      start.style.cssText = BUTTON;
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
    // ボタンの並べ方の決まり: PC は右寄せで同じ幅、低い画面は列の幅を2等分して列の一番下に置く
    const buttonsInFooter = [...footer.querySelectorAll('button')];
    if (compactScreen()) {
      footer.style.cssText = 'display:grid;grid-template-columns:repeat(2,1fr);gap:6px;margin-top:auto';
      for (const c of [...footer.children]) {
        if (c instanceof HTMLButtonElement) c.style.width = '100%';
        else if (c.textContent) (c as HTMLElement).style.gridColumn = '1 / -1';
        else c.remove();
      }
      if (buttonsInFooter.length === 1) buttonsInFooter[0]!.style.gridColumn = '1 / -1';
    } else {
      for (const b of buttonsInFooter) b.style.minWidth = '12em';
    }
    children.push(footer);
    // 低い画面（横向きのスマホ）では縦が足りないので2列にする: 左に部屋の情報・4人の枠・ボタン、右にポケモンの一覧
    const picker = this.picker?.element;
    if (compactScreen() && picker && children.includes(picker)) {
      const left = document.createElement('div');
      left.style.cssText = 'flex:0 0 40%;min-width:0;display:flex;flex-direction:column;gap:6px';
      left.append(...children.filter((c) => c !== picker));
      const right = document.createElement('div');
      right.style.cssText = 'flex:1;min-width:0';
      picker.style.marginBottom = '0';
      right.append(picker);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:12px;align-items:stretch';
      row.append(left, right);
      this.root.replaceChildren(row);
      return;
    }
    this.root.replaceChildren(...children);
  }
}
