/**
 * 像素角度 / 距离缓存（Tech_stack.md §4.2、§5.4、§9.3）。
 *
 * 云层像素管线（P2）每次逐像素计算都需要“逻辑坐标、到中心的距离、
 * 角度”，本模块在缓冲区尺寸确定后一次性预计算并复用。
 *
 * 坐标换算（§4.2）：
 *   x = (pixelX + 0.5) / fieldWidth  × S
 *   y = (pixelY + 0.5) / fieldHeight × S
 * （+0.5 取像素中心。）
 *
 * 中心像素分支：d = 0 时 atan2(0, 0) 的返回值不具备稳定语义，
 * 可能在中心产生一条与数据无关的缝。这里固定取 theta = 0 做确定性处理；
 * 遮罩只依赖 d 与该方向的名义半径，单像素的确定性角度不足以影响轮廓。
 * 不借该分支扩出与数据无关的大中心圆。
 */

export interface PolarCache {
  /** 缓冲区边长（像素）。 */
  readonly fieldSize: number;
  /** 逻辑坐标边长。 */
  readonly logicalSize: number;
  readonly cx: number;
  readonly cy: number;
  /** 每像素到中心的距离（逻辑单位），行主序。 */
  readonly distance: Float32Array;
  /** 每像素角度（屏幕弧度）；中心像素固定为 0。 */
  readonly theta: Float32Array;
}

export function buildPolarCache(fieldSize: number, logicalSize: number): PolarCache {
  if (
    !Number.isInteger(fieldSize) ||
    fieldSize <= 0 ||
    !Number.isFinite(logicalSize) ||
    logicalSize <= 0
  ) {
    throw new TypeError("fieldSize must be a positive integer and logicalSize positive");
  }
  const cx = logicalSize / 2;
  const cy = logicalSize / 2;
  const distance = new Float32Array(fieldSize * fieldSize);
  const theta = new Float32Array(fieldSize * fieldSize);
  const scale = logicalSize / fieldSize;

  for (let py = 0; py < fieldSize; py++) {
    const y = (py + 0.5) * scale - cy;
    for (let px = 0; px < fieldSize; px++) {
      const x = (px + 0.5) * scale - cx;
      const i = py * fieldSize + px;
      const d = Math.hypot(x, y);
      distance[i] = d;
      // 中心像素（以及 d 数值为 0 的位置）走确定性分支，不调用 atan2(0,0)。
      theta[i] = d > 0 ? Math.atan2(y, x) : 0;
    }
  }

  return { fieldSize, logicalSize, cx, cy, distance, theta };
}
