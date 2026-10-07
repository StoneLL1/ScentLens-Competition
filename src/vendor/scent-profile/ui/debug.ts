/**
 * 开发者演示面板（Tech_stack.md §12.2、Request.md §9.2）。
 *
 * 面板本身不是产品 API：它只通过 ProfileHandle 的公共方法驱动组件，
 * 用于人工核对预设、滑杆流式输入、JSON 输入、异常状态与 20 Hz 模拟流。
 * 预设必须标记 Demo data，不得伪装为设备测量结果（Request.md §2.4）。
 */

import { arrayToScores, DEMO_DATA, PRESETS } from "../data/presets";
import { SCENT_KEYS, type ProfileHandle, type ScentFrame } from "../types";
import type { ScentProfileConfig } from "../config";

/** createScentProfile 的实际返回类型（带只读 config，供面板读取参数上限）。 */
export type ScentProfileInstance = ProfileHandle & {
  readonly config: Readonly<ScentProfileConfig>;
};

const AXES_ORDER = SCENT_KEYS;

/**
 * 字段包装：div + 说明文字（不用 label 包裹，避免复合控件内的按钮
 * 继承整段说明文本作为可访问名；命名由各控件自身 aria-label 承担）。
 */
function field(labelText: string, control: HTMLElement): HTMLElement {
  const fieldBox = document.createElement("div");
  fieldBox.className = "sp-dev-field";
  const label = document.createElement("span");
  label.className = "sp-dev-label";
  label.textContent = labelText;
  fieldBox.append(label, control);
  return fieldBox;
}

function selectOption(value: string, text: string): HTMLOptionElement {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  return option;
}

export interface DebugPanelHandle {
  /** 供测试注入：当前面板持有的组件句柄。 */
  readonly profile: ProfileHandle;
  destroy(): void;
}

export function createDebugPanel(
  container: HTMLElement,
  profile: ScentProfileInstance,
): DebugPanelHandle {
  const panel = document.createElement("details");
  panel.className = "sp-devtools";
  const summary = document.createElement("summary");
  summary.textContent = "Developer tools";
  panel.appendChild(summary);

  const body = document.createElement("div");
  body.className = "sp-dev-body";
  panel.appendChild(body);

  // ── 性能读数（Request.md §7 必须，开发模式可见） ──
  // 只反映云层像素绘制成本与计算档；呼吸为 CSS 合成，不计入。
  const perfLine = document.createElement("p");
  perfLine.className = "sp-dev-perf";
  perfLine.setAttribute("role", "status");
  function refreshPerfLine(): void {
    const stats = profile.debug.getPerformanceStats();
    const median = stats.medianMs === null ? "—" : `${stats.medianMs.toFixed(1)} ms`;
    const p95 = stats.p95Ms === null ? "—" : `${stats.p95Ms.toFixed(1)} ms`;
    const fps = stats.approxFps === null ? "—" : `~${stats.approxFps} fps`;
    const stride = stats.stride > 1 ? ` · every ${stats.stride}nd frame` : "";
    perfLine.textContent =
      `Cloud ${stats.fieldSize}² · median ${median} · P95 ${p95} · ${fps}` +
      ` · tier ${stats.tier} (${stats.mode})${stride}`;
  }
  refreshPerfLine();
  const perfTimer = setInterval(refreshPerfLine, 500);
  body.appendChild(perfLine);

  // ── 预设数据集 ──
  const datasetSelect = document.createElement("select");
  datasetSelect.className = "sp-dev-dataset";
  datasetSelect.setAttribute("aria-label", "Dataset");
  datasetSelect.appendChild(selectOption("", "Choose preset…"));
  PRESETS.forEach((preset, index) => {
    datasetSelect.appendChild(selectOption(String(index), `${index + 1}. ${preset.name}`));
  });
  datasetSelect.addEventListener("change", () => {
    const preset = PRESETS[Number(datasetSelect.value)];
    if (!preset) return;
    profile.setData(arrayToScores(preset.values));
  });
  body.appendChild(field("Dataset", datasetSelect));

  // ── 渲染视图（调试出口，同 P2） ──
  const viewSelect = document.createElement("select");
  viewSelect.className = "sp-dev-view";
  viewSelect.setAttribute("aria-label", "Render view");
  for (const view of ["color", "contour", "mask", "density"] as const) {
    viewSelect.appendChild(selectOption(view, view));
  }
  viewSelect.addEventListener("change", () => {
    profile.debug.setView(viewSelect.value as "color" | "contour" | "mask" | "density");
  });
  body.appendChild(field("Render view", viewSelect));

  // ── 八维滑杆：连续输入走 stream 跟随（220 ms），不启用过期 ──
  const slidersBox = document.createElement("div");
  slidersBox.className = "sp-dev-sliders";
  const sliderByKey = new Map<string, HTMLInputElement>();
  for (const key of AXES_ORDER) {
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(DEMO_DATA[key]);
    slider.dataset.scentKey = key;
    slider.setAttribute("aria-label", `${key} confidence slider`);
    const row = document.createElement("label");
    row.className = "sp-dev-slider";
    const name = document.createElement("span");
    name.textContent = key;
    const output = document.createElement("output");
    output.textContent = slider.value;
    slider.addEventListener("input", () => {
      output.textContent = slider.value;
      const scores = {} as Record<string, number>;
      for (const [k, input] of sliderByKey) scores[k] = Number(input.value);
      profile.setData(scores, { mode: "stream" });
    });
    row.append(name, slider, output);
    slidersBox.appendChild(row);
    sliderByKey.set(key, slider);
  }
  body.appendChild(field("Sliders (stream input)", slidersBox));

  // ── JSON 输入 ──
  const jsonBox = document.createElement("div");
  jsonBox.className = "sp-dev-json";
  const jsonArea = document.createElement("textarea");
  jsonArea.className = "sp-dev-json-input";
  jsonArea.rows = 6;
  jsonArea.spellcheck = false;
  jsonArea.setAttribute("aria-label", "JSON input");
  jsonArea.value = JSON.stringify(DEMO_DATA, null, 2);
  const jsonError = document.createElement("p");
  jsonError.className = "sp-dev-json-error";
  jsonError.setAttribute("role", "status");
  jsonError.setAttribute("hidden", "");
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "sp-dev-apply";
  applyButton.textContent = "Apply JSON";
  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.className = "sp-dev-load";
  loadButton.textContent = "Load current";

  function showJsonError(message: string): void {
    jsonError.textContent = message;
    jsonError.removeAttribute("hidden");
  }
  function clearJsonError(): void {
    jsonError.setAttribute("hidden", "");
    jsonError.textContent = "";
  }

  applyButton.addEventListener("click", () => {
    clearJsonError();
    const text = jsonArea.value;
    if (text.length > profile.config.jsonMaxBytes) {
      showJsonError(
        `Input exceeds ${profile.config.jsonMaxBytes} characters (${text.length}); JSON input rejected`,
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      showJsonError(`JSON parse error: ${(error as Error).message}`);
      return;
    }
    // 带 schemaVersion 的对象按设备帧处理，其余按分数对象处理。
    const looksLikeFrame =
      typeof parsed === "object" &&
      parsed !== null &&
      "schemaVersion" in parsed &&
      "streamId" in parsed;
    const result = looksLikeFrame
      ? profile.setFrame(parsed)
      : profile.setData(parsed);
    if (!result.ok) {
      showJsonError(result.errors.join(" · "));
      return;
    }
    if (result.warnings.length > 0) {
      showJsonError(`Warnings: ${result.warnings.join(" · ")}`);
      return;
    }
  });

  loadButton.addEventListener("click", () => {
    clearJsonError();
    const snapshot = profile.getSnapshot();
    jsonArea.value = JSON.stringify(
      snapshot.latestScores === null
        ? {}
        : Object.fromEntries(
            SCENT_KEYS.map((key) => [key, snapshot.latestScores![key]]),
          ),
      null,
      2,
    );
  });

  const jsonButtons = document.createElement("span");
  jsonButtons.className = "sp-dev-json-buttons";
  jsonButtons.append(applyButton, loadButton);
  jsonBox.append(jsonArea, jsonButtons, jsonError);
  body.appendChild(field("JSON input", jsonBox));

  // ── 20 Hz 模拟流：验证流式跟随与活跃流超时 ──
  const streamButton = document.createElement("button");
  streamButton.type = "button";
  streamButton.className = "sp-dev-stream";
  streamButton.textContent = "Start stream test (20 Hz)";
  let streamHandle: ReturnType<typeof setInterval> | null = null;
  let simSequence = 0;
  let simRun = 0;
  const baseValues = PRESETS[0].values;

  streamButton.addEventListener("click", () => {
    if (streamHandle !== null) {
      clearInterval(streamHandle);
      streamHandle = null;
      streamButton.textContent = "Start stream test (20 Hz)";
      // 停止发送但保持活跃流语义：5 s 无帧后应进入 Last reading（§11.2）。
      return;
    }
    profile.setConnection("connected");
    simRun += 1;
    simSequence = 0;
    const streamId = `sim-${simRun}`; // 每次运行新 streamId，重建序列上下文
    streamButton.textContent = "Stop stream test";
    const startedAt = performance.now();
    streamHandle = setInterval(() => {
      simSequence += 1;
      const elapsed = (performance.now() - startedAt) / 1000;
      const confidence: Record<string, number> = {};
      SCENT_KEYS.forEach((key, index) => {
        const wave = Math.sin(elapsed * Math.PI + (index * Math.PI) / 4);
        const value = Math.round(baseValues[index] + wave * 18);
        confidence[key] = Math.min(100, Math.max(0, value));
      });
      const frame: ScentFrame = {
        schemaVersion: 1,
        source: "mock",
        streamId,
        sampleId: "sim-live",
        sequence: simSequence,
        sampledAt: new Date().toISOString(),
        status: "ready",
        confidence: confidence as ScentFrame["confidence"],
      };
      profile.setFrame(frame, { mode: "stream" });
    }, 50);
  });

  const streamRow = document.createElement("div");
  streamRow.className = "sp-dev-stream-row";
  streamRow.appendChild(streamButton);
  const streamHint = document.createElement("span");
  streamHint.className = "sp-dev-hint";
  streamHint.textContent = "Stop and wait 5 s → Last reading";
  streamRow.appendChild(streamHint);
  body.appendChild(field("Stream test", streamRow));

  // ── 异常状态模拟（帧序递增，重复触发不会被当作旧帧忽略） ──
  let stateSequence = 0;
  const stateSelect = document.createElement("select");
  stateSelect.className = "sp-dev-state";
  stateSelect.setAttribute("aria-label", "State test");
  stateSelect.appendChild(selectOption("", "Trigger state…"));
  stateSelect.appendChild(selectOption("analyzing", "Analyzing (frame)"));
  stateSelect.appendChild(selectOption("incomplete", "Incomplete (partial scores)"));
  stateSelect.appendChild(selectOption("error", "Error frame"));
  stateSelect.appendChild(selectOption("disconnect", "Disconnected"));
  stateSelect.appendChild(selectOption("reconnect", "Reconnected"));
  stateSelect.appendChild(selectOption("restore", "Restore demo data"));
  stateSelect.addEventListener("change", () => {
    const action = stateSelect.value;
    stateSelect.value = "";
    stateSequence += 1;
    switch (action) {
      case "analyzing":
        profile.setFrame({
          schemaVersion: 1,
          source: "mock",
          streamId: "state-test",
          sampleId: "state-test",
          sequence: stateSequence,
          status: "analyzing",
          confidence: null,
        });
        break;
      case "incomplete":
        profile.setData({ lemon: 41, rose: null, lavender: null, grass: null, peach: null, clove: null, cedarwood: null, vanilla: null });
        break;
      case "error":
        profile.setFrame({
          schemaVersion: 1,
          source: "device",
          streamId: "state-test",
          sampleId: "state-test",
          sequence: stateSequence,
          status: "error",
          confidence: null,
          message: "Sensor timeout",
        });
        break;
      case "disconnect":
        profile.setConnection("disconnected");
        break;
      case "reconnect":
        profile.setConnection("connected");
        break;
      case "restore":
        profile.setData({ ...DEMO_DATA });
        break;
      default:
        break;
    }
  });
  body.appendChild(field("State test", stateSelect));

  container.appendChild(panel);

  return {
    profile,
    destroy() {
      clearInterval(perfTimer);
      if (streamHandle !== null) clearInterval(streamHandle);
      panel.remove();
    },
  };
}
