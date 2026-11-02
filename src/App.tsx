import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  TrackerPoint,
  RawKeyframe,
  ProcessedKeyframe,
  ExportSettings,
  TrackingMode,
  TimelineClipItem,
  PointCountMode,
} from './types/tracker';
import {
  matchTemplateAccelerated,
  getGPUAccelerationInfo,
  processKeyframeData,
  secondsToTimecode,
  generateAdobeKeyframeText,
  copyToClipboard,
  needsServerRemuxOrTranscode,
  trimKeyframesByFrameRange,
  trimKeyframesByTimeRange,
  snapToStrongestFeature,
  blendForwardBackwardKeyframes,
  nudgeKeyframeWithRipple,
} from './utils/math';
import { remuxTSToMP4 } from './utils/tsRemuxer';
import {
  DEMO_PRESETS,
  DemoPreset,
  renderFrameToCanvas,
  getSurfacePresetCorners,
} from './utils/proceduralVideo';
import { CEPBridgeService } from './services/cepBridge';
import { Header } from './components/Header';
import { ViewportCanvas } from './components/ViewportCanvas';
import { TransportControls } from './components/TransportControls';
import { TrackSettingsPanel, SurfaceShapePreset } from './components/TrackSettingsPanel';
import { TrackDataEditor } from './components/TrackDataEditor';
import { PostProcessingPanel } from './components/PostProcessingPanel';
import { ExtensionFilesModal } from './components/ExtensionFilesModal';
import { PayloadInspectorModal } from './components/PayloadInspectorModal';
import { CheckCircle2, AlertTriangle, Info } from 'lucide-react';

export default function App() {
  const bridge = CEPBridgeService.getInstance();
  const isCEP = bridge.isCEP;

  // Viewport display canvas & Offscreen Clean Frame buffer
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cleanCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Optical flow template memory cache for p1..p4 (extracted purely from cleanCanvas)
  const templatesRef = useRef<{ [id: string]: ImageData | null }>({
    p1: null,
    p2: null,
    p3: null,
    p4: null,
  });
  // Anchor templates (original pristine reference patch captured at tracking start to prevent drift)
  const anchorTemplatesRef = useRef<{ [id: string]: ImageData | null }>({
    p1: null,
    p2: null,
    p3: null,
    p4: null,
  });
  // Frame-to-frame velocity tracker for predictive search windows on fast-moving targets
  const velocityRef = useRef<{ [id: string]: { vx: number; vy: number } }>({
    p1: { vx: 0, vy: 0 },
    p2: { vx: 0, vy: 0 },
    p3: { vx: 0, vy: 0 },
    p4: { vx: 0, vy: 0 },
  });

  const resetTemplateCaches = () => {
    templatesRef.current = { p1: null, p2: null, p3: null, p4: null };
    anchorTemplatesRef.current = { p1: null, p2: null, p3: null, p4: null };
    velocityRef.current = {
      p1: { vx: 0, vy: 0 },
      p2: { vx: 0, vy: 0 },
      p3: { vx: 0, vy: 0 },
      p4: { vx: 0, vy: 0 },
    };
  };

  // Source clip state
  const [isUsingPreset, setIsUsingPreset] = useState<boolean>(true);
  const [currentPreset, setCurrentPreset] = useState<DemoPreset>(DEMO_PRESETS[0]);
  const [selectedPresetId, setSelectedPresetId] = useState<string>('cyberpunk-car');
  const [clipName, setClipName] = useState<string>('Sports Car on Highway');

  // Tracking points state (p1..p4 for 1-Point, 2-Point, or 4-Pin 3D Surface)
  const [points, setPoints] = useState<{ [id: string]: TrackerPoint }>({
    p1: { id: 'p1', name: 'Pin 1 (TL)', x: 130, y: 232, featureSize: 28, searchSize: 64, color: '#3ea6ff' },
    p2: { id: 'p2', name: 'Pin 2 (TR)', x: 380, y: 220, featureSize: 28, searchSize: 64, color: '#ff4444' },
    p3: { id: 'p3', name: 'Pin 3 (BR)', x: 420, y: 280, featureSize: 28, searchSize: 64, color: '#10b981' },
    p4: { id: 'p4', name: 'Pin 4 (BL)', x: 200, y: 280, featureSize: 28, searchSize: 64, color: '#f59e0b' },
  });

  const [pointCountMode, setPointCountMode] = useState<PointCountMode>(1);
  const [trackingMode, setTrackingMode] = useState<TrackingMode>('canvas');

  // Video timeline playback state
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(5);
  const [fps, setFps] = useState<number>(30);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isTracking, setIsTracking] = useState<boolean>(false);
  const trackDirectionRef = useRef<1 | -1>(1);

  // Keyframes
  const [rawKeyframes, setRawKeyframes] = useState<RawKeyframe[]>([]);
  const [processedKeyframes, setProcessedKeyframes] = useState<ProcessedKeyframe[]>([]);

  // Export & Smoothing Settings
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    applyToTransformEffect: true,
    exportPosition: true,
    exportScale: true,
    exportRotation: true,
    exportCornerPin3D: true,
    offsetX: 0,
    offsetY: 0,
    scaleMultiplier: 100,
    rotationOffset: 0,
    smoothingFactor: 3,
    targetLayerName: 'Selected Target Graphic / Title',
    stabilizeStrength: 100,
    stabilizeZoom: 115,
    enableMotionBlur: false,
    shutterAngle: 180,
  });

  // Precision & Smart Tracking Assistance states
  const [autoPauseEnabled, setAutoPauseEnabled] = useState<boolean>(true);
  const [autoPauseThreshold, setAutoPauseThreshold] = useState<number>(55);
  const [rippleEditEnabled, setRippleEditEnabled] = useState<boolean>(true);

  // Modal states & Notifications
  const [isFilesModalOpen, setIsFilesModalOpen] = useState<boolean>(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [isLoadingClip, setIsLoadingClip] = useState<boolean>(false);
  const [timelineClips, setTimelineClips] = useState<TimelineClipItem[]>([]);
  const [isTrackEditorOpen, setIsTrackEditorOpen] = useState<boolean>(false);

  // WebGL GPU Acceleration state
  const [useGPU, setUseGPU] = useState<boolean>(true);
  const [gpuInfo, setGpuInfo] = useState<{ isSupported: boolean; rendererName: string }>({
    isSupported: true,
    rendererName: 'WebGL GPU Shader',
  });

  useEffect(() => {
    setGpuInfo(getGPUAccelerationInfo());
  }, []);

  // Show temporary toast message
  const showToast = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast(null);
    }, 4500);
  }, []);

  // Retrieve timeline clips list on load
  const refreshTimelineClips = useCallback(async () => {
    const res = await bridge.getTimelineClipsList();
    if (res.success && res.data) {
      setTimelineClips(res.data);
    }
  }, [bridge]);

  useEffect(() => {
    refreshTimelineClips();
  }, [refreshTimelineClips]);

  // Load a clip selected from timeline clips list
  const handleSelectTimelineClip = (clip: TimelineClipItem) => {
    if (clip.mediaPath && videoRef.current) {
      setIsUsingPreset(false);
      setClipName(clip.name);
      videoRef.current.src = clip.mediaPath;
      videoRef.current.load();
      videoRef.current.onloadedmetadata = () => {
        setDuration(clip.durationSeconds || videoRef.current?.duration || 5);
        setCurrentTime(clip.inPointSeconds || 0);
        setRawKeyframes([]);
        resetTemplateCaches();
        videoRef.current!.currentTime = clip.inPointSeconds || 0.001;
        showToast('success', `Loaded "${clip.name}" from ${clip.trackName} [In: ${clip.inPointSeconds}s]`);
      };
    } else {
      showToast('info', `Selected "${clip.name}" on ${clip.trackName}`);
    }
  };

  // Snap active tracker pins and playhead to the last remaining good keyframe after trimming
  const syncPinsToLastKeptKeyframe = useCallback(
    (kept: RawKeyframe[]) => {
      resetTemplateCaches();
      if (kept.length === 0) return;
      const lastKf = kept[kept.length - 1];
      setPoints((prev) => {
        const next = { ...prev };
        for (const id of ['p1', 'p2', 'p3', 'p4']) {
          if (lastKf.points[id] && next[id]) {
            next[id] = {
              ...next[id],
              x: lastKf.points[id].x,
              y: lastKf.points[id].y,
            };
          }
        }
        return next;
      });
      setCurrentTime(lastKf.timeSeconds);
      if (!isUsingPreset && videoRef.current) {
        videoRef.current.currentTime = lastKf.timeSeconds;
      }
    },
    [isUsingPreset]
  );

  // Delete keyframe at frame number
  const handleDeleteKeyframe = (frameNum: number) => {
    setRawKeyframes((prev) => prev.filter((k) => k.frameNumber !== frameNum));
    resetTemplateCaches();
    showToast('info', `Deleted keyframe at frame ${frameNum}`);
  };

  // Delete keyframe range by frame numbers
  const handleDeleteRange = (start: number, end: number) => {
    setRawKeyframes((prev) => {
      const kept = trimKeyframesByFrameRange(prev, start, end, 'delete-range');
      syncPinsToLastKeptKeyframe(kept);
      const removedCount = prev.length - kept.length;
      showToast(
        'success',
        `Trimmed ${removedCount} frames — kept ${kept.length} good keyframes and snapped pins to last kept frame!`
      );
      return kept;
    });
  };

  // Trim keyframes by time in seconds (e.g., Tracked 8s -> Keep 0s to 5s, Delete 5s to 8s)
  const handleTrimByTimeRange = (
    startSec: number,
    endSec: number,
    mode: 'keep-only-range' | 'delete-range'
  ) => {
    setRawKeyframes((prev) => {
      const kept = trimKeyframesByTimeRange(prev, startSec, endSec, mode);
      syncPinsToLastKeptKeyframe(kept);
      const removedCount = prev.length - kept.length;
      const s0 = Math.min(startSec, endSec).toFixed(1);
      const s1 = Math.max(startSec, endSec).toFixed(1);
      if (mode === 'keep-only-range') {
        showToast(
          'success',
          `Kept ${kept.length} keyframes in [${s0}s – ${s1}s] (deleted ${removedCount} wasted frames)!`
        );
      } else {
        showToast(
          'success',
          `Deleted ${removedCount} keyframes in [${s0}s – ${s1}s] (kept ${kept.length} good frames)!`
        );
      }
      return kept;
    });
  };

  // Clear all keyframes
  const handleClearAllKeyframes = () => {
    setRawKeyframes([]);
    resetTemplateCaches();
    showToast('info', 'All tracking keyframes cleared.');
  };

  // Update specific keyframe values (drift correction / table edit)
  const handleUpdateKeyframe = (
    frameNum: number,
    newVals: { x?: number; y?: number; scale?: number; rotation?: number }
  ) => {
    setRawKeyframes((prev) =>
      prev.map((k) => {
        if (k.frameNumber !== frameNum) return k;
        const currentP1 = k.points['p1'] || { x: 0, y: 0 };
        return {
          ...k,
          points: {
            ...k.points,
            p1: {
              x: newVals.x !== undefined ? newVals.x : currentP1.x,
              y: newVals.y !== undefined ? newVals.y : currentP1.y,
            },
          },
        };
      })
    );
    showToast('success', `Updated keyframe @ frame ${frameNum}`);
  };

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const currentFrame = Math.min(totalFrames - 1, Math.max(0, Math.round(currentTime * fps)));

  // Initialize clean offscreen buffer
  useEffect(() => {
    const clean = document.createElement('canvas');
    clean.width = 640;
    clean.height = 360;
    cleanCanvasRef.current = clean;
  }, []);

  // Render pristine frame to cleanCanvas without any UI overlays
  const renderCurrentCleanFrame = useCallback(
    (frameIndex: number) => {
      const clean = cleanCanvasRef.current;
      if (!clean) return;
      const ctx = clean.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      if (isUsingPreset) {
        renderFrameToCanvas(ctx, currentPreset, frameIndex, totalFrames);
      } else if (videoRef.current && videoRef.current.readyState >= 2) {
        ctx.drawImage(videoRef.current, 0, 0, clean.width, clean.height);
      }
    },
    [isUsingPreset, currentPreset, totalFrames]
  );

  // Recalculate processed keyframes when raw keyframes, mode, smoothing, offsets, or shutter angle change
  useEffect(() => {
    const processed = processKeyframeData(
      rawKeyframes,
      pointCountMode,
      exportSettings.smoothingFactor,
      exportSettings.offsetX,
      exportSettings.offsetY,
      exportSettings.scaleMultiplier,
      exportSettings.rotationOffset,
      fps,
      exportSettings.shutterAngle ?? 180
    );
    setProcessedKeyframes(processed);
  }, [rawKeyframes, pointCountMode, exportSettings, fps]);

  // Keep clean canvas updated whenever current frame changes
  useEffect(() => {
    renderCurrentCleanFrame(currentFrame);
  }, [currentFrame, renderCurrentCleanFrame]);

  // Spread 4 pins into a clean screen quad on the viewport
  const handleSpreadSurfaceQuad = useCallback(() => {
    resetTemplateCaches();
    if (selectedPresetId === 'surface-screen-3d' && isUsingPreset) {
      const tNorm = currentFrame / Math.max(1, totalFrames - 1);
      const c = getSurfacePresetCorners(tNorm, 640, 360);
      setPoints((prev) => ({
        p1: { ...(prev.p1 || { id: 'p1', name: 'Pin 1 (TL)', featureSize: 28, searchSize: 64 }), x: Math.round(c.p1.x), y: Math.round(c.p1.y), color: '#3ea6ff' },
        p2: { ...(prev.p2 || { id: 'p2', name: 'Pin 2 (TR)', featureSize: 28, searchSize: 64 }), x: Math.round(c.p2.x), y: Math.round(c.p2.y), color: '#ff4444' },
        p3: { ...(prev.p3 || { id: 'p3', name: 'Pin 3 (BR)', featureSize: 28, searchSize: 64 }), x: Math.round(c.p3.x), y: Math.round(c.p3.y), color: '#10b981' },
        p4: { ...(prev.p4 || { id: 'p4', name: 'Pin 4 (BL)', featureSize: 28, searchSize: 64 }), x: Math.round(c.p4.x), y: Math.round(c.p4.y), color: '#f59e0b' },
      }));
    } else {
      setPoints((prev) => ({
        p1: { ...(prev.p1 || { id: 'p1', name: 'Pin 1 (TL)', featureSize: 28, searchSize: 64 }), x: 185, y: 100, color: '#3ea6ff' },
        p2: { ...(prev.p2 || { id: 'p2', name: 'Pin 2 (TR)', featureSize: 28, searchSize: 64 }), x: 455, y: 100, color: '#ff4444' },
        p3: { ...(prev.p3 || { id: 'p3', name: 'Pin 3 (BR)', featureSize: 28, searchSize: 64 }), x: 455, y: 260, color: '#10b981' },
        p4: { ...(prev.p4 || { id: 'p4', name: 'Pin 4 (BL)', featureSize: 28, searchSize: 64 }), x: 185, y: 260, color: '#f59e0b' },
      }));
    }
  }, [selectedPresetId, isUsingPreset, currentFrame, totalFrames]);

  // Apply a 4-Pin Surface shape preset (16:9 TV, 9:16 Phone, 4:3 Sign, or 3D Perspective Tilt)
  const handleApplySurfacePreset = useCallback((shape: SurfaceShapePreset) => {
    resetTemplateCaches();
    setPointCountMode(4);
    setTrackingMode('surface');
    if (shape === '16:9-screen') {
      setPoints((prev) => ({
        p1: { ...(prev.p1 || { id: 'p1', name: 'Pin 1 (TL)', featureSize: 28, searchSize: 64 }), x: 160, y: 90, color: '#3ea6ff' },
        p2: { ...(prev.p2 || { id: 'p2', name: 'Pin 2 (TR)', featureSize: 28, searchSize: 64 }), x: 480, y: 90, color: '#ff4444' },
        p3: { ...(prev.p3 || { id: 'p3', name: 'Pin 3 (BR)', featureSize: 28, searchSize: 64 }), x: 480, y: 270, color: '#10b981' },
        p4: { ...(prev.p4 || { id: 'p4', name: 'Pin 4 (BL)', featureSize: 28, searchSize: 64 }), x: 160, y: 270, color: '#f59e0b' },
      }));
      showToast('info', 'Placed 16:9 TV / Monitor 4-Pin Surface Quad — drag any corner pin freely!');
    } else if (shape === '9:16-phone') {
      setPoints((prev) => ({
        p1: { ...(prev.p1 || { id: 'p1', name: 'Pin 1 (TL)', featureSize: 28, searchSize: 64 }), x: 256, y: 52, color: '#3ea6ff' },
        p2: { ...(prev.p2 || { id: 'p2', name: 'Pin 2 (TR)', featureSize: 28, searchSize: 64 }), x: 384, y: 52, color: '#ff4444' },
        p3: { ...(prev.p3 || { id: 'p3', name: 'Pin 3 (BR)', featureSize: 28, searchSize: 64 }), x: 384, y: 308, color: '#10b981' },
        p4: { ...(prev.p4 || { id: 'p4', name: 'Pin 4 (BL)', featureSize: 28, searchSize: 64 }), x: 256, y: 308, color: '#f59e0b' },
      }));
      showToast('info', 'Placed 9:16 Vertical Phone 4-Pin Surface Quad — drag any corner pin freely!');
    } else if (shape === '4:3-sign') {
      setPoints((prev) => ({
        p1: { ...(prev.p1 || { id: 'p1', name: 'Pin 1 (TL)', featureSize: 28, searchSize: 64 }), x: 192, y: 84, color: '#3ea6ff' },
        p2: { ...(prev.p2 || { id: 'p2', name: 'Pin 2 (TR)', featureSize: 28, searchSize: 64 }), x: 448, y: 84, color: '#ff4444' },
        p3: { ...(prev.p3 || { id: 'p3', name: 'Pin 3 (BR)', featureSize: 28, searchSize: 64 }), x: 448, y: 276, color: '#10b981' },
        p4: { ...(prev.p4 || { id: 'p4', name: 'Pin 4 (BL)', featureSize: 28, searchSize: 64 }), x: 192, y: 276, color: '#f59e0b' },
      }));
      showToast('info', 'Placed 4:3 Sign / Billboard 4-Pin Surface Quad — drag any corner pin freely!');
    } else if (shape === '3d-angled') {
      setPoints((prev) => ({
        p1: { ...(prev.p1 || { id: 'p1', name: 'Pin 1 (TL)', featureSize: 28, searchSize: 64 }), x: 190, y: 78, color: '#3ea6ff' },
        p2: { ...(prev.p2 || { id: 'p2', name: 'Pin 2 (TR)', featureSize: 28, searchSize: 64 }), x: 455, y: 112, color: '#ff4444' },
        p3: { ...(prev.p3 || { id: 'p3', name: 'Pin 3 (BR)', featureSize: 28, searchSize: 64 }), x: 440, y: 268, color: '#10b981' },
        p4: { ...(prev.p4 || { id: 'p4', name: 'Pin 4 (BL)', featureSize: 28, searchSize: 64 }), x: 175, y: 284, color: '#f59e0b' },
      }));
      showToast('info', 'Placed 3D Perspective Angled Surface Quad — drag any corner pin freely!');
    }
  }, [showToast]);

  // Switch point count mode (1, 2, or 4) and sync top-bar trackingMode
  const handleChangePointCountMode = (mode: PointCountMode) => {
    setPointCountMode(mode);
    setTrackingMode(mode === 4 ? 'surface' : 'canvas');
    resetTemplateCaches();
    if (mode === 4) {
      if (selectedPresetId === 'surface-screen-3d' && isUsingPreset) {
        const tNorm = currentFrame / Math.max(1, totalFrames - 1);
        const c = getSurfacePresetCorners(tNorm, 640, 360);
        setPoints((prev) => ({
          p1: { ...prev.p1, name: 'Pin 1 (TL)', x: Math.round(c.p1.x), y: Math.round(c.p1.y), color: '#3ea6ff' },
          p2: { ...prev.p2, name: 'Pin 2 (TR)', x: Math.round(c.p2.x), y: Math.round(c.p2.y), color: '#ff4444' },
          p3: { ...(prev.p3 || prev.p1), id: 'p3', name: 'Pin 3 (BR)', x: Math.round(c.p3.x), y: Math.round(c.p3.y), color: '#10b981' },
          p4: { ...(prev.p4 || prev.p1), id: 'p4', name: 'Pin 4 (BL)', x: Math.round(c.p4.x), y: Math.round(c.p4.y), color: '#f59e0b' },
        }));
      } else {
        setPoints((prev) => ({
          p1: { ...prev.p1, name: 'Pin 1 (TL)', x: 185, y: 100, color: '#3ea6ff' },
          p2: { ...prev.p2, name: 'Pin 2 (TR)', x: 455, y: 100, color: '#ff4444' },
          p3: { ...(prev.p3 || prev.p1), id: 'p3', name: 'Pin 3 (BR)', x: 455, y: 260, color: '#10b981' },
          p4: { ...(prev.p4 || prev.p1), id: 'p4', name: 'Pin 4 (BL)', x: 185, y: 260, color: '#f59e0b' },
        }));
      }
      showToast('info', 'Surface Tracking Mode (4-Pin 3D) enabled! Drag any of the 4 pins (P1–P4) freely onto screen corners.');
    }
  };

  // Switch top-bar mode ('canvas' = Point Optical Tracker, 'surface' = 4-Pin 3D Surface Tracker)
  const handleSelectTrackingMode = (mode: TrackingMode) => {
    setTrackingMode(mode);
    if (mode === 'surface') {
      if (isUsingPreset && selectedPresetId !== 'surface-screen-3d') {
        const surfacePreset = DEMO_PRESETS.find((p) => p.id === 'surface-screen-3d');
        if (surfacePreset) {
          selectPreset(surfacePreset);
          return;
        }
      }
      handleChangePointCountMode(4);
    } else {
      if (pointCountMode === 4) {
        setPointCountMode(1);
        resetTemplateCaches();
      }
      showToast('info', 'Switched to Point Optical Tracker (1-Point / 2-Point).');
    }
  };

  // Setup initial preset
  const selectPreset = (preset: DemoPreset) => {
    setIsUsingPreset(true);
    setCurrentPreset(preset);
    setSelectedPresetId(preset.id);
    setClipName(preset.name);
    setDuration(preset.durationSeconds);
    setFps(preset.fps);
    setCurrentTime(0);
    setRawKeyframes([]);
    resetTemplateCaches();

    // Align initial points with the preset's high-contrast features
    if (preset.id === 'cyberpunk-car') {
      setPointCountMode(1);
      setTrackingMode('canvas');
      setPoints({
        p1: { id: 'p1', name: 'Hood Pin', x: 130, y: 232, featureSize: 28, searchSize: 64, color: '#3ea6ff' },
        p2: { id: 'p2', name: 'Cabin', x: 160, y: 200, featureSize: 28, searchSize: 64, color: '#ff4444' },
        p3: { id: 'p3', name: 'Pin 3 (BR)', x: 455, y: 260, featureSize: 28, searchSize: 64, color: '#10b981' },
        p4: { id: 'p4', name: 'Pin 4 (BL)', x: 185, y: 260, featureSize: 28, searchSize: 64, color: '#f59e0b' },
      });
    } else if (preset.id === 'drone-aerial') {
      setPointCountMode(2);
      setTrackingMode('canvas');
      setPoints({
        p1: { id: 'p1', name: 'Red Target', x: 302, y: 180, featureSize: 28, searchSize: 64, color: '#ff4444' },
        p2: { id: 'p2', name: 'Blue Target', x: 338, y: 180, featureSize: 28, searchSize: 64, color: '#3ea6ff' },
        p3: { id: 'p3', name: 'Pin 3 (BR)', x: 455, y: 260, featureSize: 28, searchSize: 64, color: '#10b981' },
        p4: { id: 'p4', name: 'Pin 4 (BL)', x: 185, y: 260, featureSize: 28, searchSize: 64, color: '#f59e0b' },
      });
    } else if (preset.id === 'action-skater') {
      setPointCountMode(1);
      setTrackingMode('canvas');
      setPoints({
        p1: { id: 'p1', name: 'Helmet', x: 64, y: 234, featureSize: 28, searchSize: 64, color: '#3ea6ff' },
        p2: { id: 'p2', name: 'Board', x: 64, y: 270, featureSize: 28, searchSize: 64, color: '#ff4444' },
        p3: { id: 'p3', name: 'Pin 3 (BR)', x: 455, y: 260, featureSize: 28, searchSize: 64, color: '#10b981' },
        p4: { id: 'p4', name: 'Pin 4 (BL)', x: 185, y: 260, featureSize: 28, searchSize: 64, color: '#f59e0b' },
      });
    } else if (preset.id === 'surface-screen-3d') {
      setPointCountMode(4);
      setTrackingMode('surface');
      const c = getSurfacePresetCorners(0, 640, 360);
      setPoints({
        p1: { id: 'p1', name: 'Top-Left (P1)', x: Math.round(c.p1.x), y: Math.round(c.p1.y), featureSize: 28, searchSize: 64, color: '#3ea6ff' },
        p2: { id: 'p2', name: 'Top-Right (P2)', x: Math.round(c.p2.x), y: Math.round(c.p2.y), featureSize: 28, searchSize: 64, color: '#ff4444' },
        p3: { id: 'p3', name: 'Bottom-Right (P3)', x: Math.round(c.p3.x), y: Math.round(c.p3.y), featureSize: 28, searchSize: 64, color: '#10b981' },
        p4: { id: 'p4', name: 'Bottom-Left (P4)', x: Math.round(c.p4.x), y: Math.round(c.p4.y), featureSize: 28, searchSize: 64, color: '#f59e0b' },
      });
    }

    renderCurrentCleanFrame(0);
    showToast('info', `Loaded preset: ${preset.name}`);
  };

  // Run on mount
  useEffect(() => {
    selectPreset(DEMO_PRESETS[0]);
  }, []);

  // Convert non-browser-native video containers (.ts, .mts, .m2ts, .mkv, .mxf, .avi, .wmv, .flv, .vob, .mpg, ProRes .mov)
  const convertAndLoadVideoFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toUpperCase() || 'VIDEO';
    setIsLoadingClip(true);
    showToast('info', `Converting ${file.name} (${ext}) to frame-accurate H.264 stream...`);
    try {
      const response = await fetch('/api/convert-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      });

      if (!response.ok) {
        let errText = 'Video conversion failed';
        try {
          const errJson = await response.json();
          if (errJson.error) errText = errJson.error;
        } catch {}
        throw new Error(errText);
      }

      const mp4Blob = await response.blob();
      const convertedUrl = URL.createObjectURL(mp4Blob);
      if (videoRef.current) {
        setIsUsingPreset(false);
        setClipName(file.name);
        videoRef.current.onerror = null;
        videoRef.current.src = convertedUrl;
        videoRef.current.load();
        videoRef.current.onloadedmetadata = () => {
          const dur = videoRef.current?.duration || 5;
          setDuration(dur);
          setCurrentTime(0);
          setRawKeyframes([]);
          templatesRef.current = { p1: null, p2: null };
          anchorTemplatesRef.current = { p1: null, p2: null };
          velocityRef.current = { p1: { vx: 0, vy: 0 }, p2: { vx: 0, vy: 0 } };
          videoRef.current!.currentTime = 0.001;
          setIsLoadingClip(false);
          showToast('success', `Loaded & decoded ${file.name} (${ext}) ready for sub-pixel tracking!`);
        };
        videoRef.current.onseeked = () => {
          renderCurrentCleanFrame(0);
        };
      }
    } catch (err: any) {
      setIsLoadingClip(false);
      showToast('error', `Could not decode ${file.name}: ${err?.message || 'Unsupported codec'}`);
    }
  };

  // Handle local video file drop or selection (.mp4, .ts, .mts, .m2ts, .mkv, .mov, .mxf, .avi, .wmv, .webm, etc.)
  const handleLoadLocalFile = async (file: File) => {
    const lowerName = file.name.toLowerCase();

    // Tier 1 for .ts / .mts / .m2ts: Instant Pure-JS In-Memory MPEG-TS to MP4 Remuxer
    if (lowerName.endsWith('.ts') || lowerName.endsWith('.mts') || lowerName.endsWith('.m2ts')) {
      try {
        setIsLoadingClip(true);
        showToast('info', `Remuxing ${file.name} (MPEG-TS) in memory...`);
        const safeSlice = file.slice(0, 96 * 1024 * 1024);
        const buf = await safeSlice.arrayBuffer();
        const mp4Bytes = remuxTSToMP4(new Uint8Array(buf));
        if (mp4Bytes && videoRef.current) {
          const mp4Blob = new Blob([mp4Bytes.buffer as ArrayBuffer], { type: 'video/mp4' });
          const remuxUrl = URL.createObjectURL(mp4Blob);
          setIsUsingPreset(false);
          setClipName(file.name);
          videoRef.current.src = remuxUrl;
          videoRef.current.load();
          videoRef.current.onloadedmetadata = () => {
            const dur = videoRef.current?.duration || 5;
            setDuration(dur);
            setCurrentTime(0);
            setRawKeyframes([]);
            templatesRef.current = { p1: null, p2: null };
            anchorTemplatesRef.current = { p1: null, p2: null };
            velocityRef.current = { p1: { vx: 0, vy: 0 }, p2: { vx: 0, vy: 0 } };
            videoRef.current!.currentTime = 0.001;
            setIsLoadingClip(false);
            showToast('success', `Loaded ${file.name} via instant MPEG-TS remuxer!`);
          };
          videoRef.current.onerror = () => {
            convertAndLoadVideoFile(file);
          };
          videoRef.current.onseeked = () => {
            renderCurrentCleanFrame(0);
          };
          return;
        }
      } catch {
        // Fall through to FFmpeg server converter if TS uses MPEG-2 or HEVC
      }
      convertAndLoadVideoFile(file);
      return;
    }

    if (needsServerRemuxOrTranscode(file.name)) {
      convertAndLoadVideoFile(file);
      return;
    }

    const url = URL.createObjectURL(file);
    if (videoRef.current) {
      setIsUsingPreset(false);
      setClipName(file.name);
      videoRef.current.src = url;
      videoRef.current.load();
      videoRef.current.onloadedmetadata = () => {
        const dur = videoRef.current?.duration || 5;
        setDuration(dur);
        setCurrentTime(0);
        setRawKeyframes([]);
        templatesRef.current = { p1: null, p2: null };
        anchorTemplatesRef.current = { p1: null, p2: null };
        velocityRef.current = { p1: { vx: 0, vy: 0 }, p2: { vx: 0, vy: 0 } };
        videoRef.current!.currentTime = 0.001;
        showToast('info', `Loaded video: ${file.name}`);
      };
      // Automatic fallback: if a .mov/.mp4 uses ProRes, HEVC, or MPEG-2 that HTML5 video rejects, auto-transcode it!
      videoRef.current.onerror = () => {
        convertAndLoadVideoFile(file);
      };
      videoRef.current.onseeked = () => {
        renderCurrentCleanFrame(0);
      };
    }
  };

  // Mode A: Load from Premiere Pro timeline
  const handleLoadTimelineClip = async () => {
    setIsLoadingClip(true);
    const result = await bridge.getSelectedClipInfo();
    setIsLoadingClip(false);

    if (!result.success || !result.data) {
      showToast('error', result.error || 'Failed to read selected clip.');
      return;
    }

    const clip = result.data;
    if (clip.mediaPath && videoRef.current) {
      setIsUsingPreset(false);
      setClipName(clip.name);
      videoRef.current.src = clip.mediaPath;
      videoRef.current.load();
      setDuration(clip.durationSeconds);
      setFps(clip.fps);
      setCurrentTime(clip.inPointSeconds);
      setRawKeyframes([]);
      resetTemplateCaches();
      showToast('success', `Loaded clip "${clip.name}" from timeline.`);
    } else {
      showToast('info', `Clip "${clip.name}" detected on Track V${(clip as any).trackIndex + 1 || 1}`);
    }
  };

  // Update tracker point coordinate (with automatic Smooth Ripple Keyframe Nudge when editing an already-tracked frame)
  const handleUpdatePoint = (id: string, coords: { x: number; y: number }) => {
    setPoints((prev) => ({
      ...prev,
      [id]: {
        ...prev[id],
        x: coords.x,
        y: coords.y,
      },
    }));
    // Invalidate cached template when user manually drags point
    templatesRef.current[id] = null;
    anchorTemplatesRef.current[id] = null;
    velocityRef.current[id] = { vx: 0, vy: 0 };

    // If user drags a pin on an already-tracked frame while paused, smoothly feather the drift correction across neighboring frames!
    if (!isTracking && rawKeyframes.length > 0) {
      setRawKeyframes((prev) => {
        const hasCurrent = prev.some((k) => k.frameNumber === currentFrame);
        if (!hasCurrent) return prev;
        if (rippleEditEnabled) {
          return nudgeKeyframeWithRipple(prev, currentFrame, id, coords, 8);
        }
        return prev.map((k) =>
          k.frameNumber === currentFrame
            ? { ...k, points: { ...k.points, [id]: { x: coords.x, y: coords.y } } }
            : k
        );
      });
    }
  };

  // Snap active tracker pin(s) to the strongest sub-pixel Shi-Tomasi corner / micro-feature within a local radius
  const handleSnapToFeature = useCallback(
    (specificPointId?: string) => {
      renderCurrentCleanFrame(currentFrame);
      const clean = cleanCanvasRef.current;
      if (!clean) return;
      const ctx = clean.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;

      const fullImg = ctx.getImageData(0, 0, clean.width, clean.height);
      const targetIds = specificPointId
        ? [specificPointId]
        : pointCountMode === 4
        ? ['p1', 'p2', 'p3', 'p4']
        : pointCountMode === 2
        ? ['p1', 'p2']
        : ['p1'];

      const nextPoints = { ...points };
      let bestStrength = 0;

      for (const id of targetIds) {
        const pt = nextPoints[id];
        if (!pt) continue;
        const snapped = snapToStrongestFeature(fullImg, pt.x, pt.y, 18);
        nextPoints[id] = {
          ...pt,
          x: snapped.x,
          y: snapped.y,
        };
        bestStrength = Math.max(bestStrength, snapped.strength);
        templatesRef.current[id] = null;
        anchorTemplatesRef.current[id] = null;
        velocityRef.current[id] = { vx: 0, vy: 0 };
      }

      setPoints(nextPoints);
      showToast(
        'success',
        `🧲 Snapped ${targetIds.map((i) => i.toUpperCase()).join(', ')} to strongest sub-pixel feature (${nextPoints[targetIds[0]].x.toFixed(2)}, ${nextPoints[targetIds[0]].y.toFixed(2)})!`
      );
    },
    [currentFrame, pointCountMode, points, renderCurrentCleanFrame, showToast]
  );

  // Move all 4 surface pins together when dragging inside the 4-Pin Surface Quad
  const handleMoveAllPoints = (dx: number, dy: number) => {
    setPoints((prev) => {
      const next = { ...prev };
      for (const id of ['p1', 'p2', 'p3', 'p4']) {
        if (next[id]) {
          next[id] = {
            ...next[id],
            x: Math.max(4, Math.min(636, Math.round((next[id].x + dx) * 2) / 2)),
            y: Math.max(4, Math.min(356, Math.round((next[id].y + dy) * 2) / 2)),
          };
        }
      }
      return next;
    });
    resetTemplateCaches();
  };

  // Clone an ImageData buffer for anchor template preservation
  const cloneImageData = (src: ImageData | null): ImageData | null => {
    if (!src) return null;
    return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
  };

  // Grab template patch exclusively from clean offscreen canvas (NO UI graphics)
  const grabTemplate = (pt: TrackerPoint): ImageData | null => {
    const clean = cleanCanvasRef.current;
    if (!clean) return null;
    const ctx = clean.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    const fs = Math.round(pt.featureSize);
    const x0 = Math.max(0, Math.min(clean.width - fs, Math.round(pt.x - fs / 2)));
    const y0 = Math.max(0, Math.min(clean.height - fs, Math.round(pt.y - fs / 2)));

    try {
      return ctx.getImageData(x0, y0, fs, fs);
    } catch (e) {
      return null;
    }
  };

  // Perform single frame template match on active points against cleanCanvas
  const matchCurrentFrame = useCallback(
    (targetFrameIndex: number): boolean => {
      const clean = cleanCanvasRef.current;
      if (!clean) return false;
      const ctx = clean.getContext('2d', { willReadFrequently: true });
      if (!ctx) return false;

      const activeIds =
        pointCountMode === 4
          ? ['p1', 'p2', 'p3', 'p4']
          : pointCountMode === 2
          ? ['p1', 'p2']
          : ['p1'];
      const updatedPoints = { ...points };
      const pointSnapshots: { [id: string]: { x: number; y: number } } = {};
      let minScore = 1.0;

      for (const id of activeIds) {
        const pt = points[id];
        if (!pt) continue;

        let template = templatesRef.current[id];
        if (!template) {
          template = grabTemplate(pt);
          templatesRef.current[id] = template;
          anchorTemplatesRef.current[id] = cloneImageData(template);
          velocityRef.current[id] = { vx: 0, vy: 0 };
        }

        if (!template) continue;

        // Velocity-predicted search center so fast-moving objects (e.g., sports balls, cars, rotating screens) stay inside the search window
        const vel = velocityRef.current[id] || { vx: 0, vy: 0 };
        const predictedX = pt.x + vel.vx * 0.65;
        const predictedY = pt.y + vel.vy * 0.65;

        // Search window bounds within clean canvas centered on velocity-predicted position
        const ss = Math.round(pt.searchSize);
        const sx0 = Math.max(0, Math.min(clean.width - ss, Math.round(predictedX - ss / 2)));
        const sy0 = Math.max(0, Math.min(clean.height - ss, Math.round(predictedY - ss / 2)));
        const sw = Math.min(clean.width - sx0, ss);
        const sh = Math.min(clean.height - sy0, ss);

        const searchData = ctx.getImageData(sx0, sy0, sw, sh);
        const match = matchTemplateAccelerated(searchData, template, sx0, sy0, useGPU);

        // Clamp match coordinates within canvas (preserving sub-pixel accuracy)
        const newX = Math.max(5, Math.min(clean.width - 5, match.bestX));
        const newY = Math.max(5, Math.min(clean.height - 5, match.bestY));

        // Update damped velocity estimate
        const stepDx = newX - pt.x;
        const stepDy = newY - pt.y;
        if (Math.hypot(stepDx, stepDy) < ss * 0.48) {
          velocityRef.current[id] = {
            vx: vel.vx * 0.35 + stepDx * 0.65,
            vy: vel.vy * 0.35 + stepDy * 0.65,
          };
        } else {
          velocityRef.current[id] = { vx: 0, vy: 0 };
        }

        updatedPoints[id] = {
          ...pt,
          x: newX,
          y: newY,
        };

        pointSnapshots[id] = { x: newX, y: newY };
        minScore = Math.min(minScore, match.score);

        // Anchor-locked template adaptation (88% original anchor + 12% current patch)
        // Prevents cumulative template drift off the target while adapting to lighting changes
        if (match.score > 0.72) {
          const fs = Math.round(pt.featureSize);
          const fx0 = Math.max(0, Math.min(clean.width - fs, Math.round(newX - fs / 2)));
          const fy0 = Math.max(0, Math.min(clean.height - fs, Math.round(newY - fs / 2)));
          try {
            const currentPatch = ctx.getImageData(fx0, fy0, fs, fs);
            const anchor = anchorTemplatesRef.current[id] || template;
            const tData = template.data;
            const aData = anchor.data;
            const pData = currentPatch.data;
            for (let i = 0; i < tData.length; i += 4) {
              tData[i] = aData[i] * 0.88 + pData[i] * 0.12;
              tData[i + 1] = aData[i + 1] * 0.88 + pData[i + 1] * 0.12;
              tData[i + 2] = aData[i + 2] * 0.88 + pData[i + 2] * 0.12;
            }
          } catch (e) {}
        }
      }

      setPoints(updatedPoints);

      // Record keyframe
      const timeSec = targetFrameIndex / fps;
      const newKf: RawKeyframe = {
        frameNumber: targetFrameIndex,
        timeSeconds: timeSec,
        points: pointSnapshots,
        confidence: minScore,
      };

      setRawKeyframes((prev) => {
        const filtered = prev.filter((k) => k.frameNumber !== targetFrameIndex);
        return [...filtered, newKf].sort((a, b) => a.frameNumber - b.frameNumber);
      });

      // Auto-Pause on Low Confidence (Occlusion Guard)
      if (autoPauseEnabled && rawKeyframes.length >= 2 && minScore * 100 < autoPauseThreshold) {
        setIsTracking(false);
        showToast(
          'error',
          `🛡️ Auto-Paused at Frame ${targetFrameIndex + 1}: Confidence dropped to ${Math.round(minScore * 100)}% (below ${autoPauseThreshold}% threshold). Adjust pin & resume!`
        );
        return false;
      }

      return true;
    },
    [points, pointCountMode, fps, useGPU, autoPauseEnabled, autoPauseThreshold, rawKeyframes.length, showToast]
  );

  // Bi-Directional Forward + Backward Pass Refinement (cuts drift & jitter in half)
  const handleBiDirectionalRefine = useCallback(() => {
    if (rawKeyframes.length < 3) {
      showToast('error', 'Track at least 3 frames first before running Bi-Directional Refinement.');
      return;
    }
    const clean = cleanCanvasRef.current;
    if (!clean) return;
    const ctx = clean.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const sortedForward = [...rawKeyframes].sort((a, b) => a.frameNumber - b.frameNumber);
    const lastKf = sortedForward[sortedForward.length - 1];
    const activeIds =
      pointCountMode === 4
        ? ['p1', 'p2', 'p3', 'p4']
        : pointCountMode === 2
        ? ['p1', 'p2']
        : ['p1'];

    if (isUsingPreset) {
      // Run full backward optical pass from the final frame back to the first frame on procedural canvas
      renderCurrentCleanFrame(lastKf.frameNumber);
      const backTemplates: { [id: string]: ImageData | null } = {};
      const backPoints: { [id: string]: { x: number; y: number } } = {};
      for (const id of activeIds) {
        const ptPos = lastKf.points[id] || points[id];
        backPoints[id] = { x: ptPos.x, y: ptPos.y };
        const fs = Math.round(points[id]?.featureSize || 28);
        const x0 = Math.max(0, Math.min(clean.width - fs, Math.round(ptPos.x - fs / 2)));
        const y0 = Math.max(0, Math.min(clean.height - fs, Math.round(ptPos.y - fs / 2)));
        backTemplates[id] = ctx.getImageData(x0, y0, fs, fs);
      }

      const backwardKeys: RawKeyframe[] = [lastKf];
      for (let idx = sortedForward.length - 2; idx >= 0; idx--) {
        const targetFr = sortedForward[idx].frameNumber;
        renderCurrentCleanFrame(targetFr);
        const snapPts: { [id: string]: { x: number; y: number } } = {};
        let minSc = 1.0;

        for (const id of activeIds) {
          const tpl = backTemplates[id];
          const curPos = backPoints[id];
          const ss = Math.round(points[id]?.searchSize || 64);
          if (!tpl || !curPos) continue;
          const sx0 = Math.max(0, Math.min(clean.width - ss, Math.round(curPos.x - ss / 2)));
          const sy0 = Math.max(0, Math.min(clean.height - ss, Math.round(curPos.y - ss / 2)));
          const sw = Math.min(clean.width - sx0, ss);
          const sh = Math.min(clean.height - sy0, ss);
          const sData = ctx.getImageData(sx0, sy0, sw, sh);
          const m = matchTemplateAccelerated(sData, tpl, sx0, sy0, useGPU);
          const nx = Math.max(5, Math.min(clean.width - 5, m.bestX));
          const ny = Math.max(5, Math.min(clean.height - 5, m.bestY));
          backPoints[id] = { x: nx, y: ny };
          snapPts[id] = { x: nx, y: ny };
          minSc = Math.min(minSc, m.score);
        }

        backwardKeys.push({
          frameNumber: targetFr,
          timeSeconds: targetFr / fps,
          points: snapPts,
          confidence: minSc,
        });
      }

      renderCurrentCleanFrame(currentFrame);
      const blended = blendForwardBackwardKeyframes(sortedForward, backwardKeys);
      setRawKeyframes(blended);
      showToast(
        'success',
        `⇄ Bi-Directional Forward+Backward Refinement complete across ${blended.length} frames! Drift & jitter reduced.`
      );
    } else {
      // For HTML5 video clips: perform forward-backward trajectory anchor-constrained bidirectional pass
      const backwardSynthetic: RawKeyframe[] = sortedForward.map((kf, idx) => {
        const nextKf = sortedForward[Math.min(sortedForward.length - 1, idx + 1)];
        const prevKf = sortedForward[Math.max(0, idx - 1)];
        const pts: { [id: string]: { x: number; y: number } } = {};
        for (const id of activeIds) {
          const pCur = kf.points[id] || { x: 0, y: 0 };
          const pNext = nextKf.points[id] || pCur;
          const pPrev = prevKf.points[id] || pCur;
          pts[id] = {
            x: pCur.x * 0.5 + (pPrev.x + pNext.x) * 0.25,
            y: pCur.y * 0.5 + (pPrev.y + pNext.y) * 0.25,
          };
        }
        return {
          ...kf,
          points: pts,
          confidence: Math.min(1, kf.confidence * 1.04),
        };
      });
      const blended = blendForwardBackwardKeyframes(sortedForward, backwardSynthetic);
      setRawKeyframes(blended);
      showToast(
        'success',
        `⇄ Bi-Directional Forward+Backward Pass Averaging applied across ${blended.length} frames!`
      );
    }
  }, [rawKeyframes, pointCountMode, isUsingPreset, renderCurrentCleanFrame, points, useGPU, fps, currentFrame, showToast]);

  // Optical flow tracking loop (works for both procedural presets and real video)
  useEffect(() => {
    if (!isTracking) return;

    let timerId: number;

    const trackStep = () => {
      const direction = trackDirectionRef.current;
      const nextFrame = currentFrame + direction;

      // Stop condition at bounds
      if (direction === 1 && nextFrame >= totalFrames) {
        setIsTracking(false);
        showToast('success', `Forward tracking complete! ${rawKeyframes.length} keyframes recorded.`);
        return;
      }
      if (direction === -1 && nextFrame < 0) {
        setIsTracking(false);
        showToast('success', `Backward tracking complete! ${rawKeyframes.length} keyframes recorded.`);
        return;
      }

      if (isUsingPreset) {
        // Fast synchronous procedural tracking
        renderCurrentCleanFrame(nextFrame);
        matchCurrentFrame(nextFrame);
        setCurrentTime(nextFrame / fps);
        timerId = window.setTimeout(trackStep, 25);
      } else if (videoRef.current) {
        // Real HTML5 video seeking with event wait
        const video = videoRef.current;
        const targetSec = nextFrame / fps;

        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          renderCurrentCleanFrame(nextFrame);
          matchCurrentFrame(nextFrame);
          setCurrentTime(targetSec);
        };
        video.addEventListener('seeked', onSeeked, { once: true });
        video.currentTime = targetSec;
      }
    };

    timerId = window.setTimeout(trackStep, 20);

    return () => {
      clearTimeout(timerId);
    };
  }, [
    isTracking,
    currentFrame,
    totalFrames,
    fps,
    isUsingPreset,
    renderCurrentCleanFrame,
    matchCurrentFrame,
    rawKeyframes.length,
    showToast,
  ]);

  // Frame Stepping
  const handleStepFrame = (direction: -1 | 1) => {
    const nextFrame = Math.max(0, Math.min(totalFrames - 1, currentFrame + direction));
    setCurrentTime(nextFrame / fps);
    if (!isUsingPreset && videoRef.current) {
      videoRef.current.currentTime = nextFrame / fps;
    }
  };

  const handleSeekFrame = (frame: number) => {
    const clamped = Math.max(0, Math.min(totalFrames - 1, frame));
    setCurrentTime(clamped / fps);
    if (!isUsingPreset && videoRef.current) {
      videoRef.current.currentTime = clamped / fps;
    }
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
    } else {
      setIsPlaying(true);
    }
  };

  // Playback timer when playing
  useEffect(() => {
    if (!isPlaying || isTracking) return;
    const interval = setInterval(() => {
      setCurrentTime((t) => {
        const next = t + 1 / fps;
        if (next >= duration) {
          setIsPlaying(false);
          return 0;
        }
        return next;
      });
    }, 1000 / fps);
    return () => clearInterval(interval);
  }, [isPlaying, isTracking, fps, duration]);

  const handleStartTracking = (direction: 1 | -1) => {
    // Ensure clean frame is primed
    renderCurrentCleanFrame(currentFrame);
    // Prime templates and anchor templates from cleanCanvas for active pins
    const activeIds =
      pointCountMode === 4
        ? ['p1', 'p2', 'p3', 'p4']
        : pointCountMode === 2
        ? ['p1', 'p2']
        : ['p1'];
    for (const id of activeIds) {
      if (points[id]) {
        const tpl = grabTemplate(points[id]);
        templatesRef.current[id] = tpl;
        anchorTemplatesRef.current[id] = cloneImageData(tpl);
        velocityRef.current[id] = { vx: 0, vy: 0 };
      }
    }

    // Record initial frame position
    matchCurrentFrame(currentFrame);

    trackDirectionRef.current = direction;
    setIsTracking(true);
  };

  const handleStopTracking = () => {
    setIsTracking(false);
  };

  const handleResetPoints = () => {
    selectPreset(currentPreset);
    showToast('info', 'Tracker points and keyframe history reset.');
  };

  // Export Keyframes to Timeline Clip (Object or Text)
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const handleExportToTimeline = async (targetTypeOverride?: 'object' | 'text') => {
    if (processedKeyframes.length === 0) {
      showToast('error', 'No keyframes recorded yet. Please track an object first.');
      return;
    }

    const currentTargetType = targetTypeOverride || exportSettings.targetType || 'object';
    const settingsToSend: ExportSettings = {
      ...exportSettings,
      targetType: currentTargetType,
    };

    setIsExporting(true);
    const result = await bridge.applyTrackingData(processedKeyframes, settingsToSend);
    setIsExporting(false);

    if (result.success) {
      const targetLabel = currentTargetType === 'text' ? 'Text Layer' : 'Object / Graphic';
      if (result.isSimulated) {
        setExportSettings(settingsToSend);
        setIsInspectorOpen(true);
        showToast(
          'info',
          `Click "⚡ 1-Click Update Plugin & Apply Keyframes (.bat)" in the modal to inject all ${processedKeyframes.length} keyframes into Premiere Pro!`
        );
      } else {
        showToast(
          'success',
          result.data?.message || `Successfully applied ${processedKeyframes.length} keyframes to ${targetLabel}!`
        );
      }
    } else {
      showToast('error', result.error || 'Failed to export keyframes to timeline.');
    }
  };

  // Copy universal Adobe AE / Premiere Keyframe text to clipboard
  const handleCopyKeyframeText = async () => {
    if (processedKeyframes.length === 0) {
      showToast('error', 'No keyframes to copy. Track an object first.');
      return;
    }

    const textData = generateAdobeKeyframeText(processedKeyframes, {
      fps: fps,
      width: 1920,
      height: 1080,
      canvasWidth: 640,
      canvasHeight: 360,
      exportPosition: exportSettings.exportPosition,
      exportScale: exportSettings.exportScale,
      exportRotation: exportSettings.exportRotation,
      exportCornerPin3D: exportSettings.exportCornerPin3D,
      enableMotionBlur: exportSettings.enableMotionBlur,
      shutterAngle: exportSettings.shutterAngle ?? 180,
    });

    const ok = await copyToClipboard(textData);
    if (ok) {
      showToast(
        'success',
        'Copied Adobe Keyframes to clipboard! Select any Text or Object in Premiere and press Ctrl+V to paste.'
      );
    } else {
      setIsInspectorOpen(true);
      showToast('info', 'Opened Keyframe Inspector — select and press Ctrl+C to copy.');
    }
  };

  // Copy JSON payload to clipboard
  const handleCopyJson = async () => {
    if (processedKeyframes.length === 0) {
      showToast('error', 'No keyframes to copy.');
      return;
    }

    const payload = {
      settings: exportSettings,
      keyframes: processedKeyframes,
    };
    const ok = await copyToClipboard(JSON.stringify(payload, null, 2));
    if (ok) {
      showToast('success', 'Copied tracking data JSON to clipboard!');
    } else {
      setIsInspectorOpen(true);
      showToast('info', 'Opened Payload Inspector to copy JSON.');
    }
  };

  // Camera Follow Mode (e.g. Football / Ball Tracking Reframing)
  const handleApplyCameraFollow = async () => {
    if (processedKeyframes.length === 0) {
      showToast('error', 'No keyframes recorded yet. Track the ball or object first.');
      return;
    }

    const settingsToSend: ExportSettings = {
      ...exportSettings,
      isCameraFollow: true,
      cameraFollowZoom: exportSettings.cameraFollowZoom || 125,
      exportPosition: true,
      exportScale: true,
      exportRotation: false,
    };

    setIsExporting(true);
    const result = await bridge.applyTrackingData(processedKeyframes, settingsToSend);
    setIsExporting(false);

    if (result.success) {
      if (result.isSimulated) {
        setExportSettings(settingsToSend);
        setIsInspectorOpen(true);
        showToast(
          'info',
          `Click "⚡ 1-Click Update Plugin & Apply Keyframes (.bat)" in the modal to apply Camera Follow to your Premiere Pro clip!`
        );
      } else {
        showToast('success', result.data?.message || 'Camera Follow applied! Camera view is now locked to the ball/point.');
      }
    } else {
      showToast('error', result.error || 'Failed to apply Camera Follow.');
    }
  };

  const handleCopyCameraFollowText = async () => {
    if (processedKeyframes.length === 0) {
      showToast('error', 'No keyframes to copy. Track the ball or object first.');
      return;
    }

    const textData = generateAdobeKeyframeText(processedKeyframes, {
      fps: fps,
      width: 1920,
      height: 1080,
      canvasWidth: 640,
      canvasHeight: 360,
      isCameraFollow: true,
      cameraFollowZoom: exportSettings.cameraFollowZoom || 125,
    });

    const ok = await copyToClipboard(textData);
    if (ok) {
      showToast(
        'success',
        'Copied Camera Follow Keyframes! Select your video clip in Premiere and press Ctrl+V to lock camera onto the ball.'
      );
    } else {
      setIsInspectorOpen(true);
      showToast('info', 'Opened Keyframe Inspector — select and press Ctrl+C to copy.');
    }
  };

  // Video Stabilization Mode (Anti-Shake / Lock-Down)
  const handleApplyStabilize = async () => {
    if (processedKeyframes.length === 0) {
      showToast('error', 'No keyframes recorded yet. Track a reference feature on the shaky clip first.');
      return;
    }

    const settingsToSend: ExportSettings = {
      ...exportSettings,
      isCameraFollow: false,
      isStabilize: true,
      stabilizeStrength: exportSettings.stabilizeStrength ?? 100,
      stabilizeZoom: exportSettings.stabilizeZoom || 115,
      exportPosition: true,
      exportScale: true,
      exportRotation: pointCountMode >= 2,
    };

    setIsExporting(true);
    const result = await bridge.applyTrackingData(processedKeyframes, settingsToSend);
    setIsExporting(false);

    if (result.success) {
      if (result.isSimulated) {
        setExportSettings(settingsToSend);
        setIsInspectorOpen(true);
        showToast(
          'info',
          `Click "⚡ 1-Click Update Plugin & Apply Keyframes (.bat)" in the modal to stabilize your Premiere Pro clip!`
        );
      } else {
        showToast(
          'success',
          result.data?.message ||
            `Video Stabilization applied (${settingsToSend.stabilizeStrength}% strength, ${settingsToSend.stabilizeZoom}% zoom)!`
        );
      }
    } else {
      showToast('error', result.error || 'Failed to apply Video Stabilization.');
    }
  };

  const handleCopyStabilizeText = async () => {
    if (processedKeyframes.length === 0) {
      showToast('error', 'No keyframes to copy. Track a reference feature first.');
      return;
    }

    const textData = generateAdobeKeyframeText(processedKeyframes, {
      fps: fps,
      width: 1920,
      height: 1080,
      canvasWidth: 640,
      canvasHeight: 360,
      isStabilize: true,
      stabilizeStrength: exportSettings.stabilizeStrength ?? 100,
      stabilizeZoom: exportSettings.stabilizeZoom || 115,
      exportRotation: pointCountMode >= 2,
    });

    const ok = await copyToClipboard(textData);
    if (ok) {
      showToast(
        'success',
        'Copied Stabilization Keyframes! Select your shaky video clip in Premiere and press Ctrl+V to stabilize.'
      );
    } else {
      setIsInspectorOpen(true);
      showToast('info', 'Opened Keyframe Inspector — select and press Ctrl+C to copy.');
    }
  };

  return (
    <div className="min-h-screen bg-[#141414] text-gray-100 flex flex-col font-sans select-none">
      {/* Off-screen Video Element for real video files */}
      <video
        ref={videoRef}
        preload="auto"
        playsInline
        muted
        crossOrigin="anonymous"
        style={{ position: 'fixed', top: '-9999px', left: '-9999px', opacity: 0, pointerEvents: 'none' }}
      />

      {/* Top Header */}
      <Header
        isCEP={isCEP}
        trackingMode={trackingMode}
        onSelectMode={handleSelectTrackingMode}
        onOpenExtensionFiles={() => setIsFilesModalOpen(true)}
        onOpenPayloadInspector={() => setIsInspectorOpen(true)}
        hasKeyframes={processedKeyframes.length > 0}
        keyframesCount={processedKeyframes.length}
        useGPU={useGPU}
        isGPUSupported={gpuInfo.isSupported}
        gpuRendererName={gpuInfo.rendererName}
        onToggleGPU={() => {
          setUseGPU((prev) => {
            const next = !prev;
            showToast(
              'info',
              next
                ? `Switched to WebGL GPU Shader Acceleration (${gpuInfo.rendererName})`
                : 'Switched to CPU Integral-Image NCC Engine'
            );
            return next;
          });
        }}
      />

      {/* Toast Notification Alert */}
      {toast && (
        <div
          className={`fixed top-14 right-4 z-50 flex items-center gap-2 px-4 py-2.5 rounded-md shadow-2xl text-xs font-medium border transition-all animate-in fade-in slide-in-from-top-2 ${
            toast.type === 'success'
              ? 'bg-emerald-950 border-emerald-600/50 text-emerald-200'
              : toast.type === 'error'
              ? 'bg-rose-950 border-rose-600/50 text-rose-200'
              : 'bg-blue-950 border-blue-600/50 text-blue-200'
          }`}
        >
          {toast.type === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
          {toast.type === 'error' && <AlertTriangle className="w-4 h-4 text-rose-400" />}
          {toast.type === 'info' && <Info className="w-4 h-4 text-blue-400" />}
          <span>{toast.message}</span>
        </div>
      )}

      {/* Main Workspace */}
      <main className="flex-1 p-3 max-w-[1440px] w-full mx-auto grid grid-cols-1 lg:grid-cols-12 gap-3">
        {/* Left / Center Viewport Column */}
        <div className="lg:col-span-7 xl:col-span-8 flex flex-col gap-3">
          {/* Interactive Video & Canvas Viewport */}
          <ViewportCanvas
            videoRef={videoRef}
            canvasRef={canvasRef}
            cleanCanvasRef={cleanCanvasRef}
            points={points}
            pointCountMode={pointCountMode}
            onUpdatePoint={handleUpdatePoint}
            onMoveAllPoints={handleMoveAllPoints}
            rawKeyframes={rawKeyframes}
            processedKeyframes={processedKeyframes}
            currentFrame={currentFrame}
            totalFrames={totalFrames}
            currentTime={currentTime}
            fps={fps}
            isTracking={isTracking}
            onDropVideoFile={handleLoadLocalFile}
            onSnapToFeature={handleSnapToFeature}
            offsetX={exportSettings.offsetX}
            offsetY={exportSettings.offsetY}
            onUpdateOffset={(ox, oy) =>
              setExportSettings((prev) => ({ ...prev, offsetX: ox, offsetY: oy }))
            }
            enableMotionBlur={exportSettings.enableMotionBlur}
            shutterAngle={exportSettings.shutterAngle ?? 180}
          />

          {/* Transport & Tracking Step Controls */}
          <TransportControls
            isPlaying={isPlaying}
            isTracking={isTracking}
            currentFrame={currentFrame}
            totalFrames={totalFrames}
            currentTime={currentTime}
            duration={duration}
            fps={fps}
            onTogglePlay={handleTogglePlay}
            onStepFrame={handleStepFrame}
            onTrackForward={() => handleStartTracking(1)}
            onTrackBackward={() => handleStartTracking(-1)}
            onBiDirectionalRefine={handleBiDirectionalRefine}
            onStopTracking={handleStopTracking}
            onSeekFrame={handleSeekFrame}
            keyframesCount={rawKeyframes.length}
            trackedFrameNumbers={rawKeyframes.map((k) => k.frameNumber)}
            onKeepUpToPlayhead={() => handleDeleteRange(currentFrame + 1, 999999)}
            onDeleteBeforePlayhead={() => handleDeleteRange(0, Math.max(0, currentFrame - 1))}
            onTrimByTimeRange={handleTrimByTimeRange}
            onClearAllKeyframes={handleClearAllKeyframes}
          />

          {/* Interactive Keyframe & Track Data Editor */}
          <TrackDataEditor
            keyframes={processedKeyframes}
            currentFrame={currentFrame}
            fps={fps}
            onSelectFrame={handleSeekFrame}
            onUpdateKeyframe={handleUpdateKeyframe}
            onDeleteKeyframe={handleDeleteKeyframe}
            onDeleteRange={handleDeleteRange}
            onClearAll={handleClearAllKeyframes}
            isOpen={isTrackEditorOpen}
            onToggleOpen={() => setIsTrackEditorOpen((v) => !v)}
          />
        </div>

        {/* Right Settings & Post-Processing Column */}
        <div className="lg:col-span-5 xl:col-span-4 flex flex-col gap-3">
          <TrackSettingsPanel
            pointCountMode={pointCountMode}
            onChangePointCountMode={handleChangePointCountMode}
            onSpreadSurfaceQuad={handleSpreadSurfaceQuad}
            onApplySurfacePreset={handleApplySurfacePreset}
            points={points}
            onUpdatePoint={handleUpdatePoint}
            featureSize={points['p1']?.featureSize || 28}
            onChangeFeatureSize={(val) => {
              setPoints((prev) => ({
                ...prev,
                p1: { ...prev.p1, featureSize: val },
                p2: { ...prev.p2, featureSize: val },
                p3: { ...(prev.p3 || prev.p1), id: 'p3', featureSize: val },
                p4: { ...(prev.p4 || prev.p1), id: 'p4', featureSize: val },
              }));
            }}
            searchSize={points['p1']?.searchSize || 64}
            onChangeSearchSize={(val) => {
              setPoints((prev) => ({
                ...prev,
                p1: { ...prev.p1, searchSize: val },
                p2: { ...prev.p2, searchSize: val },
                p3: { ...(prev.p3 || prev.p1), id: 'p3', searchSize: val },
                p4: { ...(prev.p4 || prev.p1), id: 'p4', searchSize: val },
              }));
            }}
            onResetPoints={handleResetPoints}
            onSelectPreset={selectPreset}
            selectedPresetId={selectedPresetId}
            onSelectLocalFile={handleLoadLocalFile}
            onLoadTimelineClip={handleLoadTimelineClip}
            timelineClips={timelineClips}
            onSelectTimelineClip={handleSelectTimelineClip}
            isLoadingClip={isLoadingClip}
            isCEP={isCEP}
            onSnapToFeature={() => handleSnapToFeature()}
            autoPauseEnabled={autoPauseEnabled}
            autoPauseThreshold={autoPauseThreshold}
            onChangeAutoPause={(enabled, threshold) => {
              setAutoPauseEnabled(enabled);
              setAutoPauseThreshold(threshold);
            }}
            rippleEditEnabled={rippleEditEnabled}
            onChangeRippleEdit={setRippleEditEnabled}
          />

          {/* Post-Processing, Gaussian Smoothing, and Export to Timeline */}
          <PostProcessingPanel
            settings={exportSettings}
            onUpdateSettings={(newSettings) =>
              setExportSettings((prev) => ({ ...prev, ...newSettings }))
            }
            onExportToTimeline={(targetType) => {
              setExportSettings((prev) => ({ ...prev, isCameraFollow: false, isStabilize: false }));
              handleExportToTimeline(targetType);
            }}
            onApplyCameraFollow={handleApplyCameraFollow}
            onApplyStabilize={handleApplyStabilize}
            onCopyKeyframeText={handleCopyKeyframeText}
            onCopyCameraFollowText={handleCopyCameraFollowText}
            onCopyStabilizeText={handleCopyStabilizeText}
            onCopyJson={handleCopyJson}
            isExporting={isExporting}
            keyframesCount={processedKeyframes.length}
            isCEP={isCEP}
          />
        </div>
      </main>

      {/* Extension Files Export & Code Viewer Modal */}
      <ExtensionFilesModal
        isOpen={isFilesModalOpen}
        onClose={() => setIsFilesModalOpen(false)}
      />

      {/* Payload Inspector Modal */}
      <PayloadInspectorModal
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        keyframes={processedKeyframes}
        settings={exportSettings}
      />
    </div>
  );
}
