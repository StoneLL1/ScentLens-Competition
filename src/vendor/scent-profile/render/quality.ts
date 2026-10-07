/**
 * 质量档管理与显示尺寸分离（P5；Tech_stack.md §9.2、§9.4，implement_plan P5）。
 *
 * 职责一：四层尺寸分离——逻辑坐标（config.logicalSize，SVG/几何用）、
 * CSS 尺寸（stage 实际宽度）、显示 backing store（CSS × DPR，上限 dprCap）、
 * 云层计算缓冲区（低/中/高三档）。显示画布的 backing store 跟随容器与
 * DPR 变化（ResizeObserver + resolution 媒体查询），零尺寸时挂起等待恢复。
 *
 * 职责二：性能记录与自动降档。只测量云层像素绘制成本（onFrame 内的
 * paint）；按帧预算判定：连续超预算且度过保持期 → 降一档计算分辨率；
 * 已在最低档仍超预算 → 隔帧绘制（stride 2，最后手段）；持续宽裕 →
 * 升回。切档带滞回（最短保持时间），避免来回抖动。手动档位固定不自动切换。
 *
 * 本模块不接触 DOM（createDisplaySizeSync 除外，其仅依赖注入的元素）。
 */

export type QualityLevel = "auto" | "low" | "medium" | "high";
export type QualityTier = "low" | "medium" | "high";

export interface QualityFieldSizes {
  low: number;
  medium: number;
  high: number;
}

export interface FrameStats {
  /** 当前生效档位（auto 模式下为自动管理的实际档）。 */
  tier: QualityTier;
  /** 当前云层计算缓冲区边长。 */
  fieldSize: number;
  /** 用户设置的模式。 */
  mode: QualityLevel;
  /** 测量窗口内的已绘制帧数。 */
  samples: number;
  medianMs: number | null;
  p95Ms: number | null;
  /** 由相邻绘制帧间隔估计的云层更新帧率。 */
  approxFps: number | null;
  /** 绘制节流：1 = 每帧绘制，2 = 隔帧绘制（自动降档最后手段）。 */
  stride: number;
}

export interface QualityManagerOptions {
  fieldSizes: QualityFieldSizes;
  /** 单帧云层绘制成本预算（ms）。桌面按 30 fps、触屏按 24 fps 目标换算。 */
  frameBudgetMs: number;
  /** 初始模式；构造期生效，不触发 onTierChange（渲染器尚未创建）。 */
  initialMode?: QualityLevel;
  /** 统计窗口长度（按绘制帧计）。 */
  windowSamples?: number;
  /** 连续超预算帧数达到该值才考虑降档。 */
  slowStreakToDowngrade?: number;
  /** 连续宽裕（成本 < 预算×0.45）帧数达到该值才考虑升档。 */
  fastStreakToUpgrade?: number;
  /** 降档最短保持时间（ms），防止抖动。 */
  downgradeHoldMs?: number;
  /** 升档最短保持时间（ms）。 */
  upgradeHoldMs?: number;
  now(): number;
  /** auto 模式下档位变化（含 stride 变化）时回调；用于重建渲染器。 */
  onTierChange?(tier: QualityTier, fieldSize: number): void;
}

function median(sorted: readonly number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function createQualityManager(options: QualityManagerOptions): {
  setMode(mode: QualityLevel): void;
  getMode(): QualityLevel;
  getTier(): QualityTier;
  getFieldSize(): number;
  getStride(): 1 | 2;
  noteRender(costMs: number): void;
  getStats(): FrameStats;
  dispose(): void;
} {
  const {
    fieldSizes,
    frameBudgetMs,
    initialMode = "auto",
    windowSamples = 240,
    slowStreakToDowngrade = 45,
    fastStreakToUpgrade = 240,
    downgradeHoldMs = 5000,
    upgradeHoldMs = 10000,
    now,
    onTierChange,
  } = options;

  if (frameBudgetMs <= 0) {
    throw new TypeError("frameBudgetMs must be positive");
  }
  for (const key of ["low", "medium", "high"] as const) {
    if (!Number.isInteger(fieldSizes[key]) || fieldSizes[key] <= 0) {
      throw new TypeError(`fieldSizes.${key} must be a positive integer`);
    }
  }

  // auto 的基准档为 medium：强设备可手动选 high 做细节检查，
  // 自动管理只在 low ↔ medium 间切换，避免自动升 high 后来回抖动。
  let mode: QualityLevel = initialMode;
  let tier: QualityTier = mode === "auto" ? "medium" : mode;
  let stride: 1 | 2 = 1;
  let lastSwitchAt = now();
  let slowStreak = 0;
  let fastStreak = 0;

  const costs: number[] = [];
  const intervals: number[] = [];
  let lastFrameAt: number | null = null;
  let disposed = false;

  function applyModeTier(): void {
    const next: QualityTier = mode === "auto" ? "medium" : mode;
    if (next === tier) return;
    tier = next;
    stride = 1;
    lastSwitchAt = now();
    slowStreak = 0;
    fastStreak = 0;
    onTierChange?.(tier, fieldSizes[tier]);
  }

  function noteRender(costMs: number): void {
    if (disposed || !Number.isFinite(costMs) || costMs < 0) return;
    const at = now();
    if (lastFrameAt !== null) {
      const dt = at - lastFrameAt;
      if (dt > 0) {
        intervals.push(dt);
        if (intervals.length > windowSamples) intervals.shift();
      }
    }
    lastFrameAt = at;
    costs.push(costMs);
    if (costs.length > windowSamples) costs.shift();

    if (costMs > frameBudgetMs) {
      slowStreak += 1;
      fastStreak = 0;
    } else if (costMs < frameBudgetMs * 0.45) {
      fastStreak += 1;
      slowStreak = 0;
    } else {
      // 介于宽裕与超预算之间：不打断两种判定序列。
    }

    if (mode !== "auto") return;
    const held = at - lastSwitchAt;

    if (slowStreak >= slowStreakToDowngrade && held >= downgradeHoldMs) {
      if (tier === "high" || tier === "medium") {
        tier = tier === "high" ? "medium" : "low";
        stride = 1;
        lastSwitchAt = at;
        slowStreak = 0;
        onTierChange?.(tier, fieldSizes[tier]);
      } else if (stride === 1) {
        // 已在最低计算档仍超预算：隔帧绘制，保数据与标签不变。
        stride = 2;
        lastSwitchAt = at;
        slowStreak = 0;
      }
      return;
    }

    if (fastStreak >= fastStreakToUpgrade && held >= upgradeHoldMs) {
      if (stride === 2) {
        stride = 1;
        lastSwitchAt = at;
        fastStreak = 0;
      } else if (tier === "low") {
        tier = "medium";
        lastSwitchAt = at;
        fastStreak = 0;
        onTierChange?.(tier, fieldSizes[tier]);
      }
    }
  }

  function getStats(): FrameStats {
    const sorted = [...costs].sort((a, b) => a - b);
    const p95Index = sorted.length === 0 ? 0 : Math.min(
      sorted.length - 1,
      Math.floor(sorted.length * 0.95),
    );
    const medianInterval = intervals.length === 0 ? null : median([...intervals].sort((a, b) => a - b));
    return {
      tier,
      fieldSize: mode === "auto" ? fieldSizes[tier] : fieldSizes[mode],
      mode,
      samples: costs.length,
      medianMs: sorted.length === 0 ? null : round3(median(sorted)),
      p95Ms: sorted.length === 0 ? null : round3(sorted[p95Index]),
      approxFps:
        medianInterval === null || medianInterval <= 0
          ? null
          : Math.round(1000 / medianInterval),
      stride,
    };
  }

  return {
    setMode(next) {
      if (disposed || next === mode) return;
      mode = next;
      applyModeTier();
    },
    getMode: () => mode,
    getTier: () => tier,
    getFieldSize: () => (mode === "auto" ? fieldSizes[tier] : fieldSizes[mode]),
    getStride: () => stride,
    noteRender,
    getStats,
    dispose() {
      disposed = true;
      costs.length = 0;
      intervals.length = 0;
    },
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/* ──────────────────────────────────────────────────────────── */

export interface DisplaySizeSyncOptions {
  dprCap: number;
  /** backing store 变化后回调（触发一帧重绘）。 */
  onBackingStoreChange(): void;
}

/**
 * 同步显示画布 backing store = CSS 尺寸 × min(DPR, dprCap)。
 * ResizeObserver 观察容器；resolution 媒体查询监听 DPR 变化
 * （拖到不同密度屏幕）。部分环境的 DPR 变化不派发媒体查询事件
 * （如 CDP 模拟），因此另提供 checkDevicePixelRatio() 供绘制入口
 * 轻量复核（仅比较浮点值，不读布局）。CSS 尺寸为 0 时挂起
 * （不改动画布），恢复后由观察器再次触发同步。
 */
export function createDisplaySizeSync(
  stage: HTMLElement,
  canvases: readonly HTMLCanvasElement[],
  options: DisplaySizeSyncOptions,
): { sync(): void; checkDevicePixelRatio(): void; dispose(): void } {
  const { dprCap, onBackingStoreChange } = options;
  let disposed = false;
  let lastDpr = Math.min(window.devicePixelRatio || 1, dprCap);

  const backingSize = (): number => {
    const css = stage.clientWidth;
    if (css <= 0) return 0;
    lastDpr = Math.min(window.devicePixelRatio || 1, dprCap);
    return Math.max(1, Math.round(css * lastDpr));
  };

  /** 设置 backing store；返回是否发生变化（true = 调用方需重绘）。 */
  function applyBackingStore(): boolean {
    const px = backingSize();
    if (px <= 0) return false; // 零尺寸：等待恢复
    if (canvases.every((c) => c.width === px && c.height === px)) return false;
    for (const canvas of canvases) {
      canvas.width = px;
      canvas.height = px;
    }
    return true;
  }

  const sync = (): void => {
    if (disposed) return;
    if (applyBackingStore()) onBackingStoreChange();
  };

  /**
   * DPR 复核（无事件路径的兜底）：设备像素比变化时静默重设 backing store，
   * 不触发回调——调用方（绘制入口）随后自行重绘，避免双重绘制。
   */
  function checkDevicePixelRatio(): void {
    if (disposed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    if (dpr === lastDpr) return;
    applyBackingStore();
  }

  const observer: ResizeObserver | null =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => sync());
  observer?.observe(stage);

  // DPR 变化（移动到不同密度屏幕）不改变 CSS 尺寸，需单独监听。
  let dprQuery: MediaQueryList | null = null;
  const onDprChange = (): void => {
    attachDprQuery();
    sync();
  };
  function attachDprQuery(): void {
    if (typeof window.matchMedia !== "function") return;
    dprQuery?.removeEventListener("change", onDprChange);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    dprQuery.addEventListener("change", onDprChange);
  }
  attachDprQuery();
  sync();

  return {
    sync,
    checkDevicePixelRatio,
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      dprQuery?.removeEventListener("change", onDprChange);
    },
  };
}
