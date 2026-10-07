/**
 * 固定演示与测试数据（Request.md §2.4、§9.2）。
 * 数组顺序固定为 SCENT_KEYS 顺序；仅用于视觉调试与回归，
 * 演示入口必须标记 Demo data，不得伪装为设备测量结果。
 */

import { SCENT_KEYS, type Scores } from "../types";

export interface NamedPreset {
  /** 展示名（与 Request.md §9.2 表格一致）。 */
  name: string;
  /** 固定顺序数组：lemon, rose, lavender, grass, peach, clove, cedarwood, vanilla。 */
  values: readonly number[];
  /** 预期重点说明，供调试对照。 */
  note: string;
}

/** 默认演示数据：右侧暖色突出、左上冷色宽、底部内收。 */
export const DEMO_DATA: Readonly<Scores> = {
  lemon: 28,
  rose: 94,
  lavender: 58,
  grass: 12,
  peach: 34,
  clove: 24,
  cedarwood: 80,
  vanilla: 54,
};

/** Request.md §9.2 必备测试预设，保持原始数组不变。 */
export const PRESETS: readonly NamedPreset[] = [
  {
    name: "Reference mix",
    values: [28, 94, 58, 12, 34, 24, 80, 54],
    note: "右侧暖色突出，左上冷色宽，底部内收",
  },
  {
    name: "Rose only",
    values: [0, 95, 0, 0, 0, 0, 0, 0],
    note: "只有 Rose 方向显著外延，不伪造其他气味",
  },
  {
    name: "Adjacent strong",
    values: [15, 90, 86, 12, 20, 18, 22, 16],
    note: "Rose 与 Lavender 形成相连的宽区域",
  },
  {
    name: "Opposite strong",
    values: [10, 90, 10, 10, 10, 85, 10, 10],
    note: "两侧延伸，不出现自交",
  },
  {
    name: "Uniform middle",
    values: [60, 60, 60, 60, 60, 60, 60, 60],
    note: "名义轮廓接近圆，无八个强制热点",
  },
  {
    name: "Uniform low",
    values: [15, 15, 15, 15, 15, 15, 15, 15],
    note: "小而淡，不自动放大",
  },
  {
    name: "Uniform high",
    values: [85, 85, 85, 85, 85, 85, 85, 85],
    note: "大于全低值，仍保留柔软边缘",
  },
  {
    name: "All zero",
    values: [0, 0, 0, 0, 0, 0, 0, 0],
    note: "最终完全清除彩色云",
  },
  {
    name: "Alternating",
    values: [95, 5, 95, 5, 95, 5, 95, 5],
    note: "保留真实高低差，不把数据强行圆化",
  },
  {
    name: "Maximum",
    values: [100, 100, 100, 100, 100, 100, 100, 100],
    note: "不裁切、不压住标签",
  },
];

/** 顺序数组 → Scores 对象；长度必须为 8。 */
export function arrayToScores(values: readonly number[]): Scores {
  if (values.length !== SCENT_KEYS.length) {
    throw new TypeError(`Expected ${SCENT_KEYS.length} scores, got ${values.length}`);
  }
  const out = {} as Scores;
  SCENT_KEYS.forEach((key, i) => {
    out[key] = values[i];
  });
  return out;
}
