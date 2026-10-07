/**
 * 组件创建入口：完整 ProfileHandle（P3）与动效、精确读数（P4）。
 *
 * 图层与坐标系沿用 P0–P2：FogCanvas / BodyCanvas / GridSvg / LabelsSvg /
 * 命中区（z=1..5）。本阶段把静态像素管线接入数据状态机与动画控制器：
 *
 *   setData / setFrame → 验证 → data/controller（状态、帧序、过期）
 *                              → motion/controller（显示值插值）
 *                              → canvas-renderer（同一像素管线）
 *
 * - 两种入口走同一条验证与渲染管线，不维护两套逻辑（Tech_stack.md §3.1）；
 * - 呼吸只作用于雾层的 CSS 透明度（±2% 相对、周期约 8 s），
 *   不缩放数据云、不改半径与读数（Request.md §5.5）；
 * - 动效关闭 / 系统减少动态 / 页面隐藏：数据照常接收，显示直接收敛；
 * - 静态且动效关闭时不保留任何绘制循环（Request.md §5.6）；
 * - 显示 backing store = CSS 尺寸 × min(DPR, dprCap)，随容器与屏幕密度
 *   变化同步（ResizeObserver + resolution 媒体查询）；云层计算缓冲由
 *   质量档管理（auto 自适应 256²/384²，最后手段隔帧绘制），P5。
 */

import { deriveGeometry, resolveConfig, type ScentProfileConfig } from "./config";
import { createSvgLayers, type SvgLayers } from "./render/svg-layer";
import { validateScores } from "./data/validate";
import { validateFrame } from "./data/frame";
import { createDataController, type ControllerContext } from "./data/controller";
import { createMotionController, getLiveControllerCount } from "./motion/controller";
import { createCanvasRenderer, type RenderView } from "./render/canvas-renderer";
import {
  createDisplaySizeSync,
  createQualityManager,
  type FrameStats,
  type QualityLevel,
} from "./render/quality";
import { createReadout } from "./ui/readout";
import { createDebugPanel } from "./ui/debug";
import { DEMO_DATA } from "./data/presets";
import { SCENT_KEYS, type ConnectionEvent, type ProfileHandle, type ProfileSnapshot, type UpdateMode } from "./types";

export interface CreateScentProfileOptions {
  /** Lemon 的屏幕角度（度），默认 -45（右上）。 */
  startAngleDeg?: number;
  /**
   * 逻辑图形区边长（内部逻辑坐标系：SVG viewBox、几何计算）。
   * 与 CSS 尺寸、显示 backing store、云层计算缓冲互相独立（P5 四层分离）。
   */
  logicalSize?: number;
  /** 动效模式：auto（尊重系统减少动态偏好）/ off。默认 auto。 */
  motion?: "auto" | "off";
  /**
   * 云层计算分辨率档位：auto 自适应（low↔medium，按实测成本降档），
   * low/medium/high 固定。显示分辨率不受此参数影响。
   */
  quality?: QualityLevel;
  /** 数据来源说明（如 Demo data），纯文本展示在状态旁。 */
  sourceNote?: string;
}

const QUALITY_FIELD_SIZE: Record<"low" | "medium" | "high", number> = {
  low: 256,
  medium: 384,
  high: 512,
};

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour12: false });
}

export function createScentProfile(
  container: HTMLElement,
  options?: CreateScentProfileOptions,
): ProfileHandle & { readonly config: Readonly<ScentProfileConfig> } {
  const config = resolveConfig({
    startAngleDeg: options?.startAngleDeg,
    logicalSize: options?.logicalSize,
  });
  const geo = deriveGeometry(config);

  // ── DOM 结构（Tech_stack.md §2.1）───────────────────────────────
  const root = document.createElement("article");
  root.className = "scent-profile";

  const header = document.createElement("header");
  header.className = "sp-header";
  const titleBlock = document.createElement("div");
  const title = document.createElement("h1");
  title.textContent = "Scent Profile";
  const subtitle = document.createElement("p");
  subtitle.className = "sp-subtitle";
  subtitle.textContent = "MULTI-DIMENSIONAL ANALYSIS";
  titleBlock.append(title, subtitle);
  const viewTag = document.createElement("span");
  viewTag.className = "sp-view-tag";
  viewTag.textContent = "Profile View";
  header.append(titleBlock, viewTag);

  const figure = document.createElement("figure");
  figure.className = "sp-figure";
  const stage = document.createElement("div");
  stage.className = "sp-stage";

  const fogCanvas = createLayerCanvas("sp-fog-canvas");
  const bodyCanvas = createLayerCanvas("sp-body-canvas");
  stage.append(fogCanvas, bodyCanvas);

  const svgLayers: SvgLayers = createSvgLayers(stage, config, geo);
  root.style.setProperty('--sp-dot-opacity', String(config.gridDotOpacity));
  root.style.setProperty('--sp-line-opacity', String(config.gridRadialLineOpacity));
  root.style.setProperty('--sp-line-width', String(config.gridRadialLineWidthPx));

  // 命中区容器（z=5）：P4 可聚焦按钮，由 readout 模块填充。
  const hitLayer = document.createElement("div");
  hitLayer.className = "sp-hit-layer";
  stage.appendChild(hitLayer);

  // ── 状态行与控件（Request.md §4.1） ──
  const caption = document.createElement("figcaption");
  caption.className = "sp-caption";
  const captionLeft = document.createElement("span");
  captionLeft.className = "sp-caption-left";
  const status = document.createElement("span");
  status.className = "sp-status";
  status.setAttribute("role", "status");
  status.textContent = "Ready to scan";
  const sourceNote = document.createElement("span");
  sourceNote.className = "sp-source-note";
  sourceNote.textContent = options?.sourceNote ?? "";
  sourceNote.toggleAttribute("hidden", !options?.sourceNote);
  captionLeft.append(status, sourceNote);

  const controls = document.createElement("span");
  controls.className = "sp-controls";
  const motionButton = document.createElement("button");
  motionButton.type = "button";
  motionButton.className = "sp-toggle";
  motionButton.setAttribute("aria-pressed", "true");
  motionButton.textContent = "Motion: on";
  const valuesButton = document.createElement("button");
  valuesButton.type = "button";
  valuesButton.className = "sp-toggle";
  valuesButton.setAttribute("aria-pressed", "false");
  valuesButton.textContent = "Show values";
  controls.append(motionButton, valuesButton);
  caption.append(captionLeft, controls);

  figure.append(stage, caption);
  root.append(header, figure);

  // ── 质量档与渲染器（P5：计算缓冲 256²/384²/512²；显示层另由 displaySync 管理） ──
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const quality = createQualityManager({
    fieldSizes: QUALITY_FIELD_SIZE,
    // 桌面按 ~30 fps、触屏按 ~24 fps 的单帧成本预算（implement_plan P5）。
    frameBudgetMs: coarsePointer ? 1000 / 24 : 1000 / 30,
    initialMode: options?.quality ?? "auto",
    now: () => performance.now(),
    onTierChange() {
      rebuildRenderer();
    },
  });
  let renderer = createCanvasRenderer(bodyCanvas, fogCanvas, rendererConfig());
  let renderView: RenderView = "color";

  function rendererConfig(): ScentProfileConfig {
    return { ...config, fieldSize: quality.getFieldSize() };
  }

  /** 档位变化时重建像素管线（复用画布），以当前显示值立即重绘保持连续。 */
  function rebuildRenderer(): void {
    renderer = createCanvasRenderer(bodyCanvas, fogCanvas, rendererConfig());
    paintCurrentFrame();
  }

  // ── 精确读数 ──
  const tooltipId = `sp-tooltip-${Math.random().toString(36).slice(2, 9)}`;
  let lastDisplayed: number[] | null = null;
  let frameIndex = 0;
  const readout = createReadout(stage, hitLayer, geo, config.startAngleDeg, tooltipId, {
    onSelect(key) {
      svgLayers.setAxisHighlight(key);
      refreshPreciseMarker();
    },
  });
  root.append(readout.valuesElement);
  container.appendChild(root);

  // ── 显示尺寸同步（P5）：backing store = CSS × min(DPR, dprCap)。
  // 容器 resize 与拖动到不同密度屏幕都触发重设并重绘；零尺寸挂起待恢复。
  let displaySync: ReturnType<typeof createDisplaySizeSync> | null = null;
  displaySync = createDisplaySizeSync(stage, [fogCanvas, bodyCanvas], {
    dprCap: config.dprCap,
    onBackingStoreChange: paintCurrentFrame,
  });

  // ── 动效偏好：用户开关 + 系统减少动态，实时生效（§5.6） ──
  let userMotion: "auto" | "off" = options?.motion ?? "auto";
  let reducedMotion = false;
  const motionQuery =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
  reducedMotion = motionQuery?.matches ?? false;

  function effectiveMotionEnabled(): boolean {
    return userMotion === "auto" && !reducedMotion;
  }

  /**
   * 以当前显示值渲染一帧。云已清除（null）时清空像素层——
   * 空数组会触发几何校验异常，必须走 clear() 而不是 render([])。
   * 绘制前先复核 DPR（兜底无事件的设备像素比变化，零布局读取）。
   * displaySync 构造期（初始 sync 回调）时它尚未赋值，需可空。
   */
  function paintCurrentFrame(): void {
    displaySync?.checkDevicePixelRatio();
    if (lastDisplayed === null) {
      renderer.clear();
    } else {
      renderer.render(lastDisplayed, renderView);
    }
  }

  // ── 显示值动画控制器（rAF 驱动；隐藏标签页自动停发帧） ──
  let lastTarget: number[] | null = null;
  const motion = createMotionController({
    entryMs: config.entryMs,
    transitionMs: config.transitionMs,
    streamTauMs: config.streamTauMs,
    snapEpsilon: config.streamSnapEpsilon,
    now: () => performance.now(),
    schedule: (callback) => requestAnimationFrame(() => callback()),
    cancel: (handle) => cancelAnimationFrame(handle as number),
    onFrame(displayed) {
      lastDisplayed = displayed;
      // 绘制节流：仅当自动降档已到最低计算档且仍超预算时 stride=2。
      // 收敛帧（动画结束/云清除）必绘，保证最终画面准确。
      frameIndex += 1;
      const stride = quality.getStride();
      if (stride === 1 || displayed === null || !motion.isAnimating() || frameIndex % stride === 0) {
        const startedAt = performance.now();
        paintCurrentFrame();
        quality.noteRender(performance.now() - startedAt);
      }
      if (renderView === "contour") {
        svgLayers.updateDebugContour(displayed ?? null);
      }
      refreshPreciseMarker();
    },
    onAnimatingChange(updating) {
      readout.setUpdating(updating);
      refreshStatusText();
    },
  });

  function refreshPreciseMarker(): void {
    const key = readout.getSelected();
    if (key === null) {
      svgLayers.updatePreciseMarker(null, null);
      return;
    }
    const index = SCENT_KEYS.indexOf(key as (typeof SCENT_KEYS)[number]);
    svgLayers.updatePreciseMarker(key, lastDisplayed ? lastDisplayed[index] : null);
  }

  // ── 数据状态机 ──
  let currentContext: ControllerContext = {
    state: "idle",
    latestScores: null,
    lastComplete: null,
    receivedAt: null,
    errorMessage: null,
    connection: "unknown",
  };

  function statusText(): string {
    const { state, lastComplete } = currentContext;
    if (motion.isAnimating() && (state === "ready" || state === "zero")) {
      return "Updating visualization";
    }
    switch (state) {
      case "idle":
        return "Ready to scan";
      case "analyzing":
        return "Analyzing scent…";
      case "zero":
        return "No confident notes detected";
      case "incomplete":
        return lastComplete ? "Incomplete data · Last reading" : "Incomplete data";
      case "error":
        return `Error: ${currentContext.errorMessage ?? "input error"}`;
      case "stale":
        return `Last reading · ${lastComplete ? formatClockTime(lastComplete.receivedAt) : "—"}`;
      case "disconnected":
        return lastComplete
          ? `Disconnected · Last reading ${formatClockTime(lastComplete.receivedAt)}`
          : "Disconnected";
      case "ready":
      default:
        return "Scent profile";
    }
  }

  function refreshStatusText(): void {
    status.textContent = statusText();
  }

  /** 呼吸门控：仅雾层 CSS 透明度；断连/过期/错误/无云时停止装饰动效。 */
  function updateBreathing(): void {
    const cloudVisible = lastTarget !== null && !lastTarget.every((v) => v === 0);
    const stateAllows = !["stale", "disconnected", "error", "idle"].includes(currentContext.state);
    const on = effectiveMotionEnabled() && cloudVisible && stateAllows;
    fogCanvas.classList.toggle("sp-breathing", on);
  }

  const controller = createDataController(
    {
      onTarget(scores, mode) {
        lastTarget = scores;
        motion.setTarget(scores, mode);
        updateBreathing();
      },
      onState(context) {
        currentContext = context;
        readout.updateScores(context.latestScores);
        const sampleId = context.lastComplete?.sampleId;
        readout.setSampleNote(
          `${sourceNote.textContent || "Live input"} · Sample ${sampleId ?? "—"}`,
        );
        refreshStatusText();
        updateBreathing();
      },
    },
    {
      staleAfterMs: config.staleAfterMs,
      now: () => Date.now(),
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: (handle) => clearTimeout(handle as number),
    },
  );

  // ── 控件事件 ──
  motionButton.addEventListener("click", () => {
    // 按钮与 setMotion API 走同一条切换路径。
    handle.setMotion(userMotion === "off" ? "auto" : "off");
  });

  let valuesVisible = false;
  valuesButton.addEventListener("click", () => {
    valuesVisible = !valuesVisible;
    valuesButton.setAttribute("aria-pressed", String(valuesVisible));
    readout.showValues(valuesVisible);
  });

  // ── 系统偏好与页面可见性（§5.6） ──
  function onMotionPreferenceChange(): void {
    reducedMotion = motionQuery?.matches ?? false;
    motion.setEnabled(effectiveMotionEnabled());
    updateBreathing();
  }
  motionQuery?.addEventListener?.("change", onMotionPreferenceChange);

  function onVisibilityChange(): void {
    if (document.hidden) {
      // 页面不可见：rAF 自动停发，无意义绘制停止；呼吸暂停。
      fogCanvas.classList.add("sp-paused");
    } else {
      // 恢复显示：直接追上最新目标，不补播隐藏期间的旧动画。
      fogCanvas.classList.remove("sp-paused");
      motion.catchUp();
      updateBreathing();
    }
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  motion.setEnabled(effectiveMotionEnabled());

  // ── 生命周期 ──
  let destroyed = false;

  function assertAlive(): void {
    if (destroyed) {
      throw new Error("ScentProfile handle already destroyed");
    }
  }

  const handle: ProfileHandle & { readonly config: Readonly<ScentProfileConfig> } = {
    config,
    setData(input, setDataOptions) {
      assertAlive();
      const result = validateScores(input);
      if (!result.ok) return result;
      controller.accept(setDataOptions?.mode ?? "discrete", result.value);
      return result;
    },
    setFrame(input, setFrameOptions) {
      assertAlive();
      const result = validateFrame(input);
      if (!result.ok) return result;
      const mode: UpdateMode = setFrameOptions?.mode ?? "discrete";
      const processed = controller.accept(mode, result.value.confidence, result.value);
      if (!processed) {
        // 重复或更旧 sequence：忽略，画面不回退（Tech_stack.md §3.2）。
        return {
          ok: true,
          value: result.value,
          warnings: [
            ...result.warnings,
            `Stale sequence ${result.value.sequence} ignored for stream "${result.value.streamId}"`,
          ],
        };
      }
      return result;
    },
    setMotion(mode) {
      assertAlive();
      userMotion = mode;
      motionButton.setAttribute("aria-pressed", String(mode === "auto"));
      motionButton.textContent = mode === "auto" ? "Motion: on" : "Motion: off";
      motion.setEnabled(effectiveMotionEnabled());
      updateBreathing();
    },
    setQuality(level) {
      assertAlive();
      // 手动档固定计算分辨率；auto 只在 low↔medium 间自适应。
      // 档位变化由 onTierChange 重建渲染器并立即重绘，画面连续。
      quality.setMode(level);
    },
    setConnection(event: ConnectionEvent) {
      assertAlive();
      controller.setConnection(event);
    },
    getSnapshot(): ProfileSnapshot {
      assertAlive();
      const context = controller.getContext();
      return {
        state: context.state,
        latestScores: context.latestScores,
        displayedScores:
          lastDisplayed === null
            ? null
            : Object.fromEntries(
                SCENT_KEYS.map((key, i) => [key, lastDisplayed![i]]),
              ) as ProfileSnapshot["displayedScores"],
        sampleId: context.lastComplete?.sampleId ?? null,
        receivedAt: context.receivedAt,
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      motion.dispose();
      controller.dispose();
      displaySync?.dispose();
      quality.dispose();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motionQuery?.removeEventListener?.("change", onMotionPreferenceChange);
      readout.destroy();
      root.remove();
    },
    debug: {
      setView(view: RenderView) {
        assertAlive();
        renderView = view;
        if (view !== "contour") svgLayers.updateDebugContour(null);
        paintCurrentFrame();
        if (view === "contour") svgLayers.updateDebugContour(lastDisplayed ?? null);
      },
      settleToLatest() {
        assertAlive();
        motion.catchUp();
      },
      getPerformanceStats(): FrameStats {
        return quality.getStats();
      },
    },
  };

  return handle;
}

function createLayerCanvas(className: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.className = className;
  // 占位 1×1：真实 backing store 由 displaySync 按 CSS × min(DPR, dprCap) 设置。
  canvas.width = 1;
  canvas.height = 1;
  canvas.setAttribute("aria-hidden", "true");
  return canvas;
}

/**
 * 演示挂载：组件 + 开发者面板 + 初始 Demo data（Request.md §2.4）。
 * 演示数据必须经公共 API 进入并标注来源，不绕过验证直写渲染层。
 */
export function mountDemoProfile(container: HTMLElement): ProfileHandle {
  const profile = createScentProfile(container, { sourceNote: "Demo data" });
  profile.setData({ ...DEMO_DATA });
  createDebugPanel(container, profile);
  if (typeof window !== "undefined") {
    const scope = window as unknown as Record<string, unknown>;
    scope.__scentProfile = profile;
    scope.__scentProfileFactory = createScentProfile;
    // 生命周期泄漏检测（P5）：反复挂载/销毁后存活动效控制器数应回到基线。
    scope.__scentProfileInternals = { getLiveMotionControllers: getLiveControllerCount };
  }
  return profile;
}
