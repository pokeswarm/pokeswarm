import { loadPokemonIcon, pixelArtIcon } from '../render/pokemonIcons';
import { t } from '../i18n';

/** 進化の演出の長さ（秒）: 前半は白いシルエットが入れ替わり、白く光ってから進化後の姿と文を見せる */
const BLINK_SECONDS = 2.2;
const REVEAL_SECONDS = 1.4;
const FADE_SECONDS = 0.4;
/** 大きく見せるときの、絵の長い辺（px） */
const SIZE = 200;
/** 入れ替わる間隔（ms）。だんだん速くなる */
const BLINK_START_MS = 280;
const BLINK_END_MS = 35;

/**
 * 進化の演出（作者の決定 2026年10月25日: レベルアップのカードを選んだ後、進化前・進化後の画像を交互に点滅させて派手に）。
 * DOM の重ね表示。ソロでは演出の間ゲームを止める（RunScene が active を見る）。協力プレイでは止めずに薄く重ねる
 */
export class EvolutionCutscene {
  private root: HTMLDivElement | null = null;
  private endAt = 0;
  private timers: number[] = [];

  /** 演出中か（ソロはこの間ゲームを止める） */
  get active(): boolean {
    return this.root !== null && performance.now() < this.endAt;
  }

  play(fromSprite: string, toSprite: string, fromName: string, toName: string, dim: number): void {
    this.destroy();
    const total = BLINK_SECONDS + REVEAL_SECONDS + FADE_SECONDS;
    this.endAt = performance.now() + total * 1000;
    const root = document.createElement('div');
    this.root = root;
    root.style.cssText = `position:fixed;inset:0;z-index:18;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(circle at 50% 45%, rgba(40,60,120,${dim}) 0%, rgba(0,0,0,${dim}) 70%);opacity:0;transition:opacity 0.25s`;
    // 後ろで回る光の筋（派手さ）
    const rays = document.createElement('div');
    rays.style.cssText = 'position:absolute;left:50%;top:45%;width:900px;height:900px;margin:-450px 0 0 -450px;border-radius:50%;background:repeating-conic-gradient(rgba(255,255,255,0.16) 0deg 8deg, rgba(255,255,255,0) 8deg 22deg);opacity:0;transition:opacity 0.4s;animation:pokeswarm-evo-spin 6s linear infinite';
    const stage = document.createElement('div');
    stage.style.cssText = 'position:relative;width:220px;height:220px;display:flex;align-items:center;justify-content:center';
    const img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'image-rendering:pixelated;filter:drop-shadow(0 0 18px rgba(255,255,255,0.9));transform:scale(1);transition:transform 0.25s';
    stage.append(img);
    const text = document.createElement('div');
    text.style.cssText = 'position:relative;color:#f8f8f8;font-size:24px;text-shadow:0 2px 0 #000,0 0 12px #000;text-align:center;min-height:1.6em;padding:0 16px';
    text.textContent = t('evolution.what', { name: fromName });
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0;transition:opacity 0.5s';
    root.append(rays, stage, text, flash);
    ensureKeyframes();
    document.body.append(root);
    this.timers.push(window.setTimeout(() => (root.style.opacity = '1'), 20));

    void Promise.all([loadPokemonIcon(fromSprite, '#ffffff'), loadPokemonIcon(toSprite, '#ffffff')]).then(([from, to]) => {
      if (this.root !== root || !from || !to) return;
      // 小さなドット絵を、長い辺が SIZE になるよう大きくする（進化前と進化後で同じ倍率にして、大きくなったのが分かるように）
      const scale = SIZE / Math.max(from.width, from.height, to.width, to.height);
      const fit = (icon: typeof from): void => {
        img.style.width = `${icon.width * scale}px`;
        img.style.height = `${icon.height * scale}px`;
      };
      img.src = from.url;
      fit(from);
      // 前半: 白いシルエットが入れ替わる（だんだん速く）
      const start = performance.now();
      let showTo = false;
      const blink = (): void => {
        if (this.root !== root) return;
        const k = Math.min(1, (performance.now() - start) / (BLINK_SECONDS * 1000));
        if (k >= 1) {
          reveal();
          return;
        }
        showTo = !showTo;
        img.src = showTo ? to.silhouetteUrl : from.silhouetteUrl;
        fit(showTo ? to : from);
        img.style.transform = `scale(${1 + 0.12 * k + (showTo ? 0.06 : 0)})`;
        rays.style.opacity = String(0.3 + 0.7 * k);
        this.timers.push(window.setTimeout(blink, BLINK_START_MS + (BLINK_END_MS - BLINK_START_MS) * Math.sqrt(k)));
      };
      // 後半: 白く光って、進化後の姿と文
      const reveal = (): void => {
        flash.style.transition = 'none';
        flash.style.opacity = '1';
        img.src = to.url;
        fit(to);
        img.style.transform = 'scale(1.35)';
        text.textContent = t('evolution.done', { from: fromName, to: toName });
        this.timers.push(window.setTimeout(() => {
          flash.style.transition = 'opacity 0.6s';
          flash.style.opacity = '0';
          img.style.transform = 'scale(1.2)';
        }, 30));
        this.timers.push(window.setTimeout(() => (root.style.opacity = '0'), REVEAL_SECONDS * 1000));
        this.timers.push(window.setTimeout(() => this.destroy(), (REVEAL_SECONDS + FADE_SECONDS) * 1000));
      };
      this.timers.push(window.setTimeout(blink, 300));
    });
  }

  /**
   * タマゴがかえる演出（07 の57章）: タマゴがだんだん速く左右に揺れ、ひびが2回入り、白く光ってベイビィポケモンが出る。
   * eggSprite は data/render/items.json の絵（<名前>-crack-1・-crack-2 がひびのコマ）
   */
  playHatch(eggSprite: string, babySprite: string, babyName: string, dim: number): void {
    this.destroy();
    const total = BLINK_SECONDS + REVEAL_SECONDS + FADE_SECONDS;
    this.endAt = performance.now() + total * 1000;
    const root = document.createElement('div');
    this.root = root;
    root.style.cssText = `position:fixed;inset:0;z-index:18;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;background:radial-gradient(circle at 50% 45%, rgba(40,90,60,${dim}) 0%, rgba(0,0,0,${dim}) 70%);opacity:0;transition:opacity 0.25s`;
    const stage = document.createElement('div');
    stage.style.cssText = 'position:relative;width:220px;height:220px;display:flex;align-items:center;justify-content:center';
    const img = document.createElement('img');
    img.alt = '';
    img.style.cssText = 'image-rendering:pixelated;filter:drop-shadow(0 0 14px rgba(255,255,255,0.8));transform-origin:50% 90%';
    stage.append(img);
    const text = document.createElement('div');
    text.style.cssText = 'position:relative;color:#f8f8f8;font-size:24px;text-shadow:0 2px 0 #000,0 0 12px #000;text-align:center;min-height:1.6em;padding:0 16px';
    text.textContent = t('hatch.what');
    const flash = document.createElement('div');
    flash.style.cssText = 'position:absolute;inset:0;background:#fff;opacity:0;transition:opacity 0.5s';
    root.append(stage, text, flash);
    document.body.append(root);
    this.timers.push(window.setTimeout(() => (root.style.opacity = '1'), 20));
    const frames = [eggSprite, `${eggSprite}-crack-1`, `${eggSprite}-crack-2`].map((k) => pixelArtIcon(eggSprite, '#ffffff', k));
    void loadPokemonIcon(babySprite, '#ffffff').then((baby) => {
      const egg = frames[0];
      if (this.root !== root || !egg || !baby) return;
      // タマゴは長い辺が SIZE の 6 割、かえったポケモンは SIZE（小さなタマゴから出てくる）
      const fit = (icon: { width: number; height: number }, size: number): void => {
        const k = size / Math.max(icon.width, icon.height);
        img.style.width = `${icon.width * k}px`;
        img.style.height = `${icon.height * k}px`;
      };
      img.src = egg.url;
      fit(egg, SIZE * 0.6);
      // 前半: 左右に揺れる（だんだん速く大きく）。4 割と 7 割でひびが入る
      const start = performance.now();
      let side = 1;
      const wobble = (): void => {
        if (this.root !== root) return;
        const k = Math.min(1, (performance.now() - start) / (BLINK_SECONDS * 1000));
        if (k >= 1) {
          reveal();
          return;
        }
        const frame = frames[k > 0.7 ? 2 : k > 0.4 ? 1 : 0];
        if (frame) img.src = frame.url;
        side = -side;
        img.style.transform = `rotate(${side * (6 + 14 * k)}deg)`;
        this.timers.push(window.setTimeout(wobble, BLINK_START_MS + (BLINK_END_MS * 2 - BLINK_START_MS) * Math.sqrt(k)));
      };
      const reveal = (): void => {
        flash.style.transition = 'none';
        flash.style.opacity = '1';
        img.src = baby.url;
        fit(baby, SIZE);
        img.style.transform = 'scale(1.1)';
        text.textContent = t('hatch.done', { name: babyName });
        this.timers.push(window.setTimeout(() => {
          flash.style.transition = 'opacity 0.6s';
          flash.style.opacity = '0';
          img.style.transform = 'scale(1)';
        }, 30));
        this.timers.push(window.setTimeout(() => (root.style.opacity = '0'), REVEAL_SECONDS * 1000));
        this.timers.push(window.setTimeout(() => this.destroy(), (REVEAL_SECONDS + FADE_SECONDS) * 1000));
      };
      this.timers.push(window.setTimeout(wobble, 300));
    });
  }

  destroy(): void {
    for (const id of this.timers) clearTimeout(id);
    this.timers = [];
    this.root?.remove();
    this.root = null;
    this.endAt = 0;
  }
}

function ensureKeyframes(): void {
  if (document.getElementById('pokeswarm-evo-style')) return;
  const style = document.createElement('style');
  style.id = 'pokeswarm-evo-style';
  style.textContent = '@keyframes pokeswarm-evo-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.append(style);
}
