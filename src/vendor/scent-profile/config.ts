/**
 * 唯一的默认参数来源（Tech_stack.md §4.1）。
 * 视觉调参只改这里，不把数值散落到各函数；P2+ 的材质与动效参数
 * 也集中在此扩展，避免双份配置。
 */

export interface ScentProfileConfig {
  /** 正方形图形区逻辑边长（逻辑坐标，不含标题）。 */
  logicalSize: number;
  /** 100 分圆环半径 / 逻辑边长。 */
  radiusRatio: number;
  /** 标签中心半径 / 逻辑边长。 */
  labelRadiusRatio: number;
  /** Lemon 的屏幕角度（度）；顺时针为正，正右为 0°。 */
  startAngleDeg: number;
  /** 五层参考圆环（半径 / R）。 */
  ringFractions: number[];
  /** 周期径向查找表采样数，必须能被 8 整除。 */
  angularSamples: number;
  /** 主体最大半边羽化宽度 / R（P2 使用）。 */
  bodyEdgeWidthRatio: number;
  /** 外围雾超过名义半径的最大长度 / R（P2 使用）。 */
  maxOuterHaloRatio: number;
  /** 第一份有效结果的出现时长（P4 使用）。 */
  entryMs: number;
  /** 离散数据更新时长（P4 使用）。 */
  transitionMs: number;
  /** 流式视觉跟随时间常数（P4 使用）。 */
  streamTauMs: number;
  /** 流式跟随收敛阈值：最大显示误差小于该分值时吸附到目标（P4 使用）。 */
  streamSnapEpsilon: number;
  /** 活跃数据流的过期阈值；仅对流式帧生效（P3 使用）。 */
  staleAfterMs: number;
  /** JSON 面板单条输入的大小上限（字节，本项目保护值）（P3 使用）。 */
  jsonMaxBytes: number;
  /** 外缘呼吸周期（P4 使用）。 */
  breathPeriodMs: number;
  /** 雾层透明度相对变化幅度（P4 使用）。 */
  breathAmount: number;
  /** 固定材质种子，不随数据包变化（P2 使用）。 */
  seed: number;
  /** 显示层像素比上限起点（P5 使用）。 */
  dprCap: number;
  /** 默认云层计算缓冲区边长（P2/P5 使用）。 */
  fieldSize: number;
  /** 点状圆环的近似弧长点距（逻辑像素）。 */
  gridDotSpacingPx: number;
  /** 圆点半径（逻辑像素）。 */
  gridDotRadiusPx: number;
  /** 圆点透明度。 */
  gridDotOpacity: number;
  /** 径向线宽（逻辑像素）。 */
  gridRadialLineWidthPx: number;
  /** 径向线透明度。 */
  gridRadialLineOpacity: number;
  /** 维度标签字号（逻辑像素；实际 CSS 字号在 P5 校验下限）。 */
  labelFontSizePx: number;
}

export const DEFAULT_CONFIG: Readonly<ScentProfileConfig> = {
  logicalSize: 640,
  radiusRatio: 0.37,
  labelRadiusRatio: 0.435,
  startAngleDeg: -45,
  ringFractions: [0.2, 0.4, 0.6, 0.8, 1],
  angularSamples: 1024,
  bodyEdgeWidthRatio: 0.045,
  maxOuterHaloRatio: 0.05,
  entryMs: 900,
  transitionMs: 900,
  streamTauMs: 220,
  streamSnapEpsilon: 0.05,
  staleAfterMs: 5000,
  jsonMaxBytes: 16384,
  breathPeriodMs: 8000,
  breathAmount: 0.02,
  seed: 688,
  dprCap: 2,
  fieldSize: 384,
  gridDotSpacingPx: 15,
  gridDotRadiusPx: 0.7,
  gridDotOpacity: 0.18,
  gridRadialLineWidthPx: 0.6,
  gridRadialLineOpacity: 0.12,
  labelFontSizePx: 14,
};

/** Reference material v2: overlapping pigment washes and independent outer mist. */
export const MATERIAL = {
  coolWeights: [0.85, 0, 0.55, 1, 0, 0.25, 1, 0.1],
  palette: [[88, 155, 187], [181, 104, 145], [155, 136, 169], [57, 125, 166], [155, 43, 51]] as const,
  groupCenter: 0.76,
  groupSigma: [0.40, 0.32],
  groupGain: 3.0,
  groupDensityExponent: 1.12,
  bridgeGain: 0.24,
  coreCenter: 0.55,
  coolCoreSigma: [0.19, 0.15],
  warmCoreSigma: [0.125, 0.10],
  coreGain: 4.8,
  coolCoreGain: 0.62,
  washLayers: [
    { start: 0.40, end: 0.87, weight: 0.60, warp: 0.05 },
    { start: 0.70, end: 0.96, weight: 0.26, warp: -0.035 },
    { start: 0.89, end: 1.04, weight: 0.14, warp: 0.02 },
  ],
  coreFadeStart: 0.58,
  coreFadeEnd: 0.97,
  fogSpread: 1.25,
  fogGain: 0.28,
  fogFadeStart: 0.65,
  fogFadeEnd: 1.10,
  textureAmount: 0.03,
  textureScale: 4,
} as const;

/** 由配置推导的派生几何量。 */
export interface DerivedGeometry {
  /** 逻辑坐标系边长。 */
  size: number;
  /** 图形中心（逻辑坐标）。 */
  cx: number;
  cy: number;
  /** 100 分对应的最大数据半径。 */
  maxRadius: number;
  /** 标签中心半径。 */
  labelRadius: number;
}

export function deriveGeometry(config: Readonly<ScentProfileConfig>): DerivedGeometry {
  return {
    size: config.logicalSize,
    cx: config.logicalSize / 2,
    cy: config.logicalSize / 2,
    maxRadius: config.logicalSize * config.radiusRatio,
    labelRadius: config.logicalSize * config.labelRadiusRatio,
  };
}

/**
 * 合并使用方覆盖项并做基本合法性检查。配置是开发者接口，
 * 非法配置直接抛 TypeError，而不是静默回退默认值。
 */
export function resolveConfig(
  overrides?: Partial<ScentProfileConfig>,
): ScentProfileConfig {
  // 显式传入的 undefined 视同“未覆盖”：先剔除再合并，
  // 避免 spread 用 undefined 顶掉默认值。
  const provided = Object.fromEntries(
    Object.entries(overrides ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<ScentProfileConfig>;
  const merged: ScentProfileConfig = { ...DEFAULT_CONFIG, ...provided };

  const positive = (v: number, name: string): void => {
    if (!Number.isFinite(v) || v <= 0) {
      throw new TypeError(`config.${name} must be a positive finite number`);
    }
  };

  positive(merged.logicalSize, "logicalSize");
  positive(merged.radiusRatio, "radiusRatio");
  positive(merged.labelRadiusRatio, "labelRadiusRatio");
  if (merged.labelRadiusRatio <= merged.radiusRatio) {
    throw new TypeError("config.labelRadiusRatio must exceed radiusRatio");
  }
  if (!Number.isFinite(merged.startAngleDeg)) {
    throw new TypeError("config.startAngleDeg must be finite");
  }
  if (
    !Array.isArray(merged.ringFractions) ||
    merged.ringFractions.length === 0 ||
    merged.ringFractions.some((f) => !Number.isFinite(f) || f <= 0 || f > 1)
  ) {
    throw new TypeError("config.ringFractions must be values in (0, 1]");
  }
  positive(merged.entryMs, "entryMs");
  positive(merged.transitionMs, "transitionMs");
  positive(merged.streamTauMs, "streamTauMs");
  positive(merged.streamSnapEpsilon, "streamSnapEpsilon");
  positive(merged.staleAfterMs, "staleAfterMs");
  positive(merged.jsonMaxBytes, "jsonMaxBytes");
  if (
    !Number.isInteger(merged.angularSamples) ||
    merged.angularSamples <= 0 ||
    merged.angularSamples % 8 !== 0
  ) {
    throw new TypeError("config.angularSamples must be a positive multiple of 8");
  }

  return merged;
}
