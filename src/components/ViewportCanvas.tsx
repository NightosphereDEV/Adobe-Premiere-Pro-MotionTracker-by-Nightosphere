import React, { useRef, useEffect, useState, useCallback } from 'react';
import { TrackerPoint, RawKeyframe, ProcessedKeyframe, PointCountMode } from '../types/tracker';
import { secondsToTimecode, isSupportedVideoFile, compute3DSurfacePose } from '../utils/math';
import { ZoomIn, ZoomOut, Maximize2, Crosshair, UploadCloud, Search, Hand, Target, Box, Magnet, MoveUpRight } from 'lucide-react';

interface ViewportCanvasProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  cleanCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  points: { [id: string]: TrackerPoint };
  pointCountMode: PointCountMode;
  onUpdatePoint: (id: string, newCoords: { x: number; y: number }) => void;
  onMoveAllPoints?: (dx: number, dy: number) => void;
  onSnapToFeature?: (pointId?: string) => void;
  offsetX?: number;
  offsetY?: number;
  onUpdateOffset?: (offsetX: number, offsetY: number) => void;
  enableMotionBlur?: boolean;
  shutterAngle?: number;
  rawKeyframes: RawKeyframe[];
  processedKeyframes: ProcessedKeyframe[];
  currentFrame: number;
  totalFrames: number;
  currentTime: number;
  fps: number;
  isTracking: boolean;
  onDropVideoFile: (file: File) => void;
}

// Point-in-polygon check for 4-corner quad
function isPointInQuad(
  px: number,
  py: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number }
): boolean {
  const poly = [p1, p2, p3, p4];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export const ViewportCanvas: React.FC<ViewportCanvasProps> = ({
  videoRef,
  canvasRef,
  cleanCanvasRef,
  points,
  pointCountMode,
  onUpdatePoint,
  onMoveAllPoints,
  onSnapToFeature,
  offsetX = 0,
  offsetY = 0,
  onUpdateOffset,
  enableMotionBlur = false,
  shutterAngle = 180,
  rawKeyframes,
  processedKeyframes,
  currentFrame,
  totalFrames,
  currentTime,
  fps,
  isTracking,
  onDropVideoFile,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const loupeCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const [draggingPointId, setDraggingPointId] = useState<string | null>(null);
  const [isDraggingSurface, setIsDraggingSurface] = useState<boolean>(false);
  const [isDraggingOffset, setIsDraggingOffset] = useState<boolean>(false);
  const [showOffsetAnchor, setShowOffsetAnchor] = useState<boolean>(false);
  const surfaceDragPrevRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [panOffset, setPanOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanMode, setIsPanMode] = useState<boolean>(false);
  const [isPanning, setIsPanning] = useState<boolean>(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number }>({
    clientX: 0,
    clientY: 0,
    startX: 0,
    startY: 0,
  });

  const [showLoupe, setShowLoupe] = useState<boolean>(true);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const isSurfaceMode = pointCountMode === 4;
  const isTwoPoint = pointCountMode === 2;
  const isOffsetVisible = showOffsetAnchor || offsetX !== 0 || offsetY !== 0;

  // Redraw canvas with video frame and overlay graphics
  const renderOverlay = useCallback(() => {
    const canvas = canvasRef.current;
    const cleanCanvas = cleanCanvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;

    // Draw pristine video frame from clean canvas buffer if available
    if (cleanCanvas) {
      ctx.drawImage(cleanCanvas, 0, 0, w, h);
    } else if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, w, h);
    } else {
      const grad = ctx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, '#1c1c22');
      grad.addColorStop(1, '#111116');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      ctx.fillStyle = '#666';
      ctx.font = '13px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No Video Loaded — Click "Load Preset" or Drag & Drop MP4', w / 2, h / 2);
      ctx.textAlign = 'start';
    }

    // 1. Draw Raw Motion Path Trail (Cyan)
    if (rawKeyframes.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(62, 166, 255, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let first = true;
      for (const kf of rawKeyframes) {
        const pt = kf.points['p1'];
        if (pt) {
          if (first) {
            ctx.moveTo(pt.x, pt.y);
            first = false;
          } else {
            ctx.lineTo(pt.x, pt.y);
          }
        }
      }
      ctx.stroke();

      for (const kf of rawKeyframes) {
        const pt = kf.points['p1'];
        if (pt) {
          ctx.fillStyle = 'rgba(62, 166, 255, 0.7)';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 2. Draw Processed / Smoothed Motion Path Trail (Gold/Amber)
    if (processedKeyframes.length > 1) {
      ctx.save();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.5;
      ctx.shadowColor = 'rgba(245, 158, 11, 0.5)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      let first = true;
      for (const pkf of processedKeyframes) {
        if (first) {
          ctx.moveTo(pkf.x, pkf.y);
          first = false;
        } else {
          ctx.lineTo(pkf.x, pkf.y);
        }
      }
      ctx.stroke();

      const curPkf = processedKeyframes.find((k) => k.frameNumber === currentFrame);
      if (curPkf) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(curPkf.x, curPkf.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2.5 If 4-Pin 3D Surface Mode, draw Free-Edit Perspective Surface Mesh + 3D Orientation Gizmo
    if (isSurfaceMode && points['p1'] && points['p2'] && points['p3'] && points['p4']) {
      const p1 = points['p1'];
      const p2 = points['p2'];
      const p3 = points['p3'];
      const p4 = points['p4'];

      ctx.save();

      // Translucent 3D surface quad fill
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.fillStyle = isTracking ? 'rgba(16, 185, 129, 0.16)' : 'rgba(56, 189, 248, 0.14)';
      ctx.fill();

      // Bilinear perspective interior grid (4x4 subdivisions)
      ctx.strokeStyle = isTracking ? 'rgba(52, 211, 153, 0.45)' : 'rgba(56, 189, 248, 0.42)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 3; i++) {
        const u = i / 4;
        // Vertical perspective grid line (top edge to bottom edge)
        const tx = p1.x + (p2.x - p1.x) * u;
        const ty = p1.y + (p2.y - p1.y) * u;
        const bx = p4.x + (p3.x - p4.x) * u;
        const by = p4.y + (p3.y - p4.y) * u;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(bx, by);
        ctx.stroke();

        // Horizontal perspective grid line (left edge to right edge)
        const lx = p1.x + (p4.x - p1.x) * u;
        const ly = p1.y + (p4.y - p1.y) * u;
        const rx = p2.x + (p3.x - p2.x) * u;
        const ry = p2.y + (p3.y - p2.y) * u;
        ctx.beginPath();
        ctx.moveTo(lx, ly);
        ctx.lineTo(rx, ry);
        ctx.stroke();
      }

      // Outer 4-Pin Surface Boundary Quad
      ctx.strokeStyle = isTracking ? '#10b981' : '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.lineTo(p4.x, p4.y);
      ctx.closePath();
      ctx.stroke();

      // Compute 3D Surface Pose & draw 3D X/Y/Z Normal Axis Gizmo at perspective center
      const refKf0 = rawKeyframes.length > 0 && rawKeyframes[0].points['p4']
        ? {
            p1: rawKeyframes[0].points['p1'],
            p2: rawKeyframes[0].points['p2'],
            p3: rawKeyframes[0].points['p3'],
            p4: rawKeyframes[0].points['p4'],
          }
        : undefined;
      const pose = compute3DSurfacePose({ p1, p2, p3, p4 }, refKf0);
      const cx = pose.centerX;
      const cy = pose.centerY;

      // X-axis (Right along surface plane - Red)
      const midRightX = (p2.x + p3.x) * 0.5;
      const midRightY = (p2.y + p3.y) * 0.5;
      const xVecX = (midRightX - cx) * 0.42;
      const xVecY = (midRightY - cy) * 0.42;

      // Y-axis (Up along surface plane - Emerald)
      const midTopX = (p1.x + p2.x) * 0.5;
      const midTopY = (p1.y + p2.y) * 0.5;
      const yVecX = (midTopX - cx) * 0.42;
      const yVecY = (midTopY - cy) * 0.42;

      // Z-axis (3D Surface Normal pointing out of screen - Cyan)
      const zLen = 34;
      const yawRad = (pose.yaw3D * Math.PI) / 180;
      const pitchRad = (pose.pitch3D * Math.PI) / 180;
      const zVecX = Math.sin(yawRad) * zLen;
      const zVecY = -Math.sin(pitchRad) * zLen;

      // Draw X Axis
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + xVecX, cy + xVecY);
      ctx.stroke();

      // Draw Y Axis
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + yVecX, cy + yVecY);
      ctx.stroke();

      // Draw Z Normal Axis
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + zVecX, cy + zVecY);
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(cx + zVecX, cy + zVecY, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // Center Pivot Dot
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();

      // 3D Surface HUD Badge on Canvas
      const badgeText = `3D SURFACE • Yaw:${pose.yaw3D.toFixed(1)}° Pitch:${pose.pitch3D.toFixed(1)}° Roll:${pose.rotation.toFixed(1)}°`;
      ctx.font = '10px monospace';
      const tw = ctx.measureText(badgeText).width + 12;
      ctx.fillStyle = 'rgba(10, 15, 28, 0.85)';
      ctx.fillRect(10, 10, tw, 20);
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(10, 10, tw, 20);
      ctx.fillStyle = '#7dd3fc';
      ctx.fillText(badgeText, 16, 23);

      ctx.restore();
    }

    // 3. Draw Draggable Tracker Targets & Search Windows
    const activePoints = isSurfaceMode
      ? [points['p1'], points['p2'], points['p3'], points['p4']]
      : isTwoPoint
      ? [points['p1'], points['p2']]
      : [points['p1']];

    activePoints.forEach((pt) => {
      if (!pt) return;
      const x = pt.x;
      const y = pt.y;
      const fs = pt.featureSize;
      const ss = pt.searchSize;

      ctx.save();

      // Outer Search Box (Dashed)
      ctx.strokeStyle = isTracking ? '#22c55e' : pt.color;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(x - ss / 2, y - ss / 2, ss, ss);
      ctx.setLineDash([]);

      // Inner Feature Box (Solid)
      ctx.strokeStyle = pt.color;
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(x - fs / 2, y - fs / 2, fs, fs);
      ctx.strokeRect(x - fs / 2, y - fs / 2, fs, fs);

      // Center Crosshair Reticle
      ctx.beginPath();
      ctx.moveTo(x - 8, y);
      ctx.lineTo(x + 8, y);
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y + 8);
      ctx.stroke();

      // Center Pin Dot
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();

      // Point Label Badge
      ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.fillRect(x - fs / 2, y - fs / 2 - 16, 56, 14);
      ctx.fillStyle = '#ffffff';
      ctx.font = '10px monospace';
      ctx.fillText(pt.name, x - fs / 2 + 4, y - fs / 2 - 5);

      ctx.restore();
    });

    // If 2-Point Mode, draw connecting alignment line
    if (isTwoPoint && points['p1'] && points['p2']) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      ctx.moveTo(points['p1'].x, points['p1'].y);
      ctx.lineTo(points['p2'].x, points['p2'].y);
      ctx.stroke();
      ctx.restore();
    }

    // 3b. Render Live Motion Blur Shutter Ghost Trail on Viewport when enabled
    if (enableMotionBlur && processedKeyframes.length > 1) {
      const curPkf = processedKeyframes.find((k) => k.frameNumber === currentFrame);
      if (curPkf && curPkf.motionBlurLength && curPkf.motionBlurLength > 0.4) {
        const vx = curPkf.velocityX || 0;
        const vy = curPkf.velocityY || 0;
        const shutterRatio = Math.max(0, Math.min(360, shutterAngle)) / 360;
        const blurDx = vx * shutterRatio;
        const blurDy = vy * shutterRatio;

        ctx.save();
        for (let g = 4; g >= 1; g--) {
          const frac = (g / 4) * 0.85;
          const gx = curPkf.x - blurDx * frac;
          const gy = curPkf.y - blurDy * frac;
          const alpha = (1 - g / 5) * 0.45;
          ctx.strokeStyle = `rgba(245, 158, 11, ${alpha})`;
          ctx.fillStyle = `rgba(245, 158, 11, ${alpha * 0.5})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(gx, gy, 6 + g * 1.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        // Velocity vector arrow
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(curPkf.x - blurDx * 0.5, curPkf.y - blurDy * 0.5);
        ctx.lineTo(curPkf.x + blurDx * 0.5, curPkf.y + blurDy * 0.5);
        ctx.stroke();
        ctx.restore();
      }
    }

    // 3c. Render Interactive Target Offset Anchor ("Track Here, Pin Text Over There")
    const basePt = isSurfaceMode && points['p1'] && points['p2'] && points['p3'] && points['p4']
      ? {
          x: (points['p1'].x + points['p2'].x + points['p3'].x + points['p4'].x) * 0.25,
          y: (points['p1'].y + points['p2'].y + points['p3'].y + points['p4'].y) * 0.25,
        }
      : points['p1'];
    const isOffsetVisible = showOffsetAnchor || Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5;
    if (basePt && isOffsetVisible) {
      const targetAnchorX = basePt.x + offsetX;
      const targetAnchorY = basePt.y + offsetY;

      ctx.save();
      // Dashed vector leader from tracked feature to offset pin target
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(basePt.x, basePt.y);
      ctx.lineTo(targetAnchorX, targetAnchorY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Target Offset Reticle
      ctx.fillStyle = 'rgba(16, 185, 129, 0.22)';
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(targetAnchorX, targetAnchorY, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(targetAnchorX - 13, targetAnchorY);
      ctx.lineTo(targetAnchorX + 13, targetAnchorY);
      ctx.moveTo(targetAnchorX, targetAnchorY - 13);
      ctx.lineTo(targetAnchorX, targetAnchorY + 13);
      ctx.stroke();

      // Label badge
      ctx.fillStyle = 'rgba(6, 78, 59, 0.92)';
      ctx.fillRect(targetAnchorX + 10, targetAnchorY - 16, 92, 15);
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1;
      ctx.strokeRect(targetAnchorX + 10, targetAnchorY - 16, 92, 15);
      ctx.fillStyle = '#a7f3d0';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(`PIN (${offsetX >= 0 ? '+' : ''}${Math.round(offsetX)},${offsetY >= 0 ? '+' : ''}${Math.round(offsetY)})`, targetAnchorX + 14, targetAnchorY - 5);
      ctx.restore();
    }

    // 4. Render 6x Precision Magnifier Loupe
    if (showLoupe && loupeCanvasRef.current && cleanCanvas) {
      const lCanvas = loupeCanvasRef.current;
      const lCtx = lCanvas.getContext('2d');
      if (lCtx) {
        const focusPt =
          draggingPointId && points[draggingPointId]
            ? points[draggingPointId]
            : hoverCoords || points['p1'];
        if (focusPt) {
          const lw = lCanvas.width;
          const lh = lCanvas.height;
          const zoomFactor = 6; // 6x pixel magnification
          const srcW = lw / zoomFactor;
          const srcH = lh / zoomFactor;
          const sx = focusPt.x - srcW / 2;
          const sy = focusPt.y - srcH / 2;

          lCtx.fillStyle = '#08080a';
          lCtx.fillRect(0, 0, lw, lh);
          lCtx.imageSmoothingEnabled = false;
          lCtx.drawImage(cleanCanvas, sx, sy, srcW, srcH, 0, 0, lw, lh);

          // Draw subtle pixel grid inside loupe
          lCtx.strokeStyle = 'rgba(255,255,255,0.08)';
          lCtx.lineWidth = 1;
          for (let gx = 0; gx < lw; gx += zoomFactor) {
            lCtx.beginPath();
            lCtx.moveTo(gx, 0);
            lCtx.lineTo(gx, lh);
            lCtx.stroke();
          }
          for (let gy = 0; gy < lh; gy += zoomFactor) {
            lCtx.beginPath();
            lCtx.moveTo(0, gy);
            lCtx.lineTo(lw, gy);
            lCtx.stroke();
          }

          // Draw precision crosshair reticle in center of loupe
          const cx = lw / 2;
          const cy = lh / 2;
          lCtx.strokeStyle = '#3ea6ff';
          lCtx.lineWidth = 1.5;
          lCtx.beginPath();
          lCtx.moveTo(cx - 18, cy);
          lCtx.lineTo(cx - 3, cy);
          lCtx.moveTo(cx + 3, cy);
          lCtx.lineTo(cx + 18, cy);
          lCtx.moveTo(cx, cy - 18);
          lCtx.lineTo(cx, cy - 3);
          lCtx.moveTo(cx, cy + 3);
          lCtx.lineTo(cx, cy + 18);
          lCtx.stroke();

          // Exact center pixel box
          lCtx.strokeStyle = '#f59e0b';
          lCtx.strokeRect(cx - zoomFactor / 2, cy - zoomFactor / 2, zoomFactor, zoomFactor);
        }
      }
    }
  }, [
    canvasRef,
    cleanCanvasRef,
    videoRef,
    points,
    isSurfaceMode,
    isTwoPoint,
    rawKeyframes,
    processedKeyframes,
    currentFrame,
    isTracking,
    showLoupe,
    draggingPointId,
    hoverCoords,
    enableMotionBlur,
    shutterAngle,
    showOffsetAnchor,
    offsetX,
    offsetY,
  ]);

  // Continuously request animation frame
  useEffect(() => {
    let animId: number;
    const loop = () => {
      renderOverlay();
      animId = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(animId);
  }, [renderOverlay]);

  // Convert screen mouse event to internal 640x360 canvas coordinates accurately at any zoom/pan
  const getCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // Focus & zoom directly onto Point 1 so user can pinpoint small targets (like a ball)
  const handleFocusOnPoint = (targetZoom: number = 3.5) => {
    const pt = points['p1'];
    if (!pt) return;
    const cx = 320;
    const cy = 180;
    const newZoom = Math.max(zoomLevel < 2 ? targetZoom : zoomLevel, 2.5);
    setZoomLevel(newZoom);
    setPanOffset({
      x: (cx - pt.x) * newZoom,
      y: (cy - pt.y) * newZoom,
    });
  };

  const handleResetView = () => {
    setZoomLevel(1);
    setPanOffset({ x: 0, y: 0 });
    setIsPanMode(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.35 : -0.35;
    setZoomLevel((prev) => {
      const next = Math.max(1, Math.min(8, Math.round((prev + delta) * 100) / 100));
      if (next === 1) {
        setPanOffset({ x: 0, y: 0 });
      }
      return next;
    });
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    // Middle-click, Alt+Click, or Pan Mode pans the viewport
    if (e.button === 1 || e.altKey || isPanMode) {
      e.preventDefault();
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        startX: panOffset.x,
        startY: panOffset.y,
      };
      return;
    }

    if (isTracking) return;
    const { x, y } = getCanvasCoords(e);

    // Check hit test against Target Offset Anchor first when visible
    const basePt = isSurfaceMode && points['p1'] && points['p2'] && points['p3'] && points['p4']
      ? {
          x: (points['p1'].x + points['p2'].x + points['p3'].x + points['p4'].x) * 0.25,
          y: (points['p1'].y + points['p2'].y + points['p3'].y + points['p4'].y) * 0.25,
        }
      : points['p1'];
    const isOffsetVisible = showOffsetAnchor || Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5;
    if (basePt && isOffsetVisible && onUpdateOffset) {
      const anchorX = basePt.x + offsetX;
      const anchorY = basePt.y + offsetY;
      if (Math.hypot(x - anchorX, y - anchorY) <= Math.max(12, 16 / Math.sqrt(zoomLevel))) {
        setIsDraggingOffset(true);
        return;
      }
    }

    // Check hit test against active pins (p1..p4 in surface mode, p1..p2 in 2-point, p1 in 1-point)
    const targetPoints = isSurfaceMode
      ? ['p1', 'p2', 'p3', 'p4']
      : isTwoPoint
      ? ['p1', 'p2']
      : ['p1'];

    for (const id of targetPoints) {
      const pt = points[id];
      if (!pt) continue;
      const hitRadius = Math.max(10, (pt.featureSize / 2 + 12) / Math.sqrt(zoomLevel));
      if (Math.hypot(x - pt.x, y - pt.y) <= hitRadius) {
        setDraggingPointId(id);
        return;
      }
    }

    // In 4-Pin Surface Mode: if clicking inside the quad, allow dragging the entire surface together;
    // if clicking outside the quad, snap the nearest corner pin to the clicked position for free placement!
    if (isSurfaceMode && points['p1'] && points['p2'] && points['p3'] && points['p4']) {
      if (
        onMoveAllPoints &&
        isPointInQuad(x, y, points['p1'], points['p2'], points['p3'], points['p4'])
      ) {
        setIsDraggingSurface(true);
        surfaceDragPrevRef.current = { x, y };
        return;
      }
      // Find closest corner pin and snap it to clicked spot for free-form editing
      let closestId = 'p1';
      let bestDist = Infinity;
      for (const id of ['p1', 'p2', 'p3', 'p4']) {
        const d = Math.hypot(x - points[id].x, y - points[id].y);
        if (d < bestDist) {
          bestDist = d;
          closestId = id;
        }
      }
      const snapX = zoomLevel >= 2 ? Math.round(x * 2) / 2 : Math.round(x);
      const snapY = zoomLevel >= 2 ? Math.round(y * 2) / 2 : Math.round(y);
      onUpdatePoint(closestId, { x: snapX, y: snapY });
      if (e.shiftKey && onSnapToFeature) {
        setTimeout(() => onSnapToFeature(closestId), 10);
      } else {
        setDraggingPointId(closestId);
      }
      return;
    }

    // Snap p1 to clicked position with 0.5px precision when zoomed in
    const snap = zoomLevel >= 2 ? Math.round(x * 2) / 2 : Math.round(x);
    const snapY = zoomLevel >= 2 ? Math.round(y * 2) / 2 : Math.round(y);
    onUpdatePoint('p1', { x: snap, y: snapY });
    if (e.shiftKey && onSnapToFeature) {
      setTimeout(() => onSnapToFeature('p1'), 10);
    } else {
      setDraggingPointId('p1');
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      setPanOffset({
        x: panStartRef.current.startX + dx,
        y: panStartRef.current.startY + dy,
      });
      return;
    }

    const { x, y } = getCanvasCoords(e);
    const canvas = canvasRef.current;
    if (!canvas) return;

    const clampedX = Math.max(4, Math.min(canvas.width - 4, zoomLevel >= 2 ? Math.round(x * 2) / 2 : Math.round(x)));
    const clampedY = Math.max(4, Math.min(canvas.height - 4, zoomLevel >= 2 ? Math.round(y * 2) / 2 : Math.round(y)));
    setHoverCoords({ x: clampedX, y: clampedY });

    if (isDraggingOffset && onUpdateOffset) {
      const basePt = isSurfaceMode && points['p1'] && points['p2'] && points['p3'] && points['p4']
        ? {
            x: (points['p1'].x + points['p2'].x + points['p3'].x + points['p4'].x) * 0.25,
            y: (points['p1'].y + points['p2'].y + points['p3'].y + points['p4'].y) * 0.25,
          }
        : points['p1'];
      if (basePt) {
        onUpdateOffset(Math.round(clampedX - basePt.x), Math.round(clampedY - basePt.y));
      }
      return;
    }

    if (isDraggingSurface && onMoveAllPoints && !isTracking) {
      const dx = clampedX - surfaceDragPrevRef.current.x;
      const dy = clampedY - surfaceDragPrevRef.current.y;
      if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
        onMoveAllPoints(dx, dy);
        surfaceDragPrevRef.current = { x: clampedX, y: clampedY };
      }
      return;
    }

    if (!draggingPointId || isTracking) return;
    onUpdatePoint(draggingPointId, { x: clampedX, y: clampedY });
  };

  const handleMouseUp = () => {
    setDraggingPointId(null);
    setIsDraggingSurface(false);
    setIsDraggingOffset(false);
    setIsPanning(false);
  };

  const handleMouseLeave = () => {
    setDraggingPointId(null);
    setIsDraggingSurface(false);
    setIsDraggingOffset(false);
    setIsPanning(false);
    setHoverCoords(null);
  };

  // Drag and Drop File Handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (isSupportedVideoFile(file)) {
        onDropVideoFile(file);
      }
    }
  };

  const primaryPt = points['p1'];
  const activeLoupePt =
    draggingPointId && points[draggingPointId]
      ? points[draggingPointId]
      : hoverCoords || primaryPt;

  return (
    <div
      ref={containerRef}
      className={`relative bg-[#161616] rounded-md border ${
        isDragOver ? 'border-[#3ea6ff] bg-[#1a2333]' : 'border-[#2d2d2d]'
      } overflow-hidden shadow-inner flex flex-col items-center justify-center transition-all`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Top Floating Viewport Bar */}
      <div className="w-full bg-[#1e1e1e]/90 backdrop-blur-sm border-b border-[#2d2d2d] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 text-xs z-10 select-none">
        <div className="flex flex-wrap items-center gap-2.5">
          {isSurfaceMode ? (
            <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
              <span className="flex items-center gap-1 text-sky-400 font-sans font-semibold">
                <Box className="w-3.5 h-3.5" />
                <span>4-Pin 3D Surface:</span>
              </span>
              <span className="text-sky-300">TL({points['p1']?.x.toFixed(0)},{points['p1']?.y.toFixed(0)})</span>
              <span className="text-purple-300">TR({points['p2']?.x.toFixed(0)},{points['p2']?.y.toFixed(0)})</span>
              <span className="text-emerald-300">BR({points['p3']?.x.toFixed(0)},{points['p3']?.y.toFixed(0)})</span>
              <span className="text-amber-300">BL({points['p4']?.x.toFixed(0)},{points['p4']?.y.toFixed(0)})</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-gray-300 font-medium">
                <Crosshair className="w-3.5 h-3.5 text-[#3ea6ff]" />
                <span>Target P1:</span>
                <span className="font-mono text-gray-300">
                  X:{primaryPt ? primaryPt.x.toFixed(1) : 0} Y:{primaryPt ? primaryPt.y.toFixed(1) : 0}
                </span>
              </div>
              {isTwoPoint && points['p2'] && (
                <div className="flex items-center gap-1.5 text-gray-300 font-medium">
                  <span className="w-2 h-2 rounded-full bg-[#ff4444]" />
                  <span>Target P2:</span>
                  <span className="font-mono text-gray-300">
                    X:{points['p2'].x.toFixed(1)} Y:{points['p2'].y.toFixed(1)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Precision Zoom, Pan, Snap & Loupe Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {isTracking && (
            <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 animate-pulse bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              TRACKING
            </span>
          )}

          {/* 1-Click Sub-Pixel Corner Snap Button */}
          {onSnapToFeature && (
            <button
              onClick={() => onSnapToFeature()}
              className="flex items-center gap-1 px-2 py-1 bg-indigo-950/80 hover:bg-indigo-900/80 text-indigo-200 rounded border border-indigo-500/40 text-[11px] font-medium transition-colors"
              title="Snap active tracker pin(s) to the sharpest high-contrast corner/pixel within 18px (or Shift+Click on canvas)"
            >
              <Magnet className="w-3 h-3 text-indigo-400" />
              <span>Snap Corner</span>
            </button>
          )}

          {/* Interactive Target Offset Anchor Toggle */}
          {onUpdateOffset && (
            <button
              onClick={() => {
                setShowOffsetAnchor((v) => {
                  const next = !v;
                  if (next && offsetX === 0 && offsetY === 0) {
                    onUpdateOffset(60, -40);
                  }
                  return next;
                });
              }}
              className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
                showOffsetAnchor || Math.abs(offsetX) > 0.5 || Math.abs(offsetY) > 0.5
                  ? 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                  : 'bg-[#282828] border-[#383838] text-gray-300 hover:text-white'
              }`}
              title="Toggle draggable Target Offset Pin on canvas ('Track Here, Pin Text Over There')"
            >
              <MoveUpRight className="w-3 h-3" />
              <span>Offset Pin</span>
            </button>
          )}

          {/* Quick Zoom to P1 Target Button */}
          <button
            onClick={() => handleFocusOnPoint(3.5)}
            className="flex items-center gap-1 px-2 py-1 bg-[#1e293b] hover:bg-[#334155] text-[#3ea6ff] rounded border border-[#3ea6ff]/40 text-[11px] font-medium transition-colors"
            title="Zoom in 350% directly onto Point 1 to pinpoint exact pixel"
          >
            <Target className="w-3 h-3" />
            <span>Zoom to P1</span>
          </button>

          {/* Pan Mode Toggle */}
          <button
            onClick={() => setIsPanMode((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
              isPanMode
                ? 'bg-amber-600/30 border-amber-500 text-amber-200'
                : 'bg-[#282828] border-[#383838] text-gray-300 hover:text-white'
            }`}
            title="Toggle Pan Mode (or hold Alt / Middle-Click to drag view when zoomed in)"
          >
            <Hand className="w-3 h-3" />
            <span>Pan</span>
          </button>

          {/* 6x Magnifier Loupe Toggle */}
          <button
            onClick={() => setShowLoupe((v) => !v)}
            className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium transition-colors ${
              showLoupe
                ? 'bg-[#1473e6]/30 border-[#3ea6ff] text-[#3ea6ff]'
                : 'bg-[#282828] border-[#383838] text-gray-400 hover:text-white'
            }`}
            title="Toggle 6x Pixel Magnifier Loupe for sub-pixel point placement"
          >
            <Search className="w-3 h-3" />
            <span>6x Loupe</span>
          </button>

          {/* Zoom Step Controls up to 800% */}
          <div className="flex items-center gap-0.5 bg-[#282828] rounded p-0.5 border border-[#383838]">
            <button
              onClick={() => {
                setZoomLevel((z) => {
                  const next = Math.max(1, z - 0.5);
                  if (next === 1) setPanOffset({ x: 0, y: 0 });
                  return next;
                });
              }}
              className="p-1 text-gray-400 hover:text-white rounded"
              title="Zoom Out"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="text-[10px] font-mono px-1.5 text-gray-200 min-w-[42px] text-center">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel((z) => Math.min(8.0, z + 0.5))}
              className="p-1 text-gray-400 hover:text-white rounded"
              title="Zoom In (up to 800%)"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
            <button
              onClick={handleResetView}
              className="p-1 text-gray-400 hover:text-white rounded"
              title="Reset Zoom & Pan (100%)"
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Main Canvas Area */}
      <div
        onWheel={handleWheel}
        className="relative w-full flex items-center justify-center p-2 min-h-[360px] max-h-[480px] overflow-hidden bg-[#0d0d0f]"
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={360}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
            transformOrigin: 'center center',
            transition: draggingPointId || isPanning ? 'none' : 'transform 0.1s ease-out',
            cursor: isPanning
              ? 'grabbing'
              : isPanMode
              ? 'grab'
              : draggingPointId || isDraggingOffset
              ? 'none'
              : 'crosshair',
          }}
          className="rounded shadow-2xl max-w-full h-auto object-contain bg-black border border-[#2b2b2b]"
        />

        {/* Floating 6x Precision Pixel Magnifier Loupe */}
        {showLoupe && (
          <div
            className={`absolute top-3 ${
              activeLoupePt && activeLoupePt.x > 340 ? 'left-3' : 'right-3'
            } z-20 pointer-events-none bg-[#141418]/95 border border-[#3ea6ff]/60 rounded-md p-1.5 shadow-2xl flex flex-col items-center gap-1`}
          >
            <div className="w-full flex items-center justify-between text-[9px] font-mono text-gray-300 px-0.5">
              <span className="text-[#3ea6ff] font-semibold">6x PIXEL LOUPE</span>
              <span>
                {activeLoupePt ? `${activeLoupePt.x.toFixed(1)}, ${activeLoupePt.y.toFixed(1)}` : ''}
              </span>
            </div>
            <canvas
              ref={loupeCanvasRef}
              width={126}
              height={126}
              className="rounded border border-[#2d2d2d] bg-black"
            />
          </div>
        )}

        {/* Drag & drop prompt overlay when dragging file */}
        {isDragOver && (
          <div className="absolute inset-0 bg-[#004e92]/70 flex flex-col items-center justify-center text-white backdrop-blur-sm z-20 pointer-events-none">
            <UploadCloud className="w-12 h-12 mb-2 animate-bounce" />
            <p className="text-sm font-semibold">Drop Any Video (.MP4, .TS, .MKV, .MOV, .MXF, .AVI) to Track</p>
          </div>
        )}
      </div>

      {/* Bottom Status Bar */}
      <div className="w-full bg-[#181818] border-t border-[#262626] px-3 py-1 flex flex-wrap items-center justify-between text-[11px] text-gray-400 select-none">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[#3ea6ff]">
            TC {secondsToTimecode(currentTime, fps)}
          </span>
          <span className="font-mono text-gray-400">
            FRAME {currentFrame + 1} / {totalFrames || 1}
          </span>
          <span className="text-[10px] text-gray-500 hidden sm:inline">
            Shift+Click to auto-snap to strongest corner • Drag &quot;Offset Pin&quot; to offset text placement
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#3ea6ff]/60 inline-block"></span>
            Raw Trail
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-[#f59e0b] inline-block"></span>
            Smoothed Trail
          </span>
        </div>
      </div>
    </div>
  );
};
