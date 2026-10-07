/**
 * 显示值动画控制器（Tech_stack.md §8）。
 *
 * 三组状态（§8.1）：
 *   targetScores     视觉目标（由数据状态机给出，等于最新有效输入）
 *   displayedScores  当前绘制值（本模块唯一维护的对象）
 *   latestRawScores  在 data/controller.ts（读数用，不经动画）
 *
 * 规则：
 * - 第一份结果：entryMs 渐显（从全零显示值插值到目标）；
 * - 离散更新：transitionMs 无过冲 smoothstep 过渡；动画中途收到新目标时，
 *   先按当前时间计算真实显示值，再从该值向最新目标形变——
 *   不回到旧起点、不排队播放旧结果、不重播入场动画；
 * - 流式跟随：k = 1 - exp(-dt / tau) 一阶连续跟随；最大误差小于
 *   streamSnapEpsilon 时吸附到精确目标，停止高成本重绘；
 * - 动效关闭（用户开关或系统减少动态）：立即收敛到目标，数据仍继续接收；
 * - 位置连续只保证一阶（数值连续），不保证速度导数连续（§8.2）。
 *
 * 本模块不接触 DOM：时钟与调度注入，便于受控单元测试。
 */

export interface MotionControllerOptions {
  entryMs: number;
  transitionMs: number;
  streamTauMs: number;
  /** 流式收敛阈值（分值）。 */
  snapEpsilon: number;
  now(): number;
  schedule(callback: () => void): unknown;
  cancel(handle: unknown): void;
  /** 显示值变化时回调（数组为 SCENT_KEYS 固定顺序；null 表示云已清除）。 */
  onFrame(displayed: number[] | null): void;
  /** 过渡进行 / 结束时回调（用于 Updating visualization 标记）。 */
  onAnimatingChange(animating: boolean): void;
}

interface TimedTransition {
  from: number[];
  to: number[];
  start: number;
  duration: number;
}

/** E(t) = t²(3-2t)：无过冲缓动（Tech_stack.md §8.2）。 */
function easeSmoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * 当前存活的控制器实例数（模块级）。
 * P5 生命周期验收用：反复挂载/销毁后应回到基线，暴露给演示页测试钩子。
 */
let liveControllerCount = 0;

export function getLiveControllerCount(): number {
  return liveControllerCount;
}

function maxAbsDiff(a: readonly number[], b: readonly number[]): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
  }
  return max;
}

export function createMotionController(options: MotionControllerOptions): {
  setTarget(scores: number[] | null, mode: "discrete" | "stream"): void;
  /** 动效开关（已合并减少动态偏好后的有效值）。 */
  setEnabled(enabled: boolean): void;
  /** 页面恢复可见：显示值直接追上最新目标，不补播积压动画。 */
  catchUp(): void;
  getDisplayed(): number[] | null;
  isAnimating(): boolean;
  dispose(): void;
} {
  const target: number[] | null = null;
  let currentTarget: number[] | null = target;
  let displayed: number[] | null = null; // null = 云已清除（无显示数据）
  let hasEverHadTarget = false;
  liveControllerCount += 1;

  let enabled = true;
  let transition: TimedTransition | null = null;
  let streamFollow = false;
  let loopHandle: unknown = null;
  let lastTickTime: number | null = null;
  let animating = false;
  let disposed = false;

  function setAnimating(next: boolean): void {
    if (animating === next || disposed) return;
    animating = next;
    options.onAnimatingChange(next);
  }

  function emitFrame(): void {
    options.onFrame(displayed === null ? null : [...displayed]);
  }

  function stopLoop(): void {
    if (loopHandle !== null) {
      options.cancel(loopHandle);
      loopHandle = null;
    }
    lastTickTime = null;
  }

  function ensureLoop(): void {
    if (loopHandle !== null || disposed) return;
    loopHandle = options.schedule(() => {
      loopHandle = null;
      tick();
    });
  }

  function settleToTarget(): void {
    const changed =
      currentTarget === null
        ? displayed !== null
        : displayed === null || maxAbsDiff(displayed, currentTarget) > 0;
    transition = null;
    streamFollow = false;
    displayed = currentTarget === null ? null : [...currentTarget];
    stopLoop();
    if (changed) emitFrame();
    setAnimating(false);
  }

  function tick(): void {
    if (disposed) return;
    const now = options.now();

    if (transition !== null) {
      const { from, to, start, duration } = transition;
      const u = Math.min(Math.max((now - start) / duration, 0), 1);
      const e = easeSmoothstep(u);
      displayed = from.map((v, i) => v + (to[i] - v) * e);
      if (u >= 1) {
        transition = null;
        displayed = [...to];
        if (to.every((v) => v === 0) && currentTarget === null) {
          // 清空目标：动画结束后云彻底清除（像素层输出全透明），
          // 下一份完整结果重新按入场渐显。
          displayed = null;
          hasEverHadTarget = false;
        }
        if (!streamFollow && (currentTarget === null || settled())) {
          stopLoop();
          setAnimating(false);
        }
      }
      emitFrame();
      if (loopHandle === null && (transition !== null || streamFollow)) ensureLoop();
      return;
    }

    if (streamFollow && currentTarget !== null) {
      const target = currentTarget;
      const dt = lastTickTime === null ? 0 : Math.max(0, now - lastTickTime);
      lastTickTime = now;
      const k = dt <= 0 ? 0 : 1 - Math.exp(-dt / options.streamTauMs);
      const base = displayed ?? new Array(target.length).fill(0);
      displayed = base.map((v, i) => v + (target[i] - v) * k);
      if (settled()) {
        displayed = [...target];
        stopLoop();
        setAnimating(false);
      } else {
        ensureLoop();
      }
      emitFrame();
      return;
    }

    // 无事可做：停环（静态时不持续重绘）。
    stopLoop();
    setAnimating(false);
  }

  function settled(): boolean {
    if (currentTarget === null) return displayed === null;
    if (displayed === null) return false;
    return maxAbsDiff(displayed, currentTarget) <= options.snapEpsilon;
  }

  function setTarget(scores: number[] | null, mode: "discrete" | "stream"): void {
    if (disposed) return;
    currentTarget = scores === null ? null : [...scores];

    // 动效关闭：新数据直接更新到最终状态（Request.md §5.6）。
    if (!enabled) {
      settleToTarget();
      return;
    }

    if (currentTarget === null) {
      // 清空目标：从当前显示值动画到全零，结束后由 tick 清除。
      if (displayed === null || displayed.every((v) => v === 0)) {
        displayed = null;
        transition = null;
        streamFollow = false;
        // 云已不在：下一份完整结果重新按入场渐显（§5.4）。
        hasEverHadTarget = false;
        stopLoop();
        emitFrame();
        setAnimating(false);
        return;
      }
      transition = {
        from: [...displayed],
        to: new Array(displayed.length).fill(0),
        start: options.now(),
        duration: options.transitionMs,
      };
      streamFollow = false;
      lastTickTime = null;
      setAnimating(true);
      ensureLoop();
      return;
    }

    if (mode === "stream") {
      // 流式：取消定时过渡，从当前显示值连续跟随（高频输入不重置缓动）。
      // 注意保留 lastTickTime：目标更新不打断时间基准，速度保持一阶连续。
      transition = null;
      streamFollow = true;
      if (settled()) {
        displayed = [...currentTarget];
        stopLoop();
        emitFrame();
        setAnimating(false);
      } else {
        setAnimating(true);
        ensureLoop();
      }
      return;
    }

    // 离散：从“当前真实显示值”重定向（§8.2）。动画中途先结算当前值。
    const from = snapshotDisplayedNow();
    const first = !hasEverHadTarget;
    hasEverHadTarget = true;
    transition = {
      from,
      to: [...currentTarget],
      start: options.now(),
      duration: first ? options.entryMs : options.transitionMs,
    };
    streamFollow = false;
    lastTickTime = null;
    setAnimating(true);
    ensureLoop();
  }

  /** 立即结算当前显示值（动画中途的真实值），供重定向起点使用。 */
  function snapshotDisplayedNow(): number[] {
    if (transition !== null) {
      const { from, to, start, duration } = transition;
      const u = Math.min(Math.max((options.now() - start) / duration, 0), 1);
      const e = easeSmoothstep(u);
      return from.map((v, i) => v + (to[i] - v) * e);
    }
    return displayed === null ? new Array(8).fill(0) : [...displayed];
  }

  function setEnabled(next: boolean): void {
    if (enabled === next || disposed) return;
    enabled = next;
    if (!enabled) {
      // 关闭动效：立即收敛到最新值，停止循环与过渡。
      settleToTarget();
    }
    // 重新开启：不补播过渡，等待下一份数据正常动画。
  }

  function catchUp(): void {
    if (disposed) return;
    settleToTarget();
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    stopLoop();
    liveControllerCount -= 1;
  }

  return {
    setTarget,
    setEnabled,
    catchUp,
    getDisplayed: () => (displayed === null ? null : [...displayed]),
    isAnimating: () => animating,
    dispose,
  };
}
