/**
 * 精确读数交互（Request.md §4.2、Tech_stack.md §10.3）。
 *
 * - 八个可聚焦命中按钮（约 44×44 CSS px），hover / 键盘 focus / 触摸点击
 *   显示同一份数据的读数提示：`Rose / Confidence: 94 / 100`；
 * - 提示数值来自 latestRawScores（最新收到的测量值）；轴上临时精确标记
 *   使用 displayedScores（动画中的显示值），两者明确区分；
 * - 触摸点击固定提示；Esc 或点击空白关闭；焦点状态可见；
 * - Show values 展开固定顺序的八维数值表（HTML 结构，不依赖颜色/雾边界/悬停），
 *   过渡期间显示最新输入并标记 Updating visualization；
 * - 数值表只在数据到达 / 状态变化 / 用户打开时更新，不逐动画帧播报。
 */

import { SCENT_KEYS, type InputScores, type ScentKey } from "../types";
import { computeAxes, polarToXY } from "../geometry/grid";
import type { DerivedGeometry } from "../config";

/** 提示相对命中点的摆放方向（按轴预计算，避免逐帧测量）。 */
function tooltipPlacement(angleDeg: number): string {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  if (Math.abs(cos) < 0.1) {
    // 正上 / 正下：垂直避让。
    return Math.sin(rad) < 0 ? "sp-tooltip-below" : "sp-tooltip-above";
  }
  return cos > 0 ? "sp-tooltip-left" : "sp-tooltip-right";
}

function formatScore(value: number): string {
  // 显示保留 0 或 1 位小数（Request.md §2.3）；原始精度不受影响。
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

export interface ReadoutCallbacks {
  /** 选中轴变化（含取消）：上层强化轴线并刷新精确标记。 */
  onSelect(key: string | null): void;
}

export interface ReadoutHandle {
  readonly valuesElement: HTMLElement;
  getSelected(): string | null;
  /** 最新测量值到达：更新提示内容与数值表。 */
  updateScores(latest: InputScores | null): void;
  setUpdating(updating: boolean): void;
  setSampleNote(text: string): void;
  showValues(visible: boolean): void;
  destroy(): void;
}

export function createReadout(
  stage: HTMLElement,
  hitLayer: HTMLElement,
  geo: Readonly<DerivedGeometry>,
  startAngleDeg: number,
  tooltipId: string,
  callbacks: ReadoutCallbacks,
): ReadoutHandle {
  const axes = computeAxes(startAngleDeg);
  const logical = geo.size;
  const pct = (v: number): string => `${((v / logical) * 100).toFixed(3)}%`;

  // ── 提示元素（常驻 DOM，hidden 控制） ──
  const tooltip = document.createElement("div");
  tooltip.className = "sp-tooltip";
  tooltip.id = tooltipId;
  tooltip.setAttribute("role", "tooltip");
  tooltip.setAttribute("hidden", "");
  const tooltipName = document.createElement("span");
  tooltipName.className = "sp-tooltip-name";
  const tooltipValue = document.createElement("span");
  tooltipValue.className = "sp-tooltip-value";
  tooltip.append(tooltipName, tooltipValue);
  stage.appendChild(tooltip);

  // ── 八个命中按钮：位置与标签共用同一角度配置 ──
  const buttons = new Map<string, HTMLButtonElement>();
  const placements = new Map<string, string>();
  for (const axis of axes) {
    const p = polarToXY(geo.cx, geo.cy, geo.labelRadius, axis.angleRad);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "sp-hit";
    button.dataset.scentKey = axis.key;
    button.setAttribute("aria-describedby", tooltipId);
    button.style.left = pct(p.x);
    button.style.top = pct(p.y);
    // 视觉隐藏文本：屏幕阅读器朗读维度名；视觉上只保留透明命中区。
    const label = document.createElement("span");
    label.className = "sp-visually-hidden";
    label.textContent = `${axis.label} confidence reading`;
    button.appendChild(label);
    hitLayer.appendChild(button);
    buttons.set(axis.key, button);
    placements.set(axis.key, tooltipPlacement(axis.angleDeg));
  }

  // ── 数值表（Show values 展开） ──
  const values = document.createElement("div");
  values.className = "sp-values";
  values.setAttribute("hidden", "");
  const valuesHead = document.createElement("div");
  valuesHead.className = "sp-values-head";
  const sampleNote = document.createElement("span");
  sampleNote.className = "sp-values-sample";
  const updatingBadge = document.createElement("span");
  updatingBadge.className = "sp-updating";
  updatingBadge.textContent = "Updating visualization";
  updatingBadge.setAttribute("hidden", "");
  updatingBadge.setAttribute("aria-hidden", "true"); // 状态行已播报，避免重复朗读
  valuesHead.append(sampleNote, updatingBadge);
  const table = document.createElement("table");
  table.className = "sp-values-table";
  const caption = document.createElement("caption");
  caption.className = "sp-visually-hidden";
  caption.textContent = "Scent confidence readings, scale 0 to 100";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const head of ["Scent", "Confidence"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = head;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  const valueCells = new Map<string, HTMLElement>();
  for (const key of SCENT_KEYS) {
    const axis = axes.find((a) => a.key === key)!;
    const row = document.createElement("tr");
    row.dataset.scentKey = key;
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = axis.label;
    const td = document.createElement("td");
    td.textContent = "—";
    row.append(th, td);
    tbody.appendChild(row);
    valueCells.set(key, td);
  }
  table.append(caption, thead, tbody);
  values.append(valuesHead, table);

  // ── 交互状态 ──
  let selected: string | null = null;
  let pinned = false;
  let latest: InputScores | null = null;

  function tooltipText(key: string): { name: string; value: string } {
    const axis = axes.find((a) => a.key === key)!;
    const score = latest ? latest[key as ScentKey] : undefined;
    const value =
      typeof score === "number"
        ? `Confidence: ${formatScore(score)} / 100`
        : "Confidence: —";
    return { name: axis.label, value };
  }

  function renderTooltip(): void {
    if (selected === null) {
      tooltip.setAttribute("hidden", "");
      return;
    }
    const button = buttons.get(selected)!;
    tooltip.className = `sp-tooltip ${placements.get(selected) ?? ""}`.trim();
    const text = tooltipText(selected);
    tooltipName.textContent = text.name;
    tooltipValue.textContent = text.value;
    tooltip.style.left = button.style.left;
    tooltip.style.top = button.style.top;
    tooltip.removeAttribute("hidden");
  }

  function setSelected(key: string | null, pin: boolean): void {
    selected = key;
    pinned = pin;
    renderTooltip();
    callbacks.onSelect(selected);
  }

  for (const [key, button] of buttons) {
    button.addEventListener("mouseenter", () => {
      if (!pinned) setSelected(key, false);
    });
    button.addEventListener("mouseleave", () => {
      if (!pinned && selected === key) setSelected(null, false);
    });
    button.addEventListener("focus", () => {
      if (!pinned) setSelected(key, false);
    });
    button.addEventListener("blur", () => {
      if (!pinned && selected === key) setSelected(null, false);
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      // 触摸 / 鼠标点击：固定提示；再点同一轴取消。
      if (pinned && selected === key) {
        setSelected(null, false);
        button.blur();
      } else {
        setSelected(key, true);
      }
    });
    button.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        // Esc 关闭已打开提示（Request.md §4.2）。
        event.preventDefault();
        setSelected(null, false);
        button.blur();
      }
    });
  }

  // 点击命中层空白（不落在任何按钮上）关闭固定提示。
  hitLayer.addEventListener("pointerdown", (event) => {
    if (event.target === hitLayer && pinned) {
      setSelected(null, false);
    }
  });

  return {
    valuesElement: values,
    getSelected: () => selected,
    updateScores(next) {
      latest = next;
      for (const key of SCENT_KEYS) {
        const cell = valueCells.get(key)!;
        const score = next?.[key];
        cell.textContent = typeof score === "number" ? formatScore(score) : "—";
      }
      if (selected !== null) renderTooltip();
    },
    setUpdating(updating) {
      updatingBadge.toggleAttribute("hidden", !updating);
    },
    setSampleNote(text) {
      sampleNote.textContent = text;
    },
    showValues(visible) {
      values.toggleAttribute("hidden", !visible);
    },
    destroy() {
      tooltip.remove();
      values.remove();
      hitLayer.replaceChildren();
    },
  };
}
