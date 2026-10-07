/**
 * 周期保形径向插值（Tech_stack.md §5）。
 *
 * 以八个轴半径 r_i = R × score_i / 100 为控制值，在“角度 → 半径”之间
 * 做循环索引的 PCHIP 风格三次 Hermite 插值：
 * - 相邻区间斜率符号不一致或为零时，节点导数取 0；
 * - 斜率同号时取调和平均。
 * 该规则局部保形、抑制过冲，均匀输入得到常数半径（圆形名义轮廓）。
 *
 * 导数在“归一化到一段的索引坐标”中计算，因此 Hermite 基不再乘角度步长；
 * 改为按弧度计算导数的实现必须重新处理步长，不能混用两套单位。
 *
 * 线性映射是数据语义（不得用 sqrt 或按样本最大值归一化），
 * 非线性权重只允许出现在 P2 的着色模块中。
 */

const TAU = Math.PI * 2;
const AXIS_COUNT = 8;

export type RadiusFunction = (theta: number) => number;

/**
 * 构造周期半径函数。scores 为 SCENT_KEYS 固定顺序的八个 [0,100] 数值。
 * theta 使用屏幕坐标弧度（正右为 0，向下为正，顺时针增加）。
 */
export function makeCyclicRadius(
  scores: readonly number[],
  maxRadius: number,
  startAngle = -Math.PI / 4,
): RadiusFunction {
  const n = AXIS_COUNT;
  if (
    scores.length !== n ||
    scores.some((v) => !Number.isFinite(v) || v < 0 || v > 100) ||
    !Number.isFinite(maxRadius) ||
    maxRadius <= 0 ||
    !Number.isFinite(startAngle)
  ) {
    throw new TypeError("Expected eight valid scores and a positive radius");
  }

  const r = scores.map((v) => (maxRadius * v) / 100);
  const delta = r.map((v, i) => r[(i + 1) % n] - v);
  const slope = delta.map((next, i) => {
    const prev = delta[(i + n - 1) % n];
    return (prev * next) <= 0 ? 0 : (2 * prev * next) / (prev + next);
  });

  return (theta: number): number => {
    if (!Number.isFinite(theta)) {
      throw new TypeError("theta must be finite");
    }
    const raw = ((theta - startAngle) * n) / TAU;
    const u = ((raw % n) + n) % n;
    const i = Math.floor(u);
    const j = (i + 1) % n;
    const t = u - i;
    const t2 = t * t;
    const t3 = t2 * t;

    const value =
      (2 * t3 - 3 * t2 + 1) * r[i] +
      (t3 - 2 * t2 + t) * slope[i] +
      (-2 * t3 + 3 * t2) * r[j] +
      (t3 - t2) * slope[j];

    // 仅用于浮点误差保护；正常插值不应超出本段端点范围。
    return Math.min(Math.max(value, Math.min(r[i], r[j])), Math.max(r[i], r[j]));
  };
}

/** 第 i 根轴的名义半径：r_i = R × score_i / 100（精确值，供测试与精确标记）。 */
export function axisRadius(score: number, maxRadius: number): number {
  if (!Number.isFinite(score) || score < 0 || score > 100 || maxRadius <= 0) {
    throw new TypeError("Expected a score in [0, 100] and a positive radius");
  }
  return (maxRadius * score) / 100;
}

/**
 * 周期径向查找表：均匀采样 angularSamples 个角度，并额外复制第一个值
 * 作为第 angularSamples+1 个接缝点，像素查询用相邻表项线性插值。
 * 表长为 8 的倍数，使轴节点与查找表对齐。
 */
export interface CyclicRadiusLUT {
  readonly samples: number;
  readonly startAngle: number;
  /** 长度 samples+1；values[samples] === values[0]。 */
  readonly values: Float64Array;
}

export function buildCyclicRadiusLUT(
  scores: readonly number[],
  maxRadius: number,
  startAngle: number,
  angularSamples: number,
): CyclicRadiusLUT {
  if (
    !Number.isInteger(angularSamples) ||
    angularSamples <= 0 ||
    angularSamples % AXIS_COUNT !== 0
  ) {
    throw new TypeError("angularSamples must be a positive multiple of 8");
  }
  const radius = makeCyclicRadius(scores, maxRadius, startAngle);
  const values = new Float64Array(angularSamples + 1);
  const step = TAU / angularSamples;
  for (let i = 0; i < angularSamples; i++) {
    values[i] = radius(startAngle + i * step);
  }
  values[angularSamples] = values[0];
  return { samples: angularSamples, startAngle, values };
}

/** 在查找表上按角度线性插值取半径；theta 任意有限弧度，自动处理周期回绕。 */
export function sampleLUT(lut: CyclicRadiusLUT, theta: number): number {
  if (!Number.isFinite(theta)) {
    throw new TypeError("theta must be finite");
  }
  const { samples, values, startAngle } = lut;
  const raw = (((theta - startAngle) / TAU) % 1 + 1) % 1;
  const pos = raw * samples;
  const i = Math.floor(pos);
  // i 最大为 samples-1（raw < 1），i+1 恰好落在接缝点，无需再取模。
  const frac = pos - i;
  return values[i] + (values[i + 1] - values[i]) * frac;
}
