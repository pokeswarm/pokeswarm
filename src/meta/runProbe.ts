import type { RunSnapshot } from './runRecorder';

/**
 * ランの途中の様子の記録（作者の依頼 2026年10月28日。07 の112章）。
 * スマホの協力プレイで、ブラウザがページを読み込み直してトップに戻る（ページごと落ちる）ことがあり、原因を調べるために、
 * ラン中は数秒ごとにブラウザへ書いておき、ふつうに終わったら消す。次に開いたときに残っていたら、そのランは途中で終わっている。
 * ほかの人には関係ないので Firestore には書かない
 */
export interface RunProbe {
  /** 書いた時刻（Date.now） */
  at: number;
  version: string;
  /** ランの経過秒・区間・敵の数・発射体の数 */
  seconds: number;
  section: number;
  enemies: number;
  projectiles: number;
  /** 協力プレイの人数と、つながり方（直接・中継。ソロは null） */
  players: number;
  transport: 'p2p' | 'relay' | null;
  /** 協力プレイ: 送ったがまだ相手へ出ていない量（KB。全員の分の合計・一番多い人）と、ここまでの送受信の量（KB）。ソロは 0 */
  bufferedKB: number;
  maxBufferedKB: number;
  sentKB: number;
  receivedKB: number;
  /** 読み込んでいる絵の量（MB）と枚数 */
  textureMB: number;
  textures: number;
  /** JS のメモリ（MB。Chrome だけ。Safari は null） */
  heapMB: number | null;
  /** 1秒あたりの描画の回数 */
  fps: number;
  /** 協力プレイの役（ホスト・ゲスト。ソロは null。前の版の記録には無い） */
  role?: 'host' | 'guest' | null;
  /** 直前の書き込みからの間で、描画が一番長く空いた時間（ms）。落ちる直前に固まっていたかを見る（07 の344章） */
  worstFrameMs?: number;
  /** シミュレーション 1 回の時間（ms。ならした値） */
  simMs?: number;
  /**
   * 30 秒ごとの数の移り変わり（古い順。最大 trendSamples 個）。何が増え続けていたかを見る（07 の118章）。
   * 値は「名前: 数」。名前は RunScene.probeCounts を見る
   */
  trend?: { seconds: number; counts: Record<string, number> }[];
  /** ページを閉じた・ほかのページへ移った（pagehide）。落ちたときは false のまま */
  closed: boolean;
  /** ランの記録の写し（テストプレイは null。次に開いたときに「失敗」として終える） */
  snapshot: RunSnapshot | null;
}

const KEY = 'pokeswarm.runProbe';
const REPORT_KEY = 'pokeswarm.crashReport';

/**
 * クラッシュレポート（07 の344章）: ページごと落ちたランの、落ちる直前の様子。タイトルのボタンから見て、作者へ送れるように残しておく。
 * 次に落ちるまで（または消すまで）残る。セーブの写しは入れない
 */
export interface CrashReport {
  probe: Omit<RunProbe, 'snapshot'>;
  /** 失敗として保存したコイン（テストプレイは null） */
  coins: number | null;
  /** 端末とブラウザ（navigator.userAgent）・画面の大きさ */
  device: string;
  /** 落ちる直前の出来事（古い順。「分:秒 名前」。07 の348章） */
  crumbs?: string[];
  /** 最後の記録から、次にページが開くまでの時間（ms）。長ければ、固まってから落ちている */
  reloadGapMs?: number;
}

export function saveCrashReport(probe: RunProbe, coins: number | null, extra: { crumbs?: string[]; reloadGapMs?: number } = {}): void {
  try {
    const { snapshot: _snapshot, ...rest } = probe;
    const device = `${navigator.userAgent} / ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`;
    localStorage.setItem(REPORT_KEY, JSON.stringify({ probe: rest, coins, device, ...extra } satisfies CrashReport));
  } catch {
    // 保存できない環境では何もしない
  }
}

export function loadCrashReport(): CrashReport | null {
  try {
    const raw = localStorage.getItem(REPORT_KEY);
    return raw ? (JSON.parse(raw) as CrashReport) : null;
  } catch {
    return null;
  }
}

export function clearCrashReport(): void {
  try {
    localStorage.removeItem(REPORT_KEY);
  } catch {
    // 何もしない
  }
}

const CRUMBS_KEY = 'pokeswarm.runCrumbs';

/**
 * 落ちる直前の出来事の記録（07 の348章）。ランの様子の記録は 5 秒ごとなので、きっかけの出来事の直後に落ちると写らない。
 * まれな出来事（区間が進んだ・ボスが出た・届いた知らせの種類など）は、起きたその場でブラウザへ書く。
 * 同じ名前が続いたら数だけ増やす（「名前 ×3」）
 */
export class RunCrumbs {
  private list: { at: string; label: string; n: number }[] = [];
  private dirty = false;

  constructor(private readonly max: number) {}

  add(seconds: number, label: string): void {
    const last = this.list[this.list.length - 1];
    if (last && last.label === label) last.n++;
    else {
      const s = Math.max(0, Math.floor(seconds));
      this.list.push({ at: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, label, n: 1 });
      if (this.list.length > this.max) this.list.shift();
    }
    this.dirty = true;
  }

  lines(): string[] {
    return this.list.map((c) => `${c.at} ${c.label}${c.n > 1 ? ` ×${c.n}` : ''}`);
  }

  /** 変わっていたら書く */
  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      localStorage.setItem(CRUMBS_KEY, JSON.stringify(this.lines()));
    } catch {
      // 保存できない環境では何もしない
    }
  }
}

/** 前のランの出来事の記録を取り出して消す */
export function takeRunCrumbs(): string[] {
  try {
    const raw = localStorage.getItem(CRUMBS_KEY);
    localStorage.removeItem(CRUMBS_KEY);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function writeRunProbe(probe: RunProbe): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(probe));
  } catch {
    // 保存できない環境では何もしない
  }
}

/** ふつうにランが終わった（または始める前に戻った）: 記録を消す */
export function clearRunProbe(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(CRUMBS_KEY);
  } catch {
    // 何もしない
  }
}

/** 前のランの記録が残っていれば取り出して消す（途中で終わったラン） */
export function takeRunProbe(): RunProbe | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    return JSON.parse(raw) as RunProbe;
  } catch {
    return null;
  }
}
