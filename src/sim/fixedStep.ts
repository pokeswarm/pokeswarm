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

  /** 経過ミリ秒を足し、今回進めるべき更新回数を返す。maxSteps を渡すとその回の上限を変える */
  advance(elapsedMs: number, maxSteps = this.maxStepsPerFrame): number {
    this.accumulator += Math.max(0, elapsedMs);
    let steps = Math.floor(this.accumulator / this.stepMs);
    if (steps > maxSteps) {
      // 大きく遅れたときは追いつくのを諦めて捨てる
      steps = maxSteps;
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
