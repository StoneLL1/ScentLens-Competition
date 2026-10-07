import type { ScentProfileConfig } from '../config';

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** All envelopes shrink with the local radius; zero never acquires a halo. */
export function bodyMask(d: number, r: number, R: number, config: Readonly<ScentProfileConfig>): number {
  if (r <= 0) return 0;
  const w = Math.min(0.18 * r, config.bodyEdgeWidthRatio * R);
  return 1 - smoothstep(r - w, r + w, d);
}

export function fogMask(d: number, r: number, R: number, noise: number, config: Readonly<ScentProfileConfig>): number {
  if (r <= 0 || d >= r + config.maxOuterHaloRatio * R) return 0;
  const w = Math.min(0.24 * r, config.maxOuterHaloRatio * R);
  const edge = r * (0.96 + 0.01 * noise);
  return 1 - smoothstep(edge - w, edge + w, d);
}
