import Phaser from 'phaser';
import { firebaseOptionsFromEnv } from '../firebase/config';
import { t } from '../i18n';
import { AccountPanel } from './accountPanel';
import { TitleFooter } from './creditsPanel';
import { session } from '../meta/session';
import { audio } from '../audio';
import { bgmConfig, generated, groundConfig, playablesConfig, spriteRender, uiConfig } from '../data';
import type { SpriteAnims } from '../data/schema';
import { GroundTiles, preloadGroundTiles } from '../render/GroundTiles';
import { drawWindow, pixelButton, px } from '../render/pixelUi';
import { directionIndex, PokemonSpriteView } from '../render/sprites/PokemonSprite';
import { loadPokemonAtRuntime } from '../render/sprites/runtimeLoad';

/**
 * タイトル画面（ドット調。作者の決定 2026年10月22日）。各画面へのボタンを並べる。
 * クリックのほか、↑↓ で選んで Enter（原作のメニューと同じ ▶ のカーソル）。前のキー（C・F・A・S・O）もそのまま使える。
 * 下にログインの状態と記録を出す
 */
export class TitleScene extends Phaser.Scene {
  constructor() {
    super('title');
  }

  preload(): void {
    preloadGroundTiles(this, groundConfig);
  }

  /**
   * 背景（作者の決定 2026年10月22日）: ゲーム画面と同じように、真ん中でピカチュウが歩き、マップが流れる。
   * ほかの遊べるポケモン（進化の途中・進化先も）が、ときどき画面の端から現れて横切っていく（ピカチュウには近づかない）。
   * ポケモンは読み込めたものから現れる（読み込みを待たずに始める）
   */
  private createBackdrop(): { update: (deltaMs: number) => void; layout: () => void } {
    const cfg = uiConfig.titleWalk;
    const ground = new GroundTiles(this, groundConfig, 0);
    const shade = this.add.rectangle(0, 0, 10, 10, 0x000000, cfg.shade).setOrigin(0).setDepth(-500);
    let lead: PokemonSpriteView | null = null;
    const others: SpriteAnims[] = [];
    const passers: { view: PokemonSpriteView; vx: number; vy: number }[] = [];
    let camX = 0;
    let untilNext = 0;
    const rand = (r: readonly [number, number]): number => r[0] + Math.random() * (r[1] - r[0]);
    const leadPos = (): { x: number; y: number } => ({ x: this.scale.width / 2, y: this.scale.height * 0.62 });
    const layout = (): void => {
      shade.setSize(this.scale.width, this.scale.height);
      const p = leadPos();
      lead?.sprite.setPosition(p.x, p.y);
    };
    // 真ん中で歩くポケモン（右へ歩く。マップは左へ流れる）
    void loadPokemonAtRuntime(this, cfg.lead).then((r) => {
      if (!r || !this.sys.isActive()) return;
      lead = new PokemonSpriteView(this, r.manifest, cfg.scale);
      lead.sprite.setDepth(-50);
      lead.play(spriteRender.walkAnimation, directionIndex(1, 0));
      layout();
    });
    // 通り過ぎるポケモン: 遊べるポケモンと、その進化の途中・進化先（進化しない遊べるポケモンは、その姿だけ）
    const keys = new Set<string>();
    for (const [key, p] of Object.entries(playablesConfig.pokemon)) {
      const stack = [key];
      while (stack.length) {
        const k = stack.pop()!;
        if (keys.has(k) || !generated.pokemon[k]) continue;
        keys.add(k);
        if (p.evolves !== false) for (const e of generated.pokemon[k]!.evolvesTo) stack.push(e.to);
      }
    }
    keys.delete(cfg.lead);
    for (const k of keys) {
      void loadPokemonAtRuntime(this, k).then((r) => {
        if (r && this.sys.isActive()) others.push(r.manifest);
      });
    }
    /** 画面の端から、真ん中のポケモンに近づかない向きで横切るポケモンを1体出す */
    const spawnPasser = (): void => {
      if (others.length === 0 || passers.length >= cfg.maxPassers) return;
      const { width, height } = this.scale;
      const m = others[Math.floor(Math.random() * others.length)]!;
      const center = leadPos();
      // 横に歩く（右向き・左向き）。真ん中のポケモンの上か下を、keepAway より離れて通る
      const dir = Math.random() < 0.5 ? -1 : 1;
      const above = Math.random() < 0.5;
      const y = above ? rand([48, Math.max(48, center.y - cfg.keepAway)]) : rand([Math.min(height - 24, center.y + cfg.keepAway), height - 24]);
      const view = new PokemonSpriteView(this, m, cfg.scale);
      view.sprite.setPosition(dir > 0 ? -64 : width + 64, y).setDepth(-100 + y / 10000);
      view.play(spriteRender.walkAnimation, directionIndex(dir, 0));
      // 右へ歩くポケモンはピカチュウより速く歩いて追い越す（足踏みのまま後ろへ流されないように）
      passers.push({ view, vx: dir > 0 ? cfg.walkSpeed + rand(cfg.passerSpeed) : -rand(cfg.passerSpeed), vy: 0 });
    };
    layout();
    return {
      layout,
      update: (deltaMs) => {
        const dt = deltaMs / 1000;
        // マップは歩く速さで左へ流れる（カメラを動かすと上のメニューも動くので、模様だけずらす）
        camX += cfg.walkSpeed * dt;
        ground.update({ scrollX: camX, scrollY: 0 } as Phaser.Cameras.Scene2D.Camera, 0, deltaMs);
        untilNext -= dt;
        if (untilNext <= 0) {
          spawnPasser();
          untilNext = rand(cfg.passerEverySeconds);
        }
        // 通り過ぎるポケモンは、自分の歩く速さに、マップの流れを足して動く。画面の外へ出たら消す
        const { width } = this.scale;
        for (let i = passers.length - 1; i >= 0; i--) {
          const p = passers[i]!;
          p.view.sprite.x += (p.vx - cfg.walkSpeed) * dt;
          p.view.sprite.y += p.vy * dt;
          if (p.view.sprite.x < -96 || p.view.sprite.x > width + 96) {
            p.view.sprite.destroy();
            passers.splice(i, 1);
          }
        }
      },
    };
  }

  create(): void {
    const backdrop = this.createBackdrop();
    const onUpdate = (_t: number, delta: number): void => backdrop.update(delta);
    this.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.events.off(Phaser.Scenes.Events.UPDATE, onUpdate));
    let ui: Phaser.GameObjects.Container | null = null;
    const coop = !!firebaseOptionsFromEnv();
    const items: { label: string; key: string | null; go: () => void }[] = [
      { label: t('title.menu.start'), key: null, go: () => this.scene.start('select') },
      ...(coop ? [{ label: t('title.menu.coop'), key: 'C', go: () => this.scene.start('lobby', { mode: 'host' }) }] : []),
      ...(coop ? [{ label: t('title.menu.friends'), key: 'F', go: () => this.scene.start('friends') }] : []),
      { label: t('title.menu.achievements'), key: 'A', go: () => this.scene.start('achievements') },
      { label: t('title.menu.shop'), key: 'S', go: () => this.scene.start('shop') },
      { label: t('title.menu.settings'), key: 'O', go: () => this.scene.start('settings') },
    ];
    let selected = 0;
    let buttons: Phaser.GameObjects.Container[] = [];
    let leaving = false;
    const go = (i: number): void => {
      if (leaving) return;
      leaving = true;
      items[i]!.go();
    };
    const showCursor = (): void => buttons.forEach((b, i) => (b.list[2] as Phaser.GameObjects.Text).setVisible(i === selected));
    const layout = (): void => {
      // メニューとタイトルだけを作り直す（背景のマップとフィルムは残す）
      ui?.destroy();
      ui = this.add.container(0, 0).setDepth(10);
      backdrop.layout();
      const { width, height } = this.scale;
      // 画面の高さが低い（横向きのスマホ）ときは、ロゴを小さくし、メニューを2列にする（ボタンは指で押せる高さ 44 以上）
      const compact = height < 520;
      const logoW = Math.min(width - 32, 640);
      const logoH = compact ? 64 : 104;
      const logoY = compact ? 8 : height * 0.08;
      const g = this.add.graphics();
      drawWindow(g, (width - logoW) / 2, logoY, logoW, logoH, 'dark');
      ui.add([g, this.add.text(width / 2, logoY + logoH / 2, t('title.name'), px(compact || width < 640 ? 32 : 48, '#f8d030', { outline: true })).setOrigin(0.5)]);
      // メニュー。真ん中はピカチュウが歩くので、左に寄せる（右下のログインの窓と重ならないように）
      const cols = compact ? 2 : 1;
      const bw = compact ? Math.min(180, (width / 2 - 24) / 2) : Math.min(width - 32, 360);
      const bh = compact || height < 700 ? 44 : 48;
      const gap = compact ? 6 : height < 700 ? 6 : 8;
      const top = logoY + logoH + (compact ? 10 : height < 700 ? 16 : 32);
      const left = Math.min(width / 2 - (cols * bw + (cols - 1) * gap) / 2, Math.max(16, width * 0.2 - bw / 2));
      buttons = items.map((it, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        return pixelButton(this, left + bw / 2 + col * (bw + gap), top + bh / 2 + row * (bh + gap), bw, bh, it.label, () => go(i)).on('pointerover', () => {
          selected = i;
          showCursor();
        });
      });
      ui.add(buttons);
      showCursor();
    };
    layout();
    this.scale.on('resize', layout);
    // 下の帯: 非公式の注意書きとクレジット（作者の決定）。ログインの窓はその上に置く
    const footer = new TitleFooter();
    const account = new AccountPanel(footer.height);
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.repeat || leaving) return;
      if (ev.key === 'ArrowDown') {
        selected = (selected + 1) % items.length;
        audio.sfx.play('ui.select');
        showCursor();
      } else if (ev.key === 'ArrowUp') {
        selected = (selected + items.length - 1) % items.length;
        audio.sfx.play('ui.select');
        showCursor();
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        go(selected);
      } else {
        const i = items.findIndex((it) => it.key !== null && it.key === ev.key.toUpperCase());
        if (i !== -1) go(i);
      }
    };
    window.addEventListener('keydown', onKey);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', layout);
      window.removeEventListener('keydown', onKey);
      account.destroy();
      footer.destroy();
    });
    audio.bgm.play(bgmConfig.scenes.title);
    session.setPresence('menu');
  }
}
