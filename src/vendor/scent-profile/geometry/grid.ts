/**
 * 八轴坐标与网格几何（Request.md §2.2、Tech_stack.md §4.2、§10）。
 *
 * 坐标约定：屏幕坐标，正右为 0°，向下为正，角度顺时针增加。
 * SVG、Canvas、热点和命中区都由本模块（经统一配置）计算位置，
 * 保证调整起始角时全部图层同步旋转。
 */

import { SCENT_KEYS } from "../types";

const TAU = Math.PI * 2;
export const AXIS_COUNT = SCENT_KEYS.length; // 8
export const AXIS_STEP_DEG = 360 / AXIS_COUNT; // 45°

/** 一根轴的全部静态几何信息。 */
export interface AxisInfo {
  readonly index: number;
  readonly key: (typeof SCENT_KEYS)[number];
  readonly label: string;
  readonly angleDeg: number;
  readonly angleRad: number;
  readonly cos: number;
  readonly sin: number;
}

/**
 * 计算八根轴的角度。startAngleDeg 为第 0 轴（lemon）的屏幕角度，
 * 其余每隔 45° 顺时针排列。
 */
export function computeAxes(startAngleDeg: number): AxisInfo[] {
  if (!Number.isFinite(startAngleDeg)) {
    throw new TypeError("startAngleDeg must be finite");
  }
  return SCENT_KEYS.map((key, index) => {
    // 归一到 (-180, 180]，避免 270° 与 -90° 两种写法并存。
    const angleDeg = normalizeDeg(startAngleDeg + index * AXIS_STEP_DEG);
    const angleRad = (angleDeg * Math.PI) / 180;
    return {
      index,
      key,
      label: labelOf(key),
      angleDeg,
      angleRad,
      cos: Math.cos(angleRad),
      sin: Math.sin(angleRad),
    };
  });
}

function labelOf(key: (typeof SCENT_KEYS)[number]): string {
  // 英文标签固定，硬件命名核对由数据侧负责，前端不擅自替换。
  const labels: Record<(typeof SCENT_KEYS)[number], string> = {
    lemon: "Lemon",
    rose: "Rose",
    lavender: "Lavender",
    grass: "Grass",
    peach: "Peach",
    clove: "Clove",
    cedarwood: "Cedarwood",
    vanilla: "Vanilla",
  };
  return labels[key];
}

/** 角度归一到 (-180, 180]（-180 映射为 180，左右同向唯一表示）。 */
export function normalizeDeg(deg: number): number {
  const normalized = ((((deg + 180) % 360) + 360) % 360) - 180;
  return normalized === -180 ? 180 : normalized;
}

/** 极坐标 → 屏幕坐标（y 向下为正，故顺时针角度直接可用）。 */
export function polarToXY(
  cx: number,
  cy: number,
  radius: number,
  angleRad: number,
): { x: number; y: number } {
  return {
    x: cx + radius * Math.cos(angleRad),
    y: cy + radius * Math.sin(angleRad),
  };
}

/** 一条圆环的圆点数：按近似固定弧长间距分布，至少 24 个。 */
export function ringDotCount(ringRadius: number, dotSpacing: number): number {
  if (!(ringRadius > 0) || !(dotSpacing > 0)) {
    throw new TypeError("ringRadius and dotSpacing must be positive");
  }
  return Math.max(24, Math.round((TAU * ringRadius) / dotSpacing));
}

/** 第 j 个圆点的角度（弧度），j ∈ [0, count)。 */
export function ringDotAngle(j: number, count: number): number {
  return (TAU * j) / count;
}

/**
 * 切向文字旋转角：切线方向为 theta + 90°，再规范到不倒置的 [-90°, 90°]，
 * 使下半圈文字翻转保持可读（Tech_stack.md §10.2）。
 */
export function readableTangentAngle(thetaDeg: number): number {
  let a = (((thetaDeg + 90 + 180) % 360) + 360) % 360 - 180;
  if (a > 90) a -= 180;
  if (a < -90) a += 180;
  return a;
}
