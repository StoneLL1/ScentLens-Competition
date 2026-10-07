/**
 * 数据契约与公共类型。
 *
 * 依据 Tech_stack.md §3.1。类型只是契约：运行时对外入口仍接收 unknown，
 * 由 data/validate.ts 做严格验证；ProfileHandle / ScentFrame 的完整
 * 实现按实施计划落在 P3，此处先固定类型形状，避免后续接口漂移。
 */

/** 八维固定顺序：Lemon、Rose、Lavender、Grass、Peach、Clove、Cedarwood、Vanilla。 */
export const SCENT_KEYS = [
  "lemon",
  "rose",
  "lavender",
  "grass",
  "peach",
  "clove",
  "cedarwood",
  "vanilla",
] as const;

export type ScentKey = (typeof SCENT_KEYS)[number];

/** 八项全部有效的分数，值域 [0, 100]，保留原始小数精度。 */
export type Scores = Record<ScentKey, number>;

/**
 * 允许缺项的输入：null 表示“缺失 / 不完整”，不是 0。
 * 缺失值不得补零进入完整云渲染。
 */
export type InputScores = Record<ScentKey, number | null>;

export type UpdateMode = "discrete" | "stream";

/** 设备 / 适配器输出的单帧。帧序与状态控制（P3）以此为准。 */
export interface ScentFrame {
  schemaVersion: 1;
  source: "mock" | "device";
  /** 同一会话内 sequence 单调递增；新 streamId 重建序列上下文。 */
  streamId: string;
  /** 区分测量样本，不用来随机改变材质。 */
  sampleId: string;
  /** 非负安全整数。 */
  sequence: number;
  /** 可选 ISO 时间，仅用于展示与追溯，不驱动动画进度。 */
  sampledAt?: string;
  status: "analyzing" | "ready" | "error";
  confidence: InputScores | null;
  /** 纯文本，不作为 HTML 执行。 */
  message?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[] };

/** 连接事件（Tech_stack.md §11.1）：适配器报告连接、断连、采样结束。 */
export type ConnectionEvent = "connected" | "disconnected" | "ended";

/** P3 实现的公共句柄契约（见 Tech_stack.md §3.1）。 */
export interface ProfileHandle {
  setData(
    input: unknown,
    options?: { mode?: UpdateMode },
  ): ValidationResult<InputScores>;
  setFrame(
    input: unknown,
    options?: { mode?: UpdateMode },
  ): ValidationResult<ScentFrame>;
  setMotion(mode: "auto" | "off"): void;
  setQuality(level: "auto" | "low" | "medium" | "high"): void;
  /**
   * 连接事件入口（契约扩展，见 Tech_stack.md §11.1 / P3 计划）：
   * 适配器把连接、断连、采样结束与分数消息分开上报。
   * disconnected 保留最近结果并停止装饰动效；ended 解除活跃流超时。
   */
  setConnection(event: ConnectionEvent): void;
  getSnapshot(): ProfileSnapshot;
  destroy(): void;
  /** 开发 / 测试专用入口（Tech_stack.md §12.2），不作为产品 API 承诺。 */
  readonly debug: ProfileDebugApi;
}

/** 内部调试接口：截图回归与测试需要，不给普通宿主使用。 */
export interface ProfileDebugApi {
  /** 渲染开发视图：最终颜色 / 名义轮廓 / 主体遮罩 / 灰度密度。 */
  setView(view: "color" | "contour" | "mask" | "density"): void;
  /** 立即收敛到最新目标（跳过剩余过渡），供测试固定显示状态。 */
  settleToLatest(): void;
  /**
   * 云层性能统计（P5）：计算档位、缓冲区边长、绘制成本中位数/P95、
   * 估计帧率与绘制节流。Request.md §7 的开发模式性能读数由此驱动。
   */
  getPerformanceStats(): import("./render/quality").FrameStats;
}

export interface ProfileSnapshot {
  state: string;
  latestScores: InputScores | null;
  displayedScores: Scores | null;
  sampleId: string | null;
  receivedAt: number | null;
}

/** 数据状态机的状态集合（Request.md §4.3）。 */
export type ProfileState =
  | "idle" // Ready to scan
  | "analyzing" // Analyzing scent…
  | "ready" // Scent profile
  | "zero" // No confident notes detected
  | "incomplete" // Incomplete data
  | "error" // 输入或设备错误
  | "stale" // Last reading（活跃流超时）
  | "disconnected"; // Disconnected（适配器断连）
