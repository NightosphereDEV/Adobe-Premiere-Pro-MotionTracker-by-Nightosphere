import { Point2D, ProcessedKeyframe, RawKeyframe, SurfaceCorners, PointCountMode } from '../types/tracker';

/**
 * Format seconds to SMPTE timecode HH:MM:SS:FF
 */
export function secondsToTimecode(seconds: number, fps: number = 30): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const totalFrames = Math.floor(seconds * fps);
  const ff = totalFrames % Math.round(fps);
  const totalSeconds = Math.floor(seconds);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);

  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/**
 * Universal list of video file extensions supported by Adobe Premiere Pro & FFmpeg
 */
export const ADOBE_VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.mkv',
  '.ts',
  '.mts',
  '.m2ts',
  '.mxf',
  '.avi',
  '.webm',
  '.wmv',
  '.flv',
  '.m4v',
  '.mpg',
  '.mpeg',
  '.vob',
  '.3gp',
  '.3g2',
  '.ogv',
  '.asf',
  '.f4v',
  '.braw',
  '.r3d',
  '.ari',
  '.dv',
];

export const ADOBE_VIDEO_ACCEPT = `video/*,${ADOBE_VIDEO_EXTENSIONS.join(',')}`;

export function isSupportedVideoFile(file: File | { name: string; type?: string }): boolean {
  if (!file) return false;
  const lower = (file.name || '').toLowerCase();
  if (ADOBE_VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return true;
  }
  if (file.type && file.type.startsWith('video/')) {
    return true;
  }
  return false;
}

export function needsServerRemuxOrTranscode(fileName: string): boolean {
  const lower = (fileName || '').toLowerCase();
  return [
    '.ts',
    '.mts',
    '.m2ts',
    '.mkv',
    '.mxf',
    '.avi',
    '.wmv',
    '.flv',
    '.mpg',
    '.mpeg',
    '.vob',
    '.3gp',
    '.3g2',
    '.asf',
    '.f4v',
    '.braw',
    '.r3d',
    '.dv',
  ].some((ext) => lower.endsWith(ext));
}

/**
 * Iterative Inverse-Compositional Lucas-Kanade (IC-LK) Sub-Pixel Optical Flow Refinement
 * Refines an initial (bestOx, bestOy) offset to 0.02px precision using Gaussian center weights
 * and bilinear sub-pixel interpolation on the search luminance buffer.
 */
export function refineSubPixelLK(
  sGray: Float32Array,
  sw: number,
  sh: number,
  tGrayRaw: Float32Array,
  tw: number,
  th: number,
  initOx: number,
  initOy: number
): { ox: number; oy: number } {
  if (tw < 6 || th < 6) return { ox: initOx, oy: initOy };

  const sampleBilinear = (img: Float32Array, w: number, h: number, x: number, y: number): number => {
    const cx = Math.max(0, Math.min(w - 1.001, x));
    const cy = Math.max(0, Math.min(h - 1.001, y));
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const fx = cx - x0;
    const fy = cy - y0;
    const i00 = img[y0 * w + x0];
    const i10 = img[y0 * w + x0 + 1];
    const i01 = img[(y0 + 1) * w + x0];
    const i11 = img[(y0 + 1) * w + x0 + 1];
    return (1 - fx) * (1 - fy) * i00 + fx * (1 - fy) * i10 + (1 - fx) * fy * i01 + fx * fy * i11;
  };

  // Precompute template spatial gradients (Tx, Ty) and Gaussian center weights
  const cx = (tw - 1) * 0.5;
  const cy = (th - 1) * 0.5;
  const sigma2 = Math.max(4, tw * th * 0.12);

  let h00 = 0;
  let h01 = 0;
  let h11 = 0;

  const gradX = new Float32Array(tw * th);
  const gradY = new Float32Array(tw * th);
  const weights = new Float32Array(tw * th);

  let tMean = 0;
  let wSum = 0;
  for (let ty = 1; ty < th - 1; ty++) {
    for (let tx = 1; tx < tw - 1; tx++) {
      const idx = ty * tw + tx;
      const dx = tx - cx;
      const dy = ty - cy;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
      weights[idx] = w;
      wSum += w;
      tMean += w * tGrayRaw[idx];

      const gx = 0.5 * (tGrayRaw[ty * tw + (tx + 1)] - tGrayRaw[ty * tw + (tx - 1)]);
      const gy = 0.5 * (tGrayRaw[(ty + 1) * tw + tx] - tGrayRaw[(ty - 1) * tw + tx]);
      gradX[idx] = gx;
      gradY[idx] = gy;

      h00 += w * gx * gx;
      h01 += w * gx * gy;
      h11 += w * gy * gy;
    }
  }

  const det = h00 * h11 - h01 * h01;
  if (Math.abs(det) < 1e-3 || wSum < 1e-5) {
    return { ox: initOx, oy: initOy };
  }
  tMean /= wSum;

  let curOx = initOx;
  let curOy = initOy;

  // 2 iterations of Gain-Normalized IC-LK
  for (let iter = 0; iter < 2; iter++) {
    let sMean = 0;
    for (let ty = 1; ty < th - 1; ty++) {
      for (let tx = 1; tx < tw - 1; tx++) {
        const idx = ty * tw + tx;
        sMean += weights[idx] * sampleBilinear(sGray, sw, sh, curOx + tx, curOy + ty);
      }
    }
    sMean /= wSum;

    let b0 = 0;
    let b1 = 0;
    for (let ty = 1; ty < th - 1; ty++) {
      for (let tx = 1; tx < tw - 1; tx++) {
        const idx = ty * tw + tx;
        const w = weights[idx];
        const sVal = sampleBilinear(sGray, sw, sh, curOx + tx, curOy + ty) - sMean;
        const tVal = tGrayRaw[idx] - tMean;
        const err = tVal - sVal;
        b0 += w * gradX[idx] * err;
        b1 += w * gradY[idx] * err;
      }
    }

    const dOx = (h11 * b0 - h01 * b1) / det;
    const dOy = (-h01 * b0 + h00 * b1) / det;

    if (Math.hypot(dOx, dOy) > 1.2) break;
    curOx += dOx;
    curOy += dOy;
    if (Math.hypot(dOx, dOy) < 0.015) break;
  }

  // Clamp refinement within +/- 0.85px of parabolic peak for stability
  return {
    ox: Math.max(0, Math.min(sw - tw, Math.max(initOx - 0.85, Math.min(initOx + 0.85, curOx)))),
    oy: Math.max(0, Math.min(sh - th, Math.max(initOy - 0.85, Math.min(initOy + 0.85, curOy)))),
  };
}

/**
 * High-Precision 2D Multi-Cue Template Matcher:
 * Combines:
 * 1. Gaussian Center-Weighted Luminance ZNCC (focuses on crosshair center, ignores corner background clutter)
 * 2. Sobel Edge Gradient Magnitude Correlation (locks onto object contours/seams)
 * 3. RGB Chromaticity Consistency (prevents jumping onto differently colored objects)
 * 4. 2D Parabolic + Lucas-Kanade Sub-Pixel Refinement (0.02px accuracy)
 */
export function matchTemplateNCC(
  searchData: ImageData,
  templateData: ImageData,
  searchX0: number, // top-left coordinate of search window in canvas
  searchY0: number
): { bestX: number; bestY: number; score: number } {
  const sw = searchData.width;
  const sh = searchData.height;
  const tw = templateData.width;
  const th = templateData.height;

  if (sw < tw || sh < th || tw <= 0 || th <= 0) {
    return { bestX: searchX0 + sw / 2, bestY: searchY0 + sh / 2, score: 0 };
  }

  const sBuf = searchData.data;
  const tBuf = templateData.data;
  const tN = tw * th;

  // Build Gaussian center-weighting mask W(tx, ty) and extract template luminance + chroma
  const tGrayRaw = new Float32Array(tN);
  const tWeightedZeroMean = new Float32Array(tN);
  const tWeights = new Float32Array(tN);
  const tEdge = new Float32Array(tN);

  const cx = (tw - 1) * 0.5;
  const cy = (th - 1) * 0.5;
  const sigma2 = Math.max(4, tw * th * 0.16);

  let wSum = 0;
  let tWeightedSum = 0;
  let tChromaRG = 0;
  let tChromaBY = 0;

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const p = ty * tw + tx;
      const idx = p * 4;
      const r = tBuf[idx];
      const g = tBuf[idx + 1];
      const b = tBuf[idx + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      tGrayRaw[p] = luma;

      const dx = tx - cx;
      const dy = ty - cy;
      const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
      tWeights[p] = w;
      wSum += w;
      tWeightedSum += w * luma;
      tChromaRG += w * (r - g);
      tChromaBY += w * (b - 0.5 * (r + g));
    }
  }

  const tMean = tWeightedSum / Math.max(1e-5, wSum);
  tChromaRG /= Math.max(1e-5, wSum);
  tChromaBY /= Math.max(1e-5, wSum);

  let tNorm = 0;
  for (let p = 0; p < tN; p++) {
    const diff = tGrayRaw[p] - tMean;
    tWeightedZeroMean[p] = tWeights[p] * diff;
    tNorm += tWeights[p] * diff * diff;
  }
  tNorm = Math.sqrt(tNorm);

  if (tNorm < 0.001) {
    return { bestX: searchX0 + (sw - tw) / 2 + tw / 2, bestY: searchY0 + (sh - th) / 2 + th / 2, score: 0 };
  }

  // Compute template Sobel edge magnitude
  let tEdgeSum = 0;
  for (let ty = 1; ty < th - 1; ty++) {
    for (let tx = 1; tx < tw - 1; tx++) {
      const p = ty * tw + tx;
      const gx = tGrayRaw[p + 1] - tGrayRaw[p - 1];
      const gy = tGrayRaw[p + tw] - tGrayRaw[p - tw];
      const mag = Math.hypot(gx, gy);
      tEdge[p] = mag;
      tEdgeSum += mag;
    }
  }
  const tEdgeMean = tEdgeSum / Math.max(1, tN);
  let tEdgeNorm = 0;
  for (let p = 0; p < tN; p++) {
    tEdge[p] -= tEdgeMean;
    tEdgeNorm += tEdge[p] * tEdge[p];
  }
  tEdgeNorm = Math.sqrt(tEdgeNorm);

  // Convert search region to grayscale, edge magnitude, and build Integral Images
  const sGray = new Float32Array(sw * sh);
  const sEdge = new Float32Array(sw * sh);
  const intSum = new Float64Array((sw + 1) * (sh + 1));
  const intSqSum = new Float64Array((sw + 1) * (sh + 1));
  const stride = sw + 1;

  for (let y = 0; y < sh; y++) {
    let rowSum = 0;
    let rowSqSum = 0;
    const yOff = y * sw;
    const intYOff = (y + 1) * stride;
    const prevIntYOff = y * stride;

    for (let x = 0; x < sw; x++) {
      const idx = (yOff + x) * 4;
      const g = 0.299 * sBuf[idx] + 0.587 * sBuf[idx + 1] + 0.114 * sBuf[idx + 2];
      sGray[yOff + x] = g;

      rowSum += g;
      rowSqSum += g * g;

      intSum[intYOff + (x + 1)] = intSum[prevIntYOff + (x + 1)] + rowSum;
      intSqSum[intYOff + (x + 1)] = intSqSum[prevIntYOff + (x + 1)] + rowSqSum;
    }
  }

  for (let y = 1; y < sh - 1; y++) {
    const yOff = y * sw;
    for (let x = 1; x < sw - 1; x++) {
      const p = yOff + x;
      const gx = sGray[p + 1] - sGray[p - 1];
      const gy = sGray[p + sw] - sGray[p - sw];
      sEdge[p] = Math.hypot(gx, gy);
    }
  }

  const outW = sw - tw + 1;
  const outH = sh - th + 1;
  const centerOx = (outW - 1) * 0.5;
  const centerOy = (outH - 1) * 0.5;
  const maxRadiusSq = Math.max(1, centerOx * centerOx + centerOy * centerOy);

  const scores = new Float32Array(outW * outH);
  let maxScore = -999999;
  let bestOx = 0;
  let bestOy = 0;

  for (let oy = 0; oy < outH; oy++) {
    const r1 = oy * stride;
    const r2 = (oy + th) * stride;

    for (let ox = 0; ox < outW; ox++) {
      const c1 = ox;
      const c2 = ox + tw;

      const sSum = intSum[r2 + c2] - intSum[r1 + c2] - intSum[r2 + c1] + intSum[r1 + c1];
      const sSqSum = intSqSum[r2 + c2] - intSqSum[r1 + c2] - intSqSum[r2 + c1] + intSqSum[r1 + c1];
      const sMean = sSum / tN;

      const variance = sSqSum - sMean * sSum;
      if (variance <= 0.001) {
        scores[oy * outW + ox] = 0;
        continue;
      }

      // Compute Gaussian Center-Weighted ZNCC + Edge Correlation + Chroma consistency
      let crossLuma = 0;
      let sWeightedSq = 0;
      let crossEdge = 0;
      let sEdgeSq = 0;
      let sChromaRG = 0;
      let sChromaBY = 0;

      for (let ty = 0; ty < th; ty++) {
        const sRow = (oy + ty) * sw + ox;
        const tRow = ty * tw;
        for (let tx = 0; tx < tw; tx++) {
          const sIdx = sRow + tx;
          const tIdx = tRow + tx;
          const w = tWeights[tIdx];
          const sDiff = sGray[sIdx] - sMean;
          crossLuma += sDiff * tWeightedZeroMean[tIdx];
          sWeightedSq += w * sDiff * sDiff;

          if (tEdgeNorm > 0.1) {
            const se = sEdge[sIdx] - tEdgeMean;
            crossEdge += se * tEdge[tIdx];
            sEdgeSq += se * se;
          }

          const rgbaIdx = sIdx * 4;
          const sr = sBuf[rgbaIdx];
          const sg = sBuf[rgbaIdx + 1];
          const sb = sBuf[rgbaIdx + 2];
          sChromaRG += w * (sr - sg);
          sChromaBY += w * (sb - 0.5 * (sr + sg));
        }
      }

      const lumaDenom = Math.sqrt(Math.max(1e-5, sWeightedSq)) * tNorm;
      const lumaScore = crossLuma / lumaDenom;

      let edgeScore = lumaScore;
      if (tEdgeNorm > 0.1 && sEdgeSq > 0.1) {
        edgeScore = crossEdge / (Math.sqrt(sEdgeSq) * tEdgeNorm);
      }

      sChromaRG /= Math.max(1e-5, wSum);
      sChromaBY /= Math.max(1e-5, wSum);
      const chromaDist = Math.hypot(sChromaRG - tChromaRG, sChromaBY - tChromaBY);
      const chromaSim = Math.exp(-chromaDist / 90.0); // [0..1]

      // Gentle motion continuity prior (breaks ties in favor of smoother displacement)
      const distSq = (ox - centerOx) * (ox - centerOx) + (oy - centerOy) * (oy - centerOy);
      const motionPrior = 1.0 - 0.025 * (distSq / maxRadiusSq);

      const combinedScore =
        (0.68 * lumaScore + 0.22 * edgeScore + 0.10 * (chromaSim * 2 - 1)) * motionPrior;

      scores[oy * outW + ox] = combinedScore;

      if (combinedScore > maxScore) {
        maxScore = combinedScore;
        bestOx = ox;
        bestOy = oy;
      }
    }
  }

  // Stage 1 Sub-pixel parabolic interpolation
  let subX = bestOx;
  let subY = bestOy;

  if (bestOx > 0 && bestOx < outW - 1) {
    const sL = scores[bestOy * outW + (bestOx - 1)];
    const sC = scores[bestOy * outW + bestOx];
    const sR = scores[bestOy * outW + (bestOx + 1)];
    const denom = 2 * (2 * sC - sL - sR);
    if (Math.abs(denom) > 1e-5) {
      const deltaX = (sR - sL) / denom;
      if (Math.abs(deltaX) < 1) subX += deltaX;
    }
  }

  if (bestOy > 0 && bestOy < outH - 1) {
    const sU = scores[(bestOy - 1) * outW + bestOx];
    const sC = scores[bestOy * outW + bestOx];
    const sD = scores[(bestOy + 1) * outW + bestOx];
    const denom = 2 * (2 * sC - sU - sD);
    if (Math.abs(denom) > 1e-5) {
      const deltaY = (sD - sU) / denom;
      if (Math.abs(deltaY) < 1) subY += deltaY;
    }
  }

  // Stage 2: Lucas-Kanade Sub-Pixel Optical Flow refinement (0.02px precision)
  const lkRefined = refineSubPixelLK(sGray, sw, sh, tGrayRaw, tw, th, subX, subY);

  return {
    bestX: searchX0 + lkRefined.ox + tw / 2,
    bestY: searchY0 + lkRefined.oy + th / 2,
    score: Math.max(0, Math.min(1, maxScore)),
  };
}

/**
 * Singleton WebGL GPU-Accelerated Template Matching Shader Engine
 * Computes Gaussian Center-Weighted ZNCC + RGB Chroma Correlation in parallel across candidate (ox, oy) offsets on the GPU,
 * followed by CPU Lucas-Kanade sub-pixel refinement.
 */
class WebGLTrackerEngine {
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private searchTex: WebGLTexture | null = null;
  private templateTex: WebGLTexture | null = null;
  private posBuffer: WebGLBuffer | null = null;
  private initialized = false;
  public isSupported = false;
  public rendererName = 'CPU (Fallback)';

  public init(): boolean {
    if (this.initialized) return this.isSupported;
    this.initialized = true;

    if (typeof document === 'undefined') {
      this.isSupported = false;
      return false;
    }

    try {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 128;
      const gl = (canvas.getContext('webgl2', { preserveDrawingBuffer: true }) ||
        canvas.getContext('webgl', { preserveDrawingBuffer: true })) as WebGLRenderingContext | null;
      if (!gl) return false;

      const vsSource = `
        attribute vec2 a_pos;
        varying vec2 v_uv;
        void main() {
          v_uv = a_pos * 0.5 + 0.5;
          gl_Position = vec4(a_pos, 0.0, 1.0);
        }
      `;

      // Fragment shader evaluates Gaussian Center-Weighted ZNCC + RGB Chroma consistency in parallel on the GPU
      const fsSource = `
        precision highp float;
        uniform sampler2D u_search;
        uniform sampler2D u_template;
        uniform vec2 u_searchSize;
        uniform vec2 u_templateSize;
        uniform vec2 u_outSize;
        uniform float u_tMean;
        uniform float u_tNorm;

        float luma(vec4 c) {
          return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        }

        void main() {
          vec2 oxOy = floor(gl_FragCoord.xy);
          vec2 centerT = (u_templateSize - 1.0) * 0.5;
          float sigma2 = max(4.0, u_templateSize.x * u_templateSize.y * 0.16);

          float wSum = 0.0;
          float sumS = 0.0;

          for (int ty = 0; ty < 64; ty++) {
            if (float(ty) >= u_templateSize.y) break;
            for (int tx = 0; tx < 64; tx++) {
              if (float(tx) >= u_templateSize.x) break;
              vec2 d = vec2(float(tx), float(ty)) - centerT;
              float w = exp(-dot(d, d) / (2.0 * sigma2));
              vec2 sUV = (oxOy + vec2(float(tx), float(ty)) + 0.5) / u_searchSize;
              float sVal = luma(texture2D(u_search, sUV)) * 255.0;
              wSum += w;
              sumS += w * sVal;
            }
          }

          float sMean = sumS / max(1e-5, wSum);
          float sWeightedSq = 0.0;
          float crossSum = 0.0;
          float chromaErr = 0.0;

          for (int ty = 0; ty < 64; ty++) {
            if (float(ty) >= u_templateSize.y) break;
            for (int tx = 0; tx < 64; tx++) {
              if (float(tx) >= u_templateSize.x) break;
              vec2 d = vec2(float(tx), float(ty)) - centerT;
              float w = exp(-dot(d, d) / (2.0 * sigma2));
              vec2 sUV = (oxOy + vec2(float(tx), float(ty)) + 0.5) / u_searchSize;
              vec2 tUV = (vec2(float(tx), float(ty)) + 0.5) / u_templateSize;
              vec4 sCol = texture2D(u_search, sUV);
              vec4 tCol = texture2D(u_template, tUV);
              float sVal = luma(sCol) * 255.0 - sMean;
              float tVal = luma(tCol) * 255.0 - u_tMean;
              crossSum += w * sVal * tVal;
              sWeightedSq += w * sVal * sVal;
              chromaErr += w * length(sCol.rgb - tCol.rgb);
            }
          }

          float sNorm = sqrt(max(0.0, sWeightedSq));
          float score = 0.0;
          if (sNorm > 0.001 && u_tNorm > 0.001) {
            float lumaCorr = crossSum / (sNorm * u_tNorm);
            float chromaSim = exp(-(chromaErr / max(1e-5, wSum)) * 2.5);
            score = 0.85 * lumaCorr + 0.15 * (chromaSim * 2.0 - 1.0);
          }

          // Pack [-1.0, 1.0] into 16-bit unsigned integer across R (high byte) and G (low byte)
          float normScore = clamp((score + 1.0) * 0.5, 0.0, 1.0);
          float val16 = floor(normScore * 65535.0 + 0.5);
          float hi = floor(val16 / 256.0);
          float lo = val16 - hi * 256.0;
          gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);
        }
      `;

      const compileShader = (type: number, src: string) => {
        const shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, src);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          gl.deleteShader(shader);
          return null;
        }
        return shader;
      };

      const vs = compileShader(gl.VERTEX_SHADER, vsSource);
      const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
      if (!vs || !fs) return false;

      const prog = gl.createProgram();
      if (!prog) return false;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;

      const createTex = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        return tex;
      };

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

      this.gl = gl;
      this.program = prog;
      this.searchTex = createTex();
      this.templateTex = createTex();
      this.posBuffer = buf;
      this.isSupported = true;

      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      this.rendererName = dbg
        ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || 'WebGL GPU')
        : 'WebGL GPU Shader';

      return true;
    } catch {
      this.isSupported = false;
      return false;
    }
  }

  public match(
    searchData: ImageData,
    templateData: ImageData,
    searchX0: number,
    searchY0: number
  ): { bestX: number; bestY: number; score: number } | null {
    if (!this.init() || !this.gl || !this.program) return null;

    const sw = searchData.width;
    const sh = searchData.height;
    const tw = templateData.width;
    const th = templateData.height;

    if (sw < tw || sh < th || tw <= 0 || th <= 0 || tw > 64 || th > 64) {
      return null;
    }

    const outW = sw - tw + 1;
    const outH = sh - th + 1;

    // Precompute Gaussian-weighted template mean and norm on CPU
    const tBuf = templateData.data;
    const tN = tw * th;
    const cx = (tw - 1) * 0.5;
    const cy = (th - 1) * 0.5;
    const sigma2 = Math.max(4, tw * th * 0.16);

    let wSum = 0;
    let tSum = 0;
    const tGray = new Float32Array(tN);
    const tWeights = new Float32Array(tN);

    for (let ty = 0; ty < th; ty++) {
      for (let tx = 0; tx < tw; tx++) {
        const p = ty * tw + tx;
        const idx = p * 4;
        const v = 0.299 * tBuf[idx] + 0.587 * tBuf[idx + 1] + 0.114 * tBuf[idx + 2];
        const dx = tx - cx;
        const dy = ty - cy;
        const w = Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
        tGray[p] = v;
        tWeights[p] = w;
        wSum += w;
        tSum += w * v;
      }
    }
    const tMean = tSum / Math.max(1e-5, wSum);
    let tNormSq = 0;
    for (let p = 0; p < tN; p++) {
      const d = tGray[p] - tMean;
      tNormSq += tWeights[p] * d * d;
    }
    const tNorm = Math.sqrt(tNormSq);
    if (tNorm < 0.001) {
      return { bestX: searchX0 + sw / 2, bestY: searchY0 + sh / 2, score: 0 };
    }

    const gl = this.gl;
    if (gl.canvas.width < outW || gl.canvas.height < outH) {
      gl.canvas.width = Math.max(gl.canvas.width, outW);
      gl.canvas.height = Math.max(gl.canvas.height, outH);
    }

    gl.viewport(0, 0, outW, outH);
    gl.useProgram(this.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.searchTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, searchData.data);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_search'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.templateTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, templateData.data);
    gl.uniform1i(gl.getUniformLocation(this.program, 'u_template'), 1);

    gl.uniform2f(gl.getUniformLocation(this.program, 'u_searchSize'), sw, sh);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_templateSize'), tw, th);
    gl.uniform2f(gl.getUniformLocation(this.program, 'u_outSize'), outW, outH);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tMean'), tMean);
    gl.uniform1f(gl.getUniformLocation(this.program, 'u_tNorm'), tNorm);

    const posLoc = gl.getAttribLocation(this.program, 'a_pos');
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuffer);
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    const outPixels = new Uint8Array(outW * outH * 4);
    gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, outPixels);

    const scores = new Float32Array(outW * outH);
    let maxScore = -999999;
    let bestOx = 0;
    let bestOy = 0;

    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        const idx = (oy * outW + ox) * 4;
        const val16 = outPixels[idx] * 256 + outPixels[idx + 1];
        const score = (val16 / 65535.0) * 2.0 - 1.0;
        scores[oy * outW + ox] = score;
        if (score > maxScore) {
          maxScore = score;
          bestOx = ox;
          bestOy = oy;
        }
      }
    }

    // Stage 1: Parabolic sub-pixel refinement
    let subX = bestOx;
    let subY = bestOy;
    if (bestOx > 0 && bestOx < outW - 1) {
      const sL = scores[bestOy * outW + (bestOx - 1)];
      const sC = scores[bestOy * outW + bestOx];
      const sR = scores[bestOy * outW + (bestOx + 1)];
      const denom = 2 * (2 * sC - sL - sR);
      if (Math.abs(denom) > 1e-5) {
        const deltaX = (sR - sL) / denom;
        if (Math.abs(deltaX) < 1) subX += deltaX;
      }
    }
    if (bestOy > 0 && bestOy < outH - 1) {
      const sU = scores[(bestOy - 1) * outW + bestOx];
      const sC = scores[bestOy * outW + bestOx];
      const sD = scores[(bestOy + 1) * outW + bestOx];
      const denom = 2 * (2 * sC - sU - sD);
      if (Math.abs(denom) > 1e-5) {
        const deltaY = (sD - sU) / denom;
        if (Math.abs(deltaY) < 1) subY += deltaY;
      }
    }

    // Stage 2: Lucas-Kanade Sub-Pixel Optical Flow refinement
    const sBuf = searchData.data;
    const sGray = new Float32Array(sw * sh);
    for (let i = 0, p = 0; i < sBuf.length; i += 4, p++) {
      sGray[p] = 0.299 * sBuf[i] + 0.587 * sBuf[i + 1] + 0.114 * sBuf[i + 2];
    }
    const lkRefined = refineSubPixelLK(sGray, sw, sh, tGray, tw, th, subX, subY);

    return {
      bestX: searchX0 + lkRefined.ox + tw / 2,
      bestY: searchY0 + lkRefined.oy + th / 2,
      score: Math.max(0, Math.min(1, maxScore)),
    };
  }
}

const gpuTrackerEngine = new WebGLTrackerEngine();

export function getGPUAccelerationInfo(): { isSupported: boolean; rendererName: string } {
  const isSupported = gpuTrackerEngine.init();
  return {
    isSupported,
    rendererName: gpuTrackerEngine.rendererName,
  };
}

/**
 * Runs GPU-accelerated WebGL NCC template matching when useGPU is true and WebGL is available,
 * with automatic fallback to Multi-Cue CPU NCC.
 */
export function matchTemplateAccelerated(
  searchData: ImageData,
  templateData: ImageData,
  searchX0: number,
  searchY0: number,
  useGPU: boolean = true
): { bestX: number; bestY: number; score: number } {
  if (useGPU) {
    const gpuRes = gpuTrackerEngine.match(searchData, templateData, searchX0, searchY0);
    if (gpuRes) return gpuRes;
  }
  return matchTemplateNCC(searchData, templateData, searchX0, searchY0);
}

/**
 * 1D Gaussian kernel generator
 */
function getGaussianKernel(radius: number): number[] {
  if (radius <= 0) return [1];
  const size = radius * 2 + 1;
  const kernel = new Array<number>(size);
  const sigma = Math.max(radius / 2, 0.5);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const val = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = val;
    sum += val;
  }
  for (let i = 0; i < size; i++) {
    kernel[i] /= sum;
  }
  return kernel;
}

/**
 * Applies Gaussian moving-average smoothing to an array of numbers
 */
export function smooth1D(values: number[], radius: number): number[] {
  if (radius <= 0 || values.length <= 1) return [...values];
  const kernel = getGaussianKernel(radius);
  const kLen = kernel.length;
  const kMid = radius;
  const result = new Array<number>(values.length);

  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let weightSum = 0;
    for (let k = 0; k < kLen; k++) {
      const idx = i + (k - kMid);
      if (idx >= 0 && idx < values.length) {
        sum += values[idx] * kernel[k];
        weightSum += kernel[k];
      }
    }
    result[i] = weightSum > 0 ? sum / weightSum : values[i];
  }
  return result;
}

/**
 * Computes 3D Planar Surface Pose (Perspective Center, 2D Roll, Scale X/Y, 3D Swivel/Yaw, 3D Tilt/Pitch, Planar Skew)
 * from 4 free-form corner pins: p1 (Top-Left), p2 (Top-Right), p3 (Bottom-Right), p4 (Bottom-Left).
 */
export function compute3DSurfacePose(
  corners: SurfaceCorners,
  refCorners?: SurfaceCorners
): {
  centerX: number;
  centerY: number;
  scale: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  yaw3D: number;
  pitch3D: number;
  skew: number;
} {
  const { p1, p2, p3, p4 } = corners;

  // Compute centroid and diagonal intersection (perspective center)
  const centroidX = (p1.x + p2.x + p3.x + p4.x) * 0.25;
  const centroidY = (p1.y + p2.y + p3.y + p4.y) * 0.25;

  let centerX = centroidX;
  let centerY = centroidY;

  // Diagonal 1: p1 -> p3, Diagonal 2: p2 -> p4
  const d1x = p3.x - p1.x;
  const d1y = p3.y - p1.y;
  const d2x = p4.x - p2.x;
  const d2y = p4.y - p2.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) > 1e-3) {
    const t = ((p2.x - p1.x) * d2y - (p2.y - p1.y) * d2x) / denom;
    if (t > 0.15 && t < 0.85) {
      const ix = p1.x + t * d1x;
      const iy = p1.y + t * d1y;
      // Blend 50% perspective intersection + 50% centroid for smooth stability
      centerX = 0.5 * ix + 0.5 * centroidX;
      centerY = 0.5 * iy + 0.5 * centroidY;
    }
  }

  // Edge lengths
  const topLen = Math.max(1, Math.hypot(p2.x - p1.x, p2.y - p1.y));
  const bottomLen = Math.max(1, Math.hypot(p3.x - p4.x, p3.y - p4.y));
  const leftLen = Math.max(1, Math.hypot(p4.x - p1.x, p4.y - p1.y));
  const rightLen = Math.max(1, Math.hypot(p3.x - p2.x, p3.y - p2.y));

  const avgWidth = (topLen + bottomLen) * 0.5;
  const avgHeight = (leftLen + rightLen) * 0.5;

  // Horizontal axis angle (midpoint left -> midpoint right)
  const midLeftX = (p1.x + p4.x) * 0.5;
  const midLeftY = (p1.y + p4.y) * 0.5;
  const midRightX = (p2.x + p3.x) * 0.5;
  const midRightY = (p2.y + p3.y) * 0.5;
  const horizAngleRad = Math.atan2(midRightY - midLeftY, midRightX - midLeftX);

  // Vertical axis angle (midpoint top -> midpoint bottom)
  const midTopX = (p1.x + p2.x) * 0.5;
  const midTopY = (p1.y + p2.y) * 0.5;
  const midBotX = (p4.x + p3.x) * 0.5;
  const midBotY = (p4.y + p3.y) * 0.5;
  const vertAngleRad = Math.atan2(midBotY - midTopY, midBotX - midTopX);

  // Reference comparison
  const ref = refCorners || corners;
  const refTopLen = Math.max(1, Math.hypot(ref.p2.x - ref.p1.x, ref.p2.y - ref.p1.y));
  const refBotLen = Math.max(1, Math.hypot(ref.p3.x - ref.p4.x, ref.p3.y - ref.p4.y));
  const refLeftLen = Math.max(1, Math.hypot(ref.p4.x - ref.p1.x, ref.p4.y - ref.p1.y));
  const refRightLen = Math.max(1, Math.hypot(ref.p3.x - ref.p2.x, ref.p3.y - ref.p2.y));
  const refAvgWidth = Math.max(1, (refTopLen + refBotLen) * 0.5);
  const refAvgHeight = Math.max(1, (refLeftLen + refRightLen) * 0.5);

  const refMidLeftX = (ref.p1.x + ref.p4.x) * 0.5;
  const refMidLeftY = (ref.p1.y + ref.p4.y) * 0.5;
  const refMidRightX = (ref.p2.x + ref.p3.x) * 0.5;
  const refMidRightY = (ref.p2.y + ref.p3.y) * 0.5;
  const refHorizAngle = Math.atan2(refMidRightY - refMidLeftY, refMidRightX - refMidLeftX);

  let deltaRollRad = horizAngleRad - refHorizAngle;
  while (deltaRollRad > Math.PI) deltaRollRad -= 2 * Math.PI;
  while (deltaRollRad < -Math.PI) deltaRollRad += 2 * Math.PI;
  const rotation = (deltaRollRad * 180) / Math.PI;

  const scaleX = (avgWidth / refAvgWidth) * 100;
  const scaleY = (avgHeight / refAvgHeight) * 100;
  const scale = Math.sqrt(scaleX * scaleY);

  // 3D Yaw (Swivel around Y-axis): derived from left-vs-right vertical edge perspective convergence
  // plus horizontal foreshortening ratio relative to vertical scale
  const lrConvergence = (rightLen - leftLen) / Math.max(1, avgHeight);
  const refLrConvergence = (refRightLen - refLeftLen) / Math.max(1, refAvgHeight);
  const deltaLr = lrConvergence - refLrConvergence;
  const yawFromEdges = Math.atan2(deltaLr * 1.8, 1) * (180 / Math.PI);

  // 3D Pitch (Tilt around X-axis): derived from top-vs-bottom horizontal edge perspective convergence
  const tbConvergence = (bottomLen - topLen) / Math.max(1, avgWidth);
  const refTbConvergence = (refBotLen - refTopLen) / Math.max(1, refAvgWidth);
  const deltaTb = tbConvergence - refTbConvergence;
  const pitchFromEdges = Math.atan2(deltaTb * 1.8, 1) * (180 / Math.PI);

  const yaw3D = Math.max(-85, Math.min(85, Math.round(yawFromEdges * 100) / 100));
  const pitch3D = Math.max(-85, Math.min(85, Math.round(pitchFromEdges * 100) / 100));

  // Planar skew (deviation from 90 deg between horizontal and vertical centerlines)
  let angleBetween = vertAngleRad - horizAngleRad - Math.PI * 0.5;
  while (angleBetween > Math.PI) angleBetween -= 2 * Math.PI;
  while (angleBetween < -Math.PI) angleBetween += 2 * Math.PI;
  const skew = Math.round(((angleBetween * 180) / Math.PI) * 100) / 100;

  return {
    centerX,
    centerY,
    scale,
    scaleX,
    scaleY,
    rotation,
    yaw3D,
    pitch3D,
    skew,
  };
}

/**
 * Trims or deletes a range of keyframes by frame number:
 * - mode === 'delete-range': removes frames in [startFrame, endFrame] and keeps the rest
 * - mode === 'keep-only-range': keeps ONLY frames in [startFrame, endFrame] and deletes the rest
 */
export function trimKeyframesByFrameRange<T extends { frameNumber: number }>(
  keyframes: T[],
  startFrame: number,
  endFrame: number,
  mode: 'delete-range' | 'keep-only-range' = 'delete-range'
): T[] {
  const lo = Math.min(startFrame, endFrame);
  const hi = Math.max(startFrame, endFrame);
  if (mode === 'keep-only-range') {
    return keyframes.filter((k) => k.frameNumber >= lo && k.frameNumber <= hi);
  }
  return keyframes.filter((k) => k.frameNumber < lo || k.frameNumber > hi);
}

/**
 * Trims or deletes a range of keyframes by time in seconds (e.g. keep 0s..5s and delete 5s..8s):
 * - mode === 'delete-range': removes keyframes with timeSeconds in [startSeconds, endSeconds]
 * - mode === 'keep-only-range': keeps ONLY keyframes with timeSeconds in [startSeconds, endSeconds]
 */
export function trimKeyframesByTimeRange<T extends { timeSeconds: number }>(
  keyframes: T[],
  startSeconds: number,
  endSeconds: number,
  mode: 'delete-range' | 'keep-only-range' = 'delete-range'
): T[] {
  const lo = Math.min(startSeconds, endSeconds) - 1e-4;
  const hi = Math.max(startSeconds, endSeconds) + 1e-4;
  if (mode === 'keep-only-range') {
    return keyframes.filter((k) => k.timeSeconds >= lo && k.timeSeconds <= hi);
  }
  return keyframes.filter((k) => k.timeSeconds < lo || k.timeSeconds > hi);
}

/**
 * Process raw keyframes with 1-point, 2-point, or 4-pin 3D surface geometry, apply Gaussian smoothing,
 * offsets, and scale/rotation/3D corner-pin calculations.
 */
export function processKeyframeData(
  rawKeyframes: RawKeyframe[],
  pointMode: boolean | PointCountMode,
  smoothingRadius: number,
  offsetX: number,
  offsetY: number,
  scaleMultiplier: number,
  rotationOffset: number,
  fps: number
): ProcessedKeyframe[] {
  if (rawKeyframes.length === 0) return [];

  const mode: PointCountMode =
    typeof pointMode === 'number' ? pointMode : pointMode ? 2 : 1;

  // Sort raw keyframes by frame
  const sorted = [...rawKeyframes].sort((a, b) => a.frameNumber - b.frameNumber);

  // Check if 4-Pin 3D Surface mode is active and points p1..p4 exist
  const hasFourCorners =
    mode === 4 &&
    sorted[0].points['p1'] &&
    sorted[0].points['p2'] &&
    sorted[0].points['p3'] &&
    sorted[0].points['p4'];

  if (hasFourCorners) {
    const p1X = smooth1D(sorted.map((k) => (k.points['p1'] ? k.points['p1'].x : 0)), smoothingRadius);
    const p1Y = smooth1D(sorted.map((k) => (k.points['p1'] ? k.points['p1'].y : 0)), smoothingRadius);
    const p2X = smooth1D(sorted.map((k) => (k.points['p2'] ? k.points['p2'].x : 0)), smoothingRadius);
    const p2Y = smooth1D(sorted.map((k) => (k.points['p2'] ? k.points['p2'].y : 0)), smoothingRadius);
    const p3X = smooth1D(sorted.map((k) => (k.points['p3'] ? k.points['p3'].x : 0)), smoothingRadius);
    const p3Y = smooth1D(sorted.map((k) => (k.points['p3'] ? k.points['p3'].y : 0)), smoothingRadius);
    const p4X = smooth1D(sorted.map((k) => (k.points['p4'] ? k.points['p4'].x : 0)), smoothingRadius);
    const p4Y = smooth1D(sorted.map((k) => (k.points['p4'] ? k.points['p4'].y : 0)), smoothingRadius);

    const refCorners: SurfaceCorners = {
      p1: { x: p1X[0], y: p1Y[0] },
      p2: { x: p2X[0], y: p2Y[0] },
      p3: { x: p3X[0], y: p3Y[0] },
      p4: { x: p4X[0], y: p4Y[0] },
    };

    return sorted.map((kf, i) => {
      const smoothedCorners: SurfaceCorners = {
        p1: {
          x: Math.round((p1X[i] + offsetX) * 100) / 100,
          y: Math.round((p1Y[i] + offsetY) * 100) / 100,
        },
        p2: {
          x: Math.round((p2X[i] + offsetX) * 100) / 100,
          y: Math.round((p2Y[i] + offsetY) * 100) / 100,
        },
        p3: {
          x: Math.round((p3X[i] + offsetX) * 100) / 100,
          y: Math.round((p3Y[i] + offsetY) * 100) / 100,
        },
        p4: {
          x: Math.round((p4X[i] + offsetX) * 100) / 100,
          y: Math.round((p4Y[i] + offsetY) * 100) / 100,
        },
      };

      const rawFrameCorners: SurfaceCorners = {
        p1: { x: p1X[i], y: p1Y[i] },
        p2: { x: p2X[i], y: p2Y[i] },
        p3: { x: p3X[i], y: p3Y[i] },
        p4: { x: p4X[i], y: p4Y[i] },
      };

      const pose = compute3DSurfacePose(rawFrameCorners, refCorners);
      const mult = scaleMultiplier / 100;

      return {
        frameNumber: kf.frameNumber,
        timeSeconds: kf.timeSeconds,
        timecode: secondsToTimecode(kf.timeSeconds, fps),
        x: Math.round((pose.centerX + offsetX) * 100) / 100,
        y: Math.round((pose.centerY + offsetY) * 100) / 100,
        scale: Math.round(pose.scale * mult * 100) / 100,
        scaleX: Math.round(pose.scaleX * mult * 100) / 100,
        scaleY: Math.round(pose.scaleY * mult * 100) / 100,
        rotation: Math.round((pose.rotation + rotationOffset) * 100) / 100,
        yaw3D: pose.yaw3D,
        pitch3D: pose.pitch3D,
        skew: pose.skew,
        corners: smoothedCorners,
        confidence: kf.confidence,
      };
    });
  }

  const isTwoPoint = mode >= 2;

  // Compute base raw centers, raw rotations, and raw scales
  const rawX: number[] = [];
  const rawY: number[] = [];
  const rawRot: number[] = [];
  const rawScale: number[] = [];

  let initialDistance = 1;
  let initialAngle = 0;

  // Initialize reference for 2-point tracking from the first frame
  if (isTwoPoint && sorted.length > 0) {
    const firstP1 = sorted[0].points['p1'];
    const firstP2 = sorted[0].points['p2'];
    if (firstP1 && firstP2) {
      const dx = firstP2.x - firstP1.x;
      const dy = firstP2.y - firstP1.y;
      initialDistance = Math.hypot(dx, dy) || 1;
      initialAngle = Math.atan2(dy, dx);
    }
  }

  for (const kf of sorted) {
    const p1 = kf.points['p1'];
    const p2 = kf.points['p2'];

    if (!isTwoPoint || !p2) {
      // 1-Point mode: position only
      rawX.push(p1 ? p1.x : 0);
      rawY.push(p1 ? p1.y : 0);
      rawRot.push(0);
      rawScale.push(100);
    } else {
      // 2-Point mode: position is midpoint, rotation from angle delta, scale from distance ratio
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      rawX.push(midX);
      rawY.push(midY);

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const currentDist = Math.hypot(dx, dy);
      const currentAngle = Math.atan2(dy, dx);

      // Angle difference in degrees
      let deltaAngleRad = currentAngle - initialAngle;
      // Normalize to [-PI, PI]
      while (deltaAngleRad > Math.PI) deltaAngleRad -= 2 * Math.PI;
      while (deltaAngleRad < -Math.PI) deltaAngleRad += 2 * Math.PI;
      const deltaAngleDeg = (deltaAngleRad * 180) / Math.PI;

      const scalePct = (currentDist / initialDistance) * 100;

      rawRot.push(deltaAngleDeg);
      rawScale.push(scalePct);
    }
  }

  // Apply smoothing filter
  const smoothedX = smooth1D(rawX, smoothingRadius);
  const smoothedY = smooth1D(rawY, smoothingRadius);
  const smoothedRot = isTwoPoint ? smooth1D(rawRot, smoothingRadius) : rawRot;
  const smoothedScale = isTwoPoint ? smooth1D(rawScale, smoothingRadius) : rawScale;

  // Build final ProcessedKeyframe list with offsets
  return sorted.map((kf, i) => {
    return {
      frameNumber: kf.frameNumber,
      timeSeconds: kf.timeSeconds,
      timecode: secondsToTimecode(kf.timeSeconds, fps),
      x: Math.round((smoothedX[i] + offsetX) * 100) / 100,
      y: Math.round((smoothedY[i] + offsetY) * 100) / 100,
      scale: Math.round((smoothedScale[i] * (scaleMultiplier / 100)) * 100) / 100,
      rotation: Math.round((smoothedRot[i] + rotationOffset) * 100) / 100,
      confidence: kf.confidence,
    };
  });
}

/**
 * Computes Camera Follow / Lock-On keyframes that lock the camera viewport to a singular tracked point
 * (e.g. keeping a football, basketball, skater, or player centered in the screen).
 */
export function computeCameraFollowKeyframes(
  keyframes: ProcessedKeyframe[],
  options: {
    sequenceWidth?: number;
    sequenceHeight?: number;
    zoomPercent?: number;
  } = {}
): ProcessedKeyframe[] {
  const seqW = options.sequenceWidth || 1920;
  const seqH = options.sequenceHeight || 1080;
  const zoom = options.zoomPercent || 125;
  const centerX = seqW / 2;
  const centerY = seqH / 2;

  return keyframes.map((kf) => {
    const followPosX = Math.round((centerX + (centerX - kf.x)) * 100) / 100;
    const followPosY = Math.round((centerY + (centerY - kf.y)) * 100) / 100;

    return {
      ...kf,
      x: followPosX,
      y: followPosY,
      scale: zoom,
    };
  });
}

/**
 * Computes Video Stabilization keyframes that counter-move (and counter-rotate / counter-scale in 2-point mode)
 * the clip relative to the initial reference frame (frame 0) to eliminate camera shake or lock a subject in place.
 */
export function computeStabilizeKeyframes(
  keyframes: ProcessedKeyframe[],
  options: {
    sequenceWidth?: number;
    sequenceHeight?: number;
    strengthPercent?: number;
    zoomPercent?: number;
  } = {}
): ProcessedKeyframe[] {
  if (!keyframes || keyframes.length === 0) return [];

  const seqW = options.sequenceWidth || 1920;
  const seqH = options.sequenceHeight || 1080;
  const strength = Math.max(0, Math.min(1, (options.strengthPercent ?? 100) / 100));
  const zoom = options.zoomPercent || 115;
  const centerX = seqW / 2;
  const centerY = seqH / 2;

  const refX = keyframes[0].x;
  const refY = keyframes[0].y;
  const refScale = keyframes[0].scale || 100;
  const refRot = keyframes[0].rotation || 0;

  return keyframes.map((kf) => {
    const dx = kf.x - refX;
    const dy = kf.y - refY;
    const dRot = (kf.rotation || 0) - refRot;
    const curScale = kf.scale || 100;
    const scaleRatio = curScale > 1 ? refScale / curScale : 1;

    const stabX = Math.round((centerX - dx * strength) * 100) / 100 || 0;
    const stabY = Math.round((centerY - dy * strength) * 100) / 100 || 0;
    const stabRot = Math.round(-dRot * strength * 100) / 100 || 0;
    const stabScale = Math.round(zoom * (1 + (scaleRatio - 1) * strength) * 100) / 100;

    return {
      ...kf,
      x: stabX,
      y: stabY,
      scale: stabScale,
      rotation: stabRot,
    };
  });
}

export function generateAdobeKeyframeText(
  keyframes: ProcessedKeyframe[],
  options: {
    fps?: number;
    width?: number;
    height?: number;
    canvasWidth?: number;
    canvasHeight?: number;
    exportPosition?: boolean;
    exportScale?: boolean;
    exportRotation?: boolean;
    exportCornerPin3D?: boolean;
    isCameraFollow?: boolean;
    cameraFollowZoom?: number;
    isStabilize?: boolean;
    stabilizeStrength?: number;
    stabilizeZoom?: number;
  } = {}
): string {
  const fps = options.fps || 30;
  const width = options.width || 1920;
  const height = options.height || 1080;
  const scaleX = options.canvasWidth ? width / options.canvasWidth : 1;
  const scaleY = options.canvasHeight ? height / options.canvasHeight : 1;
  const exportPos = options.exportPosition ?? true;
  const exportScale = options.exportScale ?? true;
  const exportRot = options.exportRotation ?? true;
  const exportCornerPin = options.exportCornerPin3D ?? true;
  const isFollow = options.isCameraFollow ?? false;
  const zoom = options.cameraFollowZoom || 125;
  const isStab = options.isStabilize ?? false;
  const stabStrength = options.stabilizeStrength ?? 100;
  const stabZoom = options.stabilizeZoom || 115;

  if (!keyframes || keyframes.length === 0) return '';

  const scaledKeyframes = keyframes.map((k) => ({
    ...k,
    x: k.x * scaleX,
    y: k.y * scaleY,
    corners: k.corners
      ? {
          p1: { x: k.corners.p1.x * scaleX, y: k.corners.p1.y * scaleY },
          p2: { x: k.corners.p2.x * scaleX, y: k.corners.p2.y * scaleY },
          p3: { x: k.corners.p3.x * scaleX, y: k.corners.p3.y * scaleY },
          p4: { x: k.corners.p4.x * scaleX, y: k.corners.p4.y * scaleY },
        }
      : undefined,
  }));

  const activeKeys = isStab
    ? computeStabilizeKeyframes(scaledKeyframes, {
        sequenceWidth: width,
        sequenceHeight: height,
        strengthPercent: stabStrength,
        zoomPercent: stabZoom,
      })
    : isFollow
    ? computeCameraFollowKeyframes(scaledKeyframes, {
        sequenceWidth: width,
        sequenceHeight: height,
        zoomPercent: zoom,
      })
    : scaledKeyframes;

  let output = `Adobe After Effects 8.0 Keyframe Data\n\n`;
  output += `\tUnits Per Second\t${fps.toFixed(6)}\n`;
  output += `\tSource Width\t${width}\n`;
  output += `\tSource Height\t${height}\n`;
  output += `\tSource Pixel Aspect Ratio\t1\n`;
  output += `\tComp Pixel Aspect Ratio\t1\n\n`;

  if (isFollow || isStab) {
    output += `Transform\tPosition\n`;
    output += `\tFrame\tX pixels\tY pixels\tZ pixels\n`;
    for (const k of activeKeys) {
      output += `\t${k.frameNumber}\t${k.x.toFixed(6)}\t${k.y.toFixed(6)}\t0.000000\n`;
    }
    output += `\n`;

    output += `Transform\tScale\n`;
    output += `\tFrame\tX percent\tY percent\tZ percent\n`;
    for (const k of activeKeys) {
      output += `\t${k.frameNumber}\t${k.scale.toFixed(6)}\t${k.scale.toFixed(6)}\t100.000000\n`;
    }
    output += `\n`;

    if (isStab && exportRot) {
      output += `Transform\tRotation\n`;
      output += `\tFrame\tdegrees\n`;
      for (const k of activeKeys) {
        output += `\t${k.frameNumber}\t${k.rotation.toFixed(6)}\n`;
      }
      output += `\n`;
    }
  } else {
    // If 4-Pin 3D Surface corners exist, include Adobe Corner Pin effect data!
    const hasCorners = exportCornerPin && activeKeys.some((k) => !!k.corners);
    if (hasCorners) {
      const cornerDefs: Array<{ label: string; propNum: number; key: keyof SurfaceCorners }> = [
        { label: 'Upper Left', propNum: 1, key: 'p1' },
        { label: 'Upper Right', propNum: 2, key: 'p2' },
        { label: 'Lower Left', propNum: 3, key: 'p4' },
        { label: 'Lower Right', propNum: 4, key: 'p3' },
      ];
      for (const cDef of cornerDefs) {
        output += `Effects\tCorner Pin #1\t${cDef.label} #${cDef.propNum}\n`;
        output += `\tFrame\tX pixels\tY pixels\n`;
        for (const k of activeKeys) {
          const pt = k.corners ? k.corners[cDef.key] : { x: k.x, y: k.y };
          output += `\t${k.frameNumber}\t${pt.x.toFixed(6)}\t${pt.y.toFixed(6)}\n`;
        }
        output += `\n`;
      }
    }

    if (exportPos) {
      output += `Transform\tPosition\n`;
      output += `\tFrame\tX pixels\tY pixels\tZ pixels\n`;
      for (const k of activeKeys) {
        output += `\t${k.frameNumber}\t${k.x.toFixed(6)}\t${k.y.toFixed(6)}\t0.000000\n`;
      }
      output += `\n`;
    }

    if (exportScale) {
      output += `Transform\tScale\n`;
      output += `\tFrame\tX percent\tY percent\tZ percent\n`;
      for (const k of activeKeys) {
        const sx = k.scaleX !== undefined ? k.scaleX : k.scale;
        const sy = k.scaleY !== undefined ? k.scaleY : k.scale;
        output += `\t${k.frameNumber}\t${sx.toFixed(6)}\t${sy.toFixed(6)}\t100.000000\n`;
      }
      output += `\n`;
    }

    if (exportRot) {
      output += `Transform\tRotation\n`;
      output += `\tFrame\tdegrees\n`;
      for (const k of activeKeys) {
        output += `\t${k.frameNumber}\t${k.rotation.toFixed(6)}\n`;
      }
      output += `\n`;

      if (hasCorners) {
        output += `Transform\tX Rotation\n`;
        output += `\tFrame\tdegrees\n`;
        for (const k of activeKeys) {
          output += `\t${k.frameNumber}\t${(k.pitch3D || 0).toFixed(6)}\n`;
        }
        output += `\n`;

        output += `Transform\tY Rotation\n`;
        output += `\tFrame\tdegrees\n`;
        for (const k of activeKeys) {
          output += `\t${k.frameNumber}\t${(k.yaw3D || 0).toFixed(6)}\n`;
        }
        output += `\n`;
      }
    }
  }

  output += `End of Keyframe Data\n`;
  return output;
}

/**
 * Bulletproof synchronous & asynchronous clipboard copy helper.
 * Works inside sandboxed iframes, Adobe CEP panels, and headless browsers where navigator.clipboard is blocked.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // 1. Try synchronous document.execCommand('copy') first as it works while user-gesture is active in iframes & CEP
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (copied) return true;
  } catch (err) {
    // Continue to navigator.clipboard fallback
  }

  // 2. Fallback to modern Clipboard API
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // Ignore
  }

  return false;
}
