/**
 * 固定間隔の更新のための時計。
 * 経過時間をためて、何回シミュレーションを進めるかと、描画の補間率を返す。
 */
export class FixedStepClock {
  readonly stepMs: number;
  private accumulator = 0;

  constructor(
    tickRate: number,
    private readonly maxStepsPerFrame: number,
  ) {
    this.stepMs = 1000 / tickRate;
  }

  /** 経過ミリ秒を足し、今回進めるべき更新回数を返す */
  advance(elapsedMs: number): number {
    this.accumulator += Math.max(0, elapsedMs);
    let steps = Math.floor(this.accumulator / this.stepMs);
    if (steps > this.maxStepsPerFrame) {
      // 大きく遅れた（タブが裏にあった等）ときは追いつくのを諦めて捨てる
      steps = this.maxStepsPerFrame;
      this.accumulator = 0;
    } else {
      this.accumulator -= steps * this.stepMs;
    }
    return steps;
  }

  /** 直前の更新と次の更新の間のどこにいるか（0〜1）。描画の補間に使う */
  get alpha(): number {
    return this.accumulator / this.stepMs;
  }
}
