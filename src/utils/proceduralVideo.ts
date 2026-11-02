/**
 * Generates dynamic sample videos using an offscreen canvas and MediaRecorder,
 * enabling immediate browser testing with realistic motion, rotation, and scale.
 */

export interface DemoPreset {
  id: string;
  name: string;
  description: string;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
}

export const DEMO_PRESETS: DemoPreset[] = [
  {
    id: 'cyberpunk-car',
    name: 'Sports Car on Highway',
    description: 'Moving sports car with high-contrast target marker, camera pan, and acceleration',
    durationSeconds: 5,
    fps: 30,
    width: 640,
    height: 360,
  },
  {
    id: 'surface-screen-3d',
    name: '3D Screen / Monitor (4-Pin)',
    description: 'Tilted 3D monitor screen rotating and shifting in perspective with 4 corner pins',
    durationSeconds: 6,
    fps: 30,
    width: 640,
    height: 360,
  },
  {
    id: 'drone-aerial',
    name: 'Drone Follow-Cam (Scale & Rotation)',
    description: 'Aerial target with 2 tracking points rotating and zooming',
    durationSeconds: 6,
    fps: 30,
    width: 640,
    height: 360,
  },
  {
    id: 'action-skater',
    name: 'Skateboard Helmet Tracking',
    description: 'Bouncing and weaving high-contrast helmet marker across urban ramps',
    durationSeconds: 4,
    fps: 30,
    width: 640,
    height: 360,
  },
];

export function getSurfacePresetCorners(t: number, width: number = 640, height: number = 360) {
  const cx = width * 0.5 + Math.sin(t * 1.3) * 58;
  const cy = height * 0.5 + Math.cos(t * 1.1) * 28;
  const yaw = 0.22 * Math.sin(t * 1.5); // 3D horizontal swivel
  const pitch = 0.16 * Math.cos(t * 1.2); // 3D vertical tilt
  const roll = 0.08 * Math.sin(t * 0.9);
  const halfW = 115;
  const halfH = 68;

  const projectCorner = (lx: number, ly: number) => {
    // 3D rotation around Y (yaw), X (pitch), Z (roll) + perspective divide
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    const cosX = Math.cos(pitch);
    const sinX = Math.sin(pitch);
    const cosZ = Math.cos(roll);
    const sinZ = Math.sin(roll);

    const x1 = lx * cosZ - ly * sinZ;
    const y1 = lx * sinZ + ly * cosZ;

    const x2 = x1 * cosY;
    const z2 = x1 * sinY;
    const y2 = y1 * cosX - z2 * sinX;
    const z3 = y1 * sinX + z2 * cosX;

    const fov = 460;
    const persp = fov / Math.max(120, fov + z3);
    return {
      x: cx + x2 * persp,
      y: cy + y2 * persp,
    };
  };

  return {
    p1: projectCorner(-halfW, -halfH), // Top-Left
    p2: projectCorner(halfW, -halfH),  // Top-Right
    p3: projectCorner(halfW, halfH),   // Bottom-Right
    p4: projectCorner(-halfW, halfH),  // Bottom-Left
  };
}

export async function generateDemoVideoBlob(preset: DemoPreset): Promise<{ url: string; duration: number }> {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = preset.width;
    canvas.height = preset.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      resolve({ url: '', duration: 0 });
      return;
    }

    const stream = canvas.captureStream(preset.fps);
    // Determine mimeType supported in current browser
    const mimeTypes = ['video/webm;codecs=vp9', 'video/webm', 'video/mp4'];
    let selectedMime = 'video/webm';
    for (const m of mimeTypes) {
      if (MediaRecorder.isTypeSupported(m)) {
        selectedMime = m;
        break;
      }
    }

    const recorder = new MediaRecorder(stream, { mimeType: selectedMime });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: selectedMime });
      const url = URL.createObjectURL(blob);
      resolve({ url, duration: preset.durationSeconds });
    };

    recorder.start();

    const totalFrames = preset.durationSeconds * preset.fps;
    let currentFrame = 0;

    const renderInterval = setInterval(() => {
      if (currentFrame >= totalFrames) {
        clearInterval(renderInterval);
        recorder.stop();
        return;
      }

      const t = currentFrame / preset.fps; // time in seconds
      renderFrame(ctx, preset, t, currentFrame, totalFrames);
      currentFrame++;
    }, 1000 / preset.fps);
  });
}

export function renderFrameToCanvas(
  ctx: CanvasRenderingContext2D,
  preset: DemoPreset,
  frame: number,
  totalFrames: number
) {
  const t = frame / preset.fps;
  renderFrame(ctx, preset, t, frame, totalFrames);
}

function renderFrame(
  ctx: CanvasRenderingContext2D,
  preset: DemoPreset,
  t: number,
  frame: number,
  totalFrames: number
) {
  const w = preset.width;
  const h = preset.height;

  // Background environment
  if (preset.id === 'cyberpunk-car') {
    // Dark asphalt road and grid
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#10141f');
    grad.addColorStop(0.6, '#181b26');
    grad.addColorStop(1, '#0c0e14');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Grid lines / perspective road
    ctx.strokeStyle = '#23293b';
    ctx.lineWidth = 1;
    for (let x = -w; x < w * 2; x += 40) {
      const scrollX = (x - (frame * 5) % 40);
      ctx.beginPath();
      ctx.moveTo(scrollX, h * 0.5);
      ctx.lineTo(scrollX * 1.5 - w * 0.25, h);
      ctx.stroke();
    }

    // Moving Car target with high-contrast tracker dots
    // Smooth parametric curve: moves from left (w*0.15) to right (w*0.8) with vertical sway
    const progress = (t / preset.durationSeconds);
    const carX = w * 0.15 + progress * (w * 0.65) + Math.sin(t * 3) * 15;
    const carY = h * 0.62 + Math.cos(t * 4) * 12;

    // Draw Car Body
    ctx.save();
    ctx.translate(carX, carY);

    // Car shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 32, 60, 14, 0, 0, Math.PI * 2);
    ctx.fill();

    // Sportscar chassis
    ctx.fillStyle = '#ff3366';
    ctx.beginPath();
    ctx.roundRect(-55, 0, 110, 26, [8, 14, 4, 4]);
    ctx.fill();

    // Cabin
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.roundRect(-25, -16, 50, 18, [6, 6, 0, 0]);
    ctx.fill();

    // High contrast neon yellow tracker target on the hood
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(32, 10, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(32, 10, 3, 0, Math.PI * 2);
    ctx.fill();

    // Wheels
    ctx.fillStyle = '#1f2937';
    ctx.beginPath();
    ctx.arc(-35, 24, 11, 0, Math.PI * 2);
    ctx.arc(35, 24, 11, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

  } else if (preset.id === 'surface-screen-3d') {
    // Studio desk environment
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0f172a');
    bgGrad.addColorStop(1, '#1e293b');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    const corners = getSurfacePresetCorners(t, w, h);
    const { p1, p2, p3, p4 } = corners;

    // Draw outer monitor bezel quad
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.lineTo(p4.x, p4.y);
    ctx.closePath();
    ctx.fillStyle = '#090d16';
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#334155';
    ctx.stroke();

    // Draw inner glowing screen surface quad
    ctx.fillStyle = '#1e3a8a';
    ctx.fill();

    // Draw perspective grid lines across screen surface
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.35)';
    ctx.lineWidth = 1.5;
    for (let u = 0.25; u <= 0.75; u += 0.25) {
      const topX = p1.x + (p2.x - p1.x) * u;
      const topY = p1.y + (p2.y - p1.y) * u;
      const botX = p4.x + (p3.x - p4.x) * u;
      const botY = p4.y + (p3.y - p4.y) * u;
      ctx.beginPath();
      ctx.moveTo(topX, topY);
      ctx.lineTo(botX, botY);
      ctx.stroke();

      const leftX = p1.x + (p4.x - p1.x) * u;
      const leftY = p1.y + (p4.y - p1.y) * u;
      const rightX = p2.x + (p3.x - p2.x) * u;
      const rightY = p2.y + (p3.y - p2.y) * u;
      ctx.beginPath();
      ctx.moveTo(leftX, leftY);
      ctx.lineTo(rightX, rightY);
      ctx.stroke();
    }

    // Draw 4 distinct high-contrast corner fiduciary targets (TL, TR, BR, BL) for optical flow
    const cornerDots = [
      { pt: p1, color: '#38bdf8' },
      { pt: p2, color: '#c084fc' },
      { pt: p3, color: '#34d399' },
      { pt: p4, color: '#fbbf24' },
    ];
    for (const c of cornerDots) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(c.pt.x, c.pt.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(c.pt.x, c.pt.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.arc(c.pt.x, c.pt.y, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

  } else if (preset.id === 'drone-aerial') {
    // Aerial water/landscape
    const grad = ctx.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, w);
    grad.addColorStop(0, '#0f3c57');
    grad.addColorStop(1, '#081d2a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Waves pattern
    ctx.strokeStyle = '#184f70';
    ctx.lineWidth = 1.5;
    for (let r = 20; r < w; r += 35) {
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, r + (frame % 35), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Drone target: rotating and zooming boat / landing pad
    const progress = t / preset.durationSeconds;
    const padX = w * 0.5 + Math.sin(t * 1.5) * 110;
    const padY = h * 0.5 + Math.cos(t * 1.2) * 60;
    const angle = t * 0.6; // rotation
    const scale = 1.0 + Math.sin(t * 2) * 0.35; // zoom in/out

    ctx.save();
    ctx.translate(padX, padY);
    ctx.rotate(angle);
    ctx.scale(scale, scale);

    // Pad body
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(0, 0, 36, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Point 1: Red Bullseye
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(-18, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-18, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    // Point 2: Blue Bullseye
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(18, 0, 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(18, 0, 3, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

  } else {
    // Action Skater
    ctx.fillStyle = '#1e1e24';
    ctx.fillRect(0, 0, w, h);

    // Ramp curves
    ctx.strokeStyle = '#383842';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, h * 0.8);
    ctx.quadraticCurveTo(w * 0.5, h * 0.95, w, h * 0.4);
    ctx.stroke();

    // Skater helmet bouncing across
    const progress = t / preset.durationSeconds;
    const skX = w * 0.1 + progress * (w * 0.8);
    const bounce = Math.abs(Math.sin(t * 5)) * 40;
    const skY = h * 0.65 - bounce;

    ctx.save();
    ctx.translate(skX, skY);

    // Helmet with high contrast cyan crosshair
    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Dark visor
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(-10, -4, 20, 8);

    ctx.restore();
  }

  // Visual Timecode Burn-in at bottom left
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(10, h - 28, 120, 20);
  ctx.fillStyle = '#a1a1aa';
  ctx.font = '11px monospace';
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n);
  const sec = Math.floor(t);
  const fr = frame % preset.fps;
  ctx.fillText(`TC 00:00:${pad(sec)}:${pad(fr)}`, 16, h - 14);

  // Frame counter badge top right
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(w - 95, 8, 85, 20);
  ctx.fillStyle = '#3ea6ff';
  ctx.font = '10px monospace';
  ctx.fillText(`FR ${frame + 1}/${totalFrames}`, w - 88, 22);
}
