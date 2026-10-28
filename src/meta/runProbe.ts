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
