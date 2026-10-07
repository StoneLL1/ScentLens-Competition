import { MATERIAL } from '../config';
import { computeAxes } from '../geometry/grid';
import { srgbToOklab, type Color } from './colors';
import { smoothstep } from './masks';

export interface Field {
  x: number; y: number; cos: number; sin: number;
  su: number; sv: number; amplitude: number; color: Color; core: boolean;
}
const palette = MATERIAL.palette.map(srgbToOklab);

/** Coordinates are normalized to R, computed once for each displayed dataset. */
export function buildDensityFields(scores: readonly number[], startAngleDeg: number): Field[] {
  const p = scores.map(v => v / 100);
  const axes = computeAxes(startAngleDeg);
  const fields: Field[] = [];
  for (let group = 0; group < 2; group++) {
    let total = 0, denominator = 0, x = 0, y = 0;
    for (let i = 0; i < 8; i++) {
      const weight = group === 0 ? MATERIAL.coolWeights[i] : 1 - MATERIAL.coolWeights[i];
      const q = weight * p[i] ** 1.5;
      total += q; denominator += weight;
      x += q * MATERIAL.groupCenter * p[i] * Math.cos(axes[i].angleRad);
      y += q * MATERIAL.groupCenter * p[i] * Math.sin(axes[i].angleRad);
    }
    if (total === 0) continue;
    x /= total; y /= total;
    const angle = Math.atan2(y, x);
    fields.push({ x, y, cos: Math.cos(angle), sin: Math.sin(angle),
      su: MATERIAL.groupSigma[0], sv: MATERIAL.groupSigma[1],
      amplitude: MATERIAL.groupGain * (total / denominator) ** MATERIAL.groupDensityExponent, color: palette[group], core: false });
  }
  fields.push({ x: 0, y: 0, cos: 1, sin: 0, su: 0.4, sv: 0.4,
    amplitude: MATERIAL.bridgeGain * p.reduce((a,b) => a+b, 0) / 8,
    color: palette[2], core: false });
  for (let i = 0; i < 8; i++) {
    const prominence = Math.max(0, p[i] - (p[(i+7)%8] + p[(i+1)%8]) / 2);
    const strength = p[i] ** 2 * smoothstep(0.45, 0.90, p[i]) * smoothstep(0.04, 0.24, prominence);
    const cool = MATERIAL.coolWeights[i];
    const angle = axes[i].angleRad;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const color = palette[3].map((c,j) => c * cool + palette[4][j] * (1-cool)) as unknown as Color;
    fields.push({ x: MATERIAL.coreCenter*p[i]*cos, y: MATERIAL.coreCenter*p[i]*sin,
      cos, sin, su: MATERIAL.coolCoreSigma[0]*cool + MATERIAL.warmCoreSigma[0]*(1-cool),
      sv: MATERIAL.coolCoreSigma[1]*cool + MATERIAL.warmCoreSigma[1]*(1-cool),
      amplitude: MATERIAL.coreGain * strength * (1-cool + cool*MATERIAL.coolCoreGain), color, core: true });
  }
  return fields;
}

export function gaussian(field: Field, x: number, y: number): number {
  const dx = x-field.x, dy = y-field.y;
  const u = (field.cos*dx + field.sin*dy) / field.su;
  const v = (-field.sin*dx + field.cos*dy) / field.sv;
  return field.amplitude * Math.exp(-0.5*(u*u + v*v));
}
