import { deriveGeometry, MATERIAL, type ScentProfileConfig } from '../config';
import { buildPolarCache } from '../geometry/polar-cache';
import { buildCyclicRadiusLUT, sampleLUT } from '../geometry/cyclic-radius';
import { bodyMask, fogMask, smoothstep } from '../fields/masks';
import { buildDensityFields, gaussian } from '../fields/density';
import { stableNoise } from '../fields/noise';
import { writeOklab } from '../fields/colors';

export type RenderView = 'color' | 'mask' | 'density' | 'contour';

/** Pure pixel pipeline, also used by numerical boundary and reproducibility tests. */
export function createPixelRenderer(config: Readonly<ScentProfileConfig>) {
  const geo = deriveGeometry(config), size = config.fieldSize;
  const cache = buildPolarCache(size, geo.size);
  const body = new Uint8ClampedArray(size*size*4), fog = new Uint8ClampedArray(body.length);
  const noise = new Float32Array(size*size);
  for (let i = 0; i < noise.length; i++) {
    noise[i] = stableNoise((i%size)/size*MATERIAL.textureScale, Math.floor(i/size)/size*MATERIAL.textureScale, config.seed);
  }
  return { body, fog, render(scores: readonly number[], view: RenderView = 'color') {
    const lut = buildCyclicRadiusLUT(scores, geo.maxRadius, config.startAngleDeg*Math.PI/180, config.angularSamples);
    body.fill(0); fog.fill(0);
    if (scores.every(v => v === 0) || view === 'contour') return;
    const fields = buildDensityFields(scores, config.startAngleDeg);
    const mistFields = fields.filter(field => !field.core).map(field => ({
      ...field, su: field.su*MATERIAL.fogSpread, sv: field.sv*MATERIAL.fogSpread,
    }));
    for (let i = 0; i < noise.length; i++) {
      const r = sampleLUT(lut, cache.theta[i]), d = cache.distance[i], offset = i*4;
      if (r <= 0 || d >= r + config.maxOuterHaloRatio*geo.maxRadius) continue;
      const mask = bodyMask(d, r, geo.maxRadius, config);
      const mist = fogMask(d, r, geo.maxRadius, noise[i], config);
      if (view === 'mask') {
        body[offset] = body[offset+1] = body[offset+2] = 70;
        body[offset+3] = 255*mask;
        continue;
      }
      const x = ((i%size+0.5)*geo.size/size-geo.cx)/geo.maxRadius;
      const y = ((Math.floor(i/size)+0.5)*geo.size/size-geo.cy)/geo.maxRadius;
      // Polar radial distance exaggerates the edge steepness on sloping sides.
      // First-order normal distance broadens the wash inward, never the data support.
      const step = Math.PI*2/config.angularSamples;
      const derivative = (sampleLUT(lut,cache.theta[i]+step)-sampleLUT(lut,cache.theta[i]-step))/(2*step);
      const normalFactor = Math.hypot(1,derivative/r);
      const washDistance = d < r ? r-(r-d)/normalFactor : d;
      let density = 0, L = 0, a = 0, b = 0;
      const coreMask = 1 - smoothstep(MATERIAL.coreFadeStart*r, MATERIAL.coreFadeEnd*r, washDistance);
      // Differently warped washes overlap continuously, with no contour quantization.
      // The outer support still comes exclusively from the unchanged data mask.
      let interior = 0;
      for (const layer of MATERIAL.washLayers) {
        const warp = layer.warp*noise[i];
        interior += layer.weight*(1-smoothstep((layer.start+warp)*r, (layer.end+warp)*r, washDistance));
      }
      for (const field of fields) {
        const contribution = gaussian(field,x,y) * (field.core ? coreMask : interior);
        density += contribution;
        L += contribution*field.color[0]; a += contribution*field.color[1]; b += contribution*field.color[2];
      }
      const texture = 1 + MATERIAL.textureAmount*noise[i];
      body[offset+3] = 255 * (1-Math.exp(-density*texture*mask));
      if (view === 'density') {
        body[offset] = body[offset+1] = body[offset+2] = 45;
      } else {
        if (density > 0) writeOklab(body, offset, L/density, a/density, b/density);
        // Mist has its own broad density and color, never diluted core pigment.
        let wide = 0, fogL = 0, fogA = 0, fogB = 0;
        for (const field of mistFields) {
          const contribution = gaussian(field,x,y);
          wide += contribution;
          fogL += contribution*field.color[0]; fogA += contribution*field.color[1]; fogB += contribution*field.color[2];
        }
        const diffusion = 1-smoothstep(MATERIAL.fogFadeStart*r, MATERIAL.fogFadeEnd*r, d);
        if (wide > 0) writeOklab(fog, offset, fogL/wide, fogA/wide, fogB/wide);
        fog[offset+3] = 255*(1-Math.exp(-wide*MATERIAL.fogGain*mist*texture*diffusion));
      }
    }
  }};
}

export function createCanvasRenderer(bodyCanvas: HTMLCanvasElement, fogCanvas: HTMLCanvasElement, config: Readonly<ScentProfileConfig>) {
  const pixels = createPixelRenderer(config);
  // WebKit can defer drawImage's source read. Reusing one scratch canvas for
  // both layers allowed the following fog write to replace the body pixels.
  // Keep each layer's source independent; the pixel algorithm is unchanged.
  function layerBuffer() {
    const scratch = document.createElement('canvas');
    scratch.width = scratch.height = config.fieldSize;
    const ctx = scratch.getContext('2d')!;
    return { scratch, ctx, image: ctx.createImageData(config.fieldSize, config.fieldSize) };
  }
  const bodyBuffer = layerBuffer(), fogBuffer = layerBuffer();
  function display(canvas: HTMLCanvasElement, { scratch, ctx, image }: ReturnType<typeof layerBuffer>, data: Uint8ClampedArray) {
    image.data.set(data); ctx.putImageData(image, 0, 0);
    const target = canvas.getContext('2d')!;
    target.clearRect(0,0,canvas.width,canvas.height);
    target.imageSmoothingEnabled = true;
    target.drawImage(scratch,0,0,canvas.width,canvas.height);
  }
  return {
    render(scores: readonly number[], view: RenderView) {
      pixels.render(scores, view);
      display(bodyCanvas, bodyBuffer, pixels.body); display(fogCanvas, fogBuffer, pixels.fog);
    },
    clear() {
      for (const canvas of [bodyCanvas,fogCanvas]) canvas.getContext('2d')!.clearRect(0,0,canvas.width,canvas.height);
    },
  };
}
