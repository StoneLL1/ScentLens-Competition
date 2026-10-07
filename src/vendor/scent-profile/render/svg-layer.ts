/**
 * SVG 几何标注层（Tech_stack.md §2.1、§10）。
 *
 * - GridSvg（z=3）：点状同心圆环、极细径向线、调试参考轮廓；
 * - LabelsSvg（z=4）：沿圆周切向旋转的英文维度标签，下半圈翻转可读。
 *
 * 两层均不截获指针事件；可访问性读数由后续阶段的 HTML 命中区与
 * 数值表承担，装饰性 SVG 对辅助技术隐藏。
 *
 * 调试参考轮廓只用于几何核对（P1 阶段出口），不是最终雷达描边，
 * 不参与默认静态展示。
 */

import type { ScentProfileConfig, DerivedGeometry } from "../config";
import {
  computeAxes,
  polarToXY,
  ringDotAngle,
  ringDotCount,
  readableTangentAngle,
} from "../geometry/grid";
import { axisRadius, makeCyclicRadius } from "../geometry/cyclic-radius";

const SVG_NS = "http://www.w3.org/2000/svg";

/** 调试轮廓的角度采样数（仅用于 polyline 粗细度，与查找表无关）。 */
const CONTOUR_SAMPLES = 256;

function svgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

export interface SvgLayers {
  readonly gridSvg: SVGSVGElement;
  readonly labelsSvg: SVGSVGElement;
  /**
   * 更新或清除调试轮廓。scores 为固定顺序八个 [0,100] 数值；
   * 传 null 清除。无效输入清除轮廓并返回错误列表。
   */
  updateDebugContour(scores: readonly number[] | null): { ok: boolean; errors: string[] };
  /**
   * P4 交互：轻微强化某一轴（径向线与标签），传 null 取消。
   * 只改标注层样式，不加深、不放大云团（Request.md §4.2）。
   */
  setAxisHighlight(key: string | null): void;
  /**
   * P4 交互：在指定轴的当前显示分数位置放一个精确标记点。
   * score 为显示值（动画期间使用显示分数，区分测量值与显示值）；
   * 传 null 清除。标记属于临时交互辅助，不是默认静态图的一部分。
   */
  updatePreciseMarker(key: string | null, score: number | null): void;
}

export function createSvgLayers(
  stage: HTMLElement,
  config: Readonly<ScentProfileConfig>,
  geo: Readonly<DerivedGeometry>,
): SvgLayers {
  const axes = computeAxes(config.startAngleDeg);

  const gridSvg = buildBaseSvg("sp-grid-svg", config.logicalSize);
  const labelsSvg = buildBaseSvg("sp-labels-svg", config.logicalSize);

  buildGridDots(gridSvg, config, geo);
  const radialByKey = buildRadialLines(gridSvg, geo, axes);
  const labelByKey = buildLabels(labelsSvg, config, geo, axes);

  stage.appendChild(gridSvg);
  stage.appendChild(labelsSvg);

  // 调试轮廓容器常驻但默认隐藏，避免反复创建节点。
  const contourGroup = svgElement("g");
  contourGroup.setAttribute("class", "sp-debug-contour");
  contourGroup.setAttribute("display", "none");
  gridSvg.appendChild(contourGroup);

  // P4 精确标记：常驻节点，默认隐藏，交互时移动到显示分数位置。
  const preciseMarker = svgElement("circle");
  preciseMarker.setAttribute("class", "sp-precise-marker");
  preciseMarker.setAttribute("r", "4");
  preciseMarker.setAttribute("display", "none");
  labelsSvg.appendChild(preciseMarker);

  return {
    gridSvg,
    labelsSvg,
    updateDebugContour(scores) {
      return updateContour(contourGroup, scores, config, geo, axes);
    },
    setAxisHighlight(key) {
      for (const [axisKey, line] of radialByKey) {
        line.classList.toggle("sp-axis-active", axisKey === key);
      }
      for (const [axisKey, text] of labelByKey) {
        text.classList.toggle("sp-label-active", axisKey === key);
      }
    },
    updatePreciseMarker(key, score) {
      if (key === null || score === null) {
        preciseMarker.setAttribute("display", "none");
        return;
      }
      const axis = axes.find((a) => a.key === key);
      if (!axis) {
        preciseMarker.setAttribute("display", "none");
        return;
      }
      const nodeRadius = axisRadius(score, geo.maxRadius);
      const p = polarToXY(geo.cx, geo.cy, nodeRadius, axis.angleRad);
      preciseMarker.setAttribute("cx", p.x.toFixed(2));
      preciseMarker.setAttribute("cy", p.y.toFixed(2));
      preciseMarker.setAttribute("data-scent-key", key);
      preciseMarker.removeAttribute("display");
    },
  };
}

function buildBaseSvg(className: string, logicalSize: number): SVGSVGElement {
  const svg = svgElement("svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", `0 0 ${logicalSize} ${logicalSize}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

function buildGridDots(
  svg: SVGSVGElement,
  config: Readonly<ScentProfileConfig>,
  geo: Readonly<DerivedGeometry>,
): void {
  const group = svgElement("g");
  group.setAttribute("class", "sp-rings");
  for (const fraction of config.ringFractions) {
    const ringRadius = geo.maxRadius * fraction;
    const count = ringDotCount(ringRadius, config.gridDotSpacingPx);
    for (let j = 0; j < count; j++) {
      const angle = ringDotAngle(j, count);
      const p = polarToXY(geo.cx, geo.cy, ringRadius, angle);
      const dot = svgElement("circle");
      dot.setAttribute("cx", p.x.toFixed(2));
      dot.setAttribute("cy", p.y.toFixed(2));
      dot.setAttribute("r", config.gridDotRadiusPx.toFixed(2));
      group.appendChild(dot);
    }
  }
  svg.appendChild(group);
}

function buildRadialLines(
  svg: SVGSVGElement,
  geo: Readonly<DerivedGeometry>,
  axes: ReturnType<typeof computeAxes>,
): Map<string, SVGLineElement> {
  const group = svgElement("g");
  group.setAttribute("class", "sp-radials");
  const center = { x: geo.cx, y: geo.cy };
  const byKey = new Map<string, SVGLineElement>();
  for (const axis of axes) {
    const outer = polarToXY(geo.cx, geo.cy, geo.maxRadius, axis.angleRad);
    const line = svgElement("line");
    line.setAttribute("x1", center.x.toFixed(2));
    line.setAttribute("y1", center.y.toFixed(2));
    line.setAttribute("x2", outer.x.toFixed(2));
    line.setAttribute("y2", outer.y.toFixed(2));
    line.setAttribute("data-scent-key", axis.key);
    byKey.set(axis.key, line);
    group.appendChild(line);
  }
  svg.appendChild(group);
  return byKey;
}

function buildLabels(
  svg: SVGSVGElement,
  config: Readonly<ScentProfileConfig>,
  geo: Readonly<DerivedGeometry>,
  axes: ReturnType<typeof computeAxes>,
): Map<string, SVGTextElement> {
  const group = svgElement("g");
  group.setAttribute("class", "sp-labels");
  const byKey = new Map<string, SVGTextElement>();
  for (const axis of axes) {
    const p = polarToXY(geo.cx, geo.cy, geo.labelRadius, axis.angleRad);
    const rotation = readableTangentAngle(axis.angleDeg);
    const text = svgElement("text");
    text.setAttribute("x", p.x.toFixed(2));
    text.setAttribute("y", p.y.toFixed(2));
    // 以标签坐标为中心旋转，居中锚定（Tech_stack.md §10.2）。
    text.setAttribute("transform", `rotate(${rotation.toFixed(2)} ${p.x.toFixed(2)} ${p.y.toFixed(2)})`);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("dominant-baseline", "middle");
    text.setAttribute("font-size", config.labelFontSizePx.toFixed(1));
    text.setAttribute("data-scent-key", axis.key);
    text.textContent = axis.label;
    byKey.set(axis.key, text);
    group.appendChild(text);
  }
  svg.appendChild(group);
  return byKey;
}

function updateContour(
  group: SVGGElement,
  scores: readonly number[] | null,
  config: Readonly<ScentProfileConfig>,
  geo: Readonly<DerivedGeometry>,
  axes: ReturnType<typeof computeAxes>,
): { ok: boolean; errors: string[] } {
  // 清空旧内容；无论成败都先回到隐藏状态。
  group.replaceChildren();
  group.setAttribute("display", "none");

  if (scores === null) {
    return { ok: true, errors: [] };
  }
  const invalid =
    scores.length !== 8 ||
    scores.some((v) => !Number.isFinite(v) || v < 0 || v > 100);
  if (invalid) {
    return { ok: false, errors: ["Debug contour expects eight scores in [0, 100]"] };
  }

  const startAngle = (config.startAngleDeg * Math.PI) / 180;
  const radius = makeCyclicRadius(scores, geo.maxRadius, startAngle);

  const points: string[] = [];
  const step = (Math.PI * 2) / CONTOUR_SAMPLES;
  for (let i = 0; i <= CONTOUR_SAMPLES; i++) {
    const theta = startAngle + i * step;
    const p = polarToXY(geo.cx, geo.cy, radius(theta), theta);
    points.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  }
  const polyline = svgElement("polyline");
  polyline.setAttribute("points", points.join(" "));
  polyline.setAttribute("class", "sp-debug-contour-line");
  group.appendChild(polyline);

  // 八个轴节点标记：精确半径处的空心圆点，供几何核对。
  const markers = svgElement("g");
  markers.setAttribute("class", "sp-debug-contour-nodes");
  for (const axis of axes) {
    const nodeRadius = axisRadius(scores[axis.index], geo.maxRadius);
    const p = polarToXY(geo.cx, geo.cy, nodeRadius, axis.angleRad);
    const marker = svgElement("circle");
    marker.setAttribute("cx", p.x.toFixed(2));
    marker.setAttribute("cy", p.y.toFixed(2));
    marker.setAttribute("r", "3");
    marker.setAttribute("data-scent-key", axis.key);
    markers.appendChild(marker);
  }
  group.appendChild(markers);

  group.setAttribute("display", "");
  return { ok: true, errors: [] };
}
