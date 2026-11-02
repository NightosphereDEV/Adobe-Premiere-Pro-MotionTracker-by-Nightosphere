import React, { useRef, useMemo } from 'react';
import { Target, Sliders, RotateCcw, Video, FolderOpen, RefreshCw, Box, Maximize2, Monitor, Smartphone, LayoutGrid, Compass } from 'lucide-react';
import { DEMO_PRESETS, DemoPreset } from '../utils/proceduralVideo';
import { ADOBE_VIDEO_ACCEPT, compute3DSurfacePose } from '../utils/math';

import { TimelineClipItem, PointCountMode, TrackerPoint } from '../types/tracker';

export type SurfaceShapePreset = '16:9-screen' | '9:16-phone' | '4:3-sign' | '3d-angled';

interface TrackSettingsPanelProps {
  pointCountMode: PointCountMode;
  onChangePointCountMode: (mode: PointCountMode) => void;
  onSpreadSurfaceQuad?: () => void;
  onApplySurfacePreset?: (preset: SurfaceShapePreset) => void;
  points?: { [id: string]: TrackerPoint };
  onUpdatePoint?: (id: string, coords: { x: number; y: number }) => void;
  featureSize: number;
  onChangeFeatureSize: (val: number) => void;
  searchSize: number;
  onChangeSearchSize: (val: number) => void;
  onSnapToFeature?: () => void;
  autoPauseEnabled?: boolean;
  autoPauseThreshold?: number;
  onChangeAutoPause?: (enabled: boolean, threshold?: number) => void;
  rippleEditEnabled?: boolean;
  onChangeRippleEdit?: (enabled: boolean) => void;
  onResetPoints: () => void;
  onSelectPreset: (preset: DemoPreset) => void;
  selectedPresetId: string;
  onSelectLocalFile: (file: File) => void;
  onLoadTimelineClip: () => void;
  timelineClips: TimelineClipItem[];
  onSelectTimelineClip: (clip: TimelineClipItem) => void;
  isLoadingClip: boolean;
  isCEP: boolean;
}

export const TrackSettingsPanel: React.FC<TrackSettingsPanelProps> = ({
  pointCountMode,
  onChangePointCountMode,
  onSpreadSurfaceQuad,
  onApplySurfacePreset,
  points,
  onUpdatePoint,
  featureSize,
  onChangeFeatureSize,
  searchSize,
  onChangeSearchSize,
  onSnapToFeature,
  autoPauseEnabled = true,
  autoPauseThreshold = 55,
  onChangeAutoPause,
  rippleEditEnabled = true,
  onChangeRippleEdit,
  onResetPoints,
  onSelectPreset,
  selectedPresetId,
  onSelectLocalFile,
  onLoadTimelineClip,
  isLoadingClip,
  isCEP,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onSelectLocalFile(e.target.files[0]);
      e.target.value = '';
    }
  };

  // Compute live 3D Surface Pose telemetry when in 4-Pin Surface Mode
  const liveSurfacePose = useMemo(() => {
    if (pointCountMode !== 4 || !points?.p1 || !points?.p2 || !points?.p3 || !points?.p4) {
      return null;
    }
    const cur = {
      p1: { x: points.p1.x, y: points.p1.y },
      p2: { x: points.p2.x, y: points.p2.y },
      p3: { x: points.p3.x, y: points.p3.y },
      p4: { x: points.p4.x, y: points.p4.y },
    };
    const ref = {
      p1: { x: 185, y: 100 },
      p2: { x: 455, y: 100 },
      p3: { x: 455, y: 260 },
      p4: { x: 185, y: 260 },
    };
    return compute3DSurfacePose(cur, ref);
  }, [pointCountMode, points]);

  const pinEntries: Array<{ id: 'p1' | 'p2' | 'p3' | 'p4'; label: string; badge: string; color: string }> = [
    { id: 'p1', label: 'Upper-Left', badge: 'P1 TL', color: '#3ea6ff' },
    { id: 'p2', label: 'Upper-Right', badge: 'P2 TR', color: '#ff4444' },
    { id: 'p3', label: 'Lower-Right', badge: 'P3 BR', color: '#10b981' },
    { id: 'p4', label: 'Lower-Left', badge: 'P4 BL', color: '#f59e0b' },
  ];

  return (
    <div className="bg-[#1f1f1f] rounded-md border border-[#2d2d2d] p-3 flex flex-col gap-3 shadow-sm select-none">
      {/* Clip Source & Input Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <Video className="w-4 h-4 text-[#3ea6ff]" />
          <span className="text-xs font-semibold text-gray-200">Clip Source</span>
        </div>

        <div className="flex items-center gap-1.5">
          {isCEP ? (
            <button
              onClick={onLoadTimelineClip}
              disabled={isLoadingClip}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#1473e6] hover:bg-[#0d66d0] text-white rounded text-xs font-medium transition-colors"
            >
              <RefreshCw className={`w-3 h-3 ${isLoadingClip ? 'animate-spin' : ''}`} />
              <span>Load from Timeline</span>
            </button>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept={ADOBE_VIDEO_ACCEPT}
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 px-2.5 py-1 bg-[#2a2a2a] hover:bg-[#353535] text-gray-200 rounded text-xs font-medium border border-[#3c3c3c] transition-colors"
                title="Load any Adobe Premiere Pro supported video (.MP4, .TS, .MTS, .MKV, .MOV, .MXF, .AVI, .WMV, .MPG, .WEBM)"
              >
                <FolderOpen className="w-3 h-3 text-[#3ea6ff]" />
                <span>Load Video (.MP4, .TS, .MKV, .MOV...)</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Preset Demo Footages (dev mode or testing) */}
      {!isCEP && (
        <div className="flex flex-col gap-1.5 bg-[#171717] p-2 rounded border border-[#262626]">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-medium">
            Dev Test Presets (Instant Render)
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            {DEMO_PRESETS.map((p) => {
              const active = selectedPresetId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => onSelectPreset(p)}
                  className={`px-2 py-1.5 rounded text-[11px] text-left transition-colors border ${
                    active
                      ? 'bg-[#2b3548] border-[#3ea6ff] text-white font-medium'
                      : 'bg-[#222222] border-[#2f2f2f] text-gray-300 hover:bg-[#282828]'
                  }`}
                >
                  <span className="block truncate">{p.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Tracking Mode: 1-Point vs 2-Point vs 4-Pin 3D Surface */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
            <Target className="w-3.5 h-3.5 text-[#3ea6ff]" />
            <span>Tracking Method</span>
          </div>
          <div className="flex items-center gap-2">
            {pointCountMode === 4 && onSpreadSurfaceQuad && (
              <button
                onClick={onSpreadSurfaceQuad}
                className="flex items-center gap-1 text-[11px] text-[#3ea6ff] hover:text-blue-300 transition-colors"
                title="Spread 4 corner pins into a screen quad"
              >
                <Maximize2 className="w-3 h-3" />
                <span>Spread Quad</span>
              </button>
            )}
            <button
              onClick={onResetPoints}
              className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-white transition-colors"
              title="Reset tracker points to center"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Pins</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => onChangePointCountMode(1)}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded text-[11px] font-medium border transition-colors ${
              pointCountMode === 1
                ? 'bg-[#273549] border-[#3ea6ff] text-white shadow-sm'
                : 'bg-[#252525] border-[#333333] text-gray-300 hover:bg-[#2b2b2b]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#3ea6ff] shrink-0"></span>
            <span className="truncate">1-Point (Pos)</span>
          </button>

          <button
            onClick={() => onChangePointCountMode(2)}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded text-[11px] font-medium border transition-colors ${
              pointCountMode === 2
                ? 'bg-[#273549] border-[#3ea6ff] text-white shadow-sm'
                : 'bg-[#252525] border-[#333333] text-gray-300 hover:bg-[#2b2b2b]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-[#ff4444] shrink-0"></span>
            <span className="truncate">2-Point (2D)</span>
          </button>

          <button
            onClick={() => onChangePointCountMode(4)}
            className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded text-[11px] font-semibold border transition-colors ${
              pointCountMode === 4
                ? 'bg-gradient-to-r from-[#1f2f4d] to-[#2e1f4d] border-[#a855f7] text-white shadow-sm'
                : 'bg-[#252525] border-[#333333] text-gray-300 hover:bg-[#2b2b2b]'
            }`}
            title="Free-form 4-Pin Planar Surface & 3D Perspective Tracker (Monitors, Screens, Phones, Signs)"
          >
            <Box className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span className="truncate">4-Pin 3D Surface</span>
          </button>
        </div>

        {pointCountMode === 4 && (
          <div className="bg-[#181424] border border-purple-500/40 rounded p-2.5 text-[11px] text-purple-200 leading-snug flex flex-col gap-2">
            <div className="flex items-center justify-between font-semibold text-purple-300">
              <span>🧊 4-Pin Free-Edit 3D Surface Studio</span>
              <span className="font-mono text-[10px] bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-700/50">
                UNCONFINED 4-PIN
              </span>
            </div>
            <p className="text-gray-300 text-[10.5px]">
              Drag any of the <strong>4 corner pins (P1–P4)</strong> freely anywhere on the video (zero area confinement), drag inside the quad to move the whole surface, or fine-tune each pin below:
            </p>

            {/* Quick Surface Shape Presets */}
            {onApplySurfacePreset && (
              <div className="grid grid-cols-4 gap-1">
                <button
                  onClick={() => onApplySurfacePreset('16:9-screen')}
                  className="flex items-center justify-center gap-1 py-1 px-1.5 rounded bg-[#231d33] hover:bg-[#2f2645] border border-purple-500/30 text-[10px] text-purple-200 transition-colors"
                  title="Place 4 pins in a 16:9 TV / Monitor aspect quad"
                >
                  <Monitor className="w-3 h-3 text-purple-400" />
                  <span>16:9 TV</span>
                </button>
                <button
                  onClick={() => onApplySurfacePreset('9:16-phone')}
                  className="flex items-center justify-center gap-1 py-1 px-1.5 rounded bg-[#231d33] hover:bg-[#2f2645] border border-purple-500/30 text-[10px] text-purple-200 transition-colors"
                  title="Place 4 pins in a vertical 9:16 Phone screen quad"
                >
                  <Smartphone className="w-3 h-3 text-purple-400" />
                  <span>Phone</span>
                </button>
                <button
                  onClick={() => onApplySurfacePreset('4:3-sign')}
                  className="flex items-center justify-center gap-1 py-1 px-1.5 rounded bg-[#231d33] hover:bg-[#2f2645] border border-purple-500/30 text-[10px] text-purple-200 transition-colors"
                  title="Place 4 pins in a 4:3 Sign / Poster quad"
                >
                  <LayoutGrid className="w-3 h-3 text-purple-400" />
                  <span>4:3 Sign</span>
                </button>
                <button
                  onClick={() => onApplySurfacePreset('3d-angled')}
                  className="flex items-center justify-center gap-1 py-1 px-1.5 rounded bg-[#231d33] hover:bg-[#2f2645] border border-purple-500/30 text-[10px] text-purple-200 transition-colors"
                  title="Place 4 pins in a 3D perspective angled trapezoid"
                >
                  <Compass className="w-3 h-3 text-purple-400" />
                  <span>3D Tilt</span>
                </button>
              </div>
            )}

            {/* 4-Pin Free-Edit Coordinate Fine-Tuners */}
            {points && onUpdatePoint && (
              <div className="grid grid-cols-2 gap-1.5 pt-1 border-t border-purple-800/40">
                {pinEntries.map((pin) => {
                  const pt = points[pin.id];
                  if (!pt) return null;
                  return (
                    <div
                      key={pin.id}
                      className="bg-[#120f1d] border border-purple-900/60 rounded px-2 py-1 flex items-center justify-between gap-1"
                    >
                      <div className="flex items-center gap-1">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: pin.color }}
                        />
                        <span className="font-mono text-[10px] font-semibold text-gray-200">
                          {pin.badge}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 font-mono text-[10px]">
                        <input
                          type="number"
                          value={Math.round(pt.x)}
                          min={0}
                          max={640}
                          onChange={(e) =>
                            onUpdatePoint(pin.id, {
                              x: Math.max(0, Math.min(640, Number(e.target.value) || 0)),
                              y: pt.y,
                            })
                          }
                          className="w-11 bg-[#1d182b] border border-purple-700/40 rounded px-1 py-0.5 text-right text-gray-100"
                          title={`${pin.label} X coordinate`}
                        />
                        <input
                          type="number"
                          value={Math.round(pt.y)}
                          min={0}
                          max={360}
                          onChange={(e) =>
                            onUpdatePoint(pin.id, {
                              x: pt.x,
                              y: Math.max(0, Math.min(360, Number(e.target.value) || 0)),
                            })
                          }
                          className="w-11 bg-[#1d182b] border border-purple-700/40 rounded px-1 py-0.5 text-right text-gray-100"
                          title={`${pin.label} Y coordinate`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Live 3D Pose Telemetry */}
            {liveSurfacePose && (
              <div className="grid grid-cols-4 gap-1 pt-1 border-t border-purple-800/40 font-mono text-[10px]">
                <div className="bg-[#120f1d] rounded px-1.5 py-1 text-center border border-purple-900/50">
                  <span className="block text-[9px] text-gray-400">3D YAW</span>
                  <span className="text-purple-300 font-semibold">
                    {liveSurfacePose.yaw3D >= 0 ? '+' : ''}
                    {liveSurfacePose.yaw3D.toFixed(1)}°
                  </span>
                </div>
                <div className="bg-[#120f1d] rounded px-1.5 py-1 text-center border border-purple-900/50">
                  <span className="block text-[9px] text-gray-400">3D PITCH</span>
                  <span className="text-purple-300 font-semibold">
                    {liveSurfacePose.pitch3D >= 0 ? '+' : ''}
                    {liveSurfacePose.pitch3D.toFixed(1)}°
                  </span>
                </div>
                <div className="bg-[#120f1d] rounded px-1.5 py-1 text-center border border-purple-900/50">
                  <span className="block text-[9px] text-gray-400">2D ROLL</span>
                  <span className="text-cyan-300 font-semibold">
                    {liveSurfacePose.rotation >= 0 ? '+' : ''}
                    {liveSurfacePose.rotation.toFixed(1)}°
                  </span>
                </div>
                <div className="bg-[#120f1d] rounded px-1.5 py-1 text-center border border-purple-900/50">
                  <span className="block text-[9px] text-gray-400">SCALE X/Y</span>
                  <span className="text-emerald-300 font-semibold">
                    {Math.round(liveSurfacePose.scaleX)}/{Math.round(liveSurfacePose.scaleY)}%
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Precision Small-Point & Dual-Ring Search Controls */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#2a2a2a]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-200">
            Precision Point & Dual-Ring Search
          </span>
          {onSnapToFeature && (
            <button
              type="button"
              onClick={onSnapToFeature}
              className="flex items-center gap-1 px-2 py-0.5 bg-[#1a2c3e] hover:bg-[#233d56] text-cyan-300 border border-cyan-500/40 rounded text-[10px] font-medium transition-colors"
              title="Scans a 16px radius around active tracking pin(s) using a Shi-Tomasi corner detector and snaps to the sharpest high-contrast pixel (or Shift+Click on canvas)"
            >
              <span>🧲</span>
              <span>Snap to Strongest Corner</span>
            </button>
          )}
        </div>

        {/* 1-Click Dual-Ring Presets for Tiny Screen Dots vs Fast Motion */}
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => {
              onChangeFeatureSize(8);
              onChangeSearchSize(44);
            }}
            className={`py-1 px-1 rounded text-[10px] font-medium border transition-colors ${
              featureSize <= 10
                ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200'
                : 'bg-[#252525] border-[#333333] text-gray-300 hover:bg-[#2d2d2d]'
            }`}
            title="8px Inner Ring / 44px Outer Search: Ideal for tracking a singular tiny pixel, LED, or small icon on a screen"
          >
            8px Micro Dot
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeFeatureSize(16);
              onChangeSearchSize(56);
            }}
            className={`py-1 px-1 rounded text-[10px] font-medium border transition-colors ${
              featureSize > 10 && featureSize <= 20
                ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200'
                : 'bg-[#252525] border-[#333333] text-gray-300 hover:bg-[#2d2d2d]'
            }`}
            title="16px Inner Ring / 56px Outer Search: Ideal for sharp screen corners, UI buttons, and small markers"
          >
            16px Corner
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeFeatureSize(28);
              onChangeSearchSize(64);
            }}
            className={`py-1 px-1 rounded text-[10px] font-medium border transition-colors ${
              featureSize > 20 && searchSize <= 80
                ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200'
                : 'bg-[#252525] border-[#333333] text-gray-300 hover:bg-[#2d2d2d]'
            }`}
            title="28px Inner Ring / 64px Outer Search: Balanced for general objects, faces, and vehicles"
          >
            28px Standard
          </button>
          <button
            type="button"
            onClick={() => {
              onChangeFeatureSize(32);
              onChangeSearchSize(112);
            }}
            className={`py-1 px-1 rounded text-[10px] font-medium border transition-colors ${
              searchSize > 80
                ? 'bg-cyan-950/80 border-cyan-400 text-cyan-200'
                : 'bg-[#252525] border-[#333333] text-gray-300 hover:bg-[#2d2d2d]'
            }`}
            title="32px Inner Ring / 112px Wide Search: Ideal for fast camera whip-pans and sports balls"
          >
            112px Fast
          </button>
        </div>

        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-gray-300">
            <Sliders className="w-3.5 h-3.5 text-[#3ea6ff]" />
            <span>Feature Box (Inner Target):</span>
          </div>
          <span className="font-mono text-xs text-[#3ea6ff] bg-[#171717] px-1.5 py-0.5 rounded border border-[#2b2b2b]">
            {featureSize}px
          </span>
        </div>
        <input
          type="range"
          min={8}
          max={64}
          step={2}
          aria-label="Feature Box Inner Target Size"
          value={featureSize}
          onChange={(e) => onChangeFeatureSize(parseInt(e.target.value, 10))}
          className="w-full h-1.5 bg-[#333333] rounded-lg appearance-none cursor-pointer accent-[#3ea6ff]"
        />

        <div className="flex items-center justify-between text-xs mt-0.5">
          <div className="flex items-center gap-1.5 text-gray-300">
            <Sliders className="w-3.5 h-3.5 text-emerald-400" />
            <span>Search Window (Outer Region):</span>
          </div>
          <span className="font-mono text-xs text-emerald-400 bg-[#171717] px-1.5 py-0.5 rounded border border-[#2b2b2b]">
            {searchSize}px
          </span>
        </div>
        <input
          type="range"
          min={28}
          max={140}
          step={4}
          aria-label="Search Window Outer Region Size"
          value={searchSize}
          onChange={(e) => onChangeSearchSize(parseInt(e.target.value, 10))}
          className="w-full h-1.5 bg-[#333333] rounded-lg appearance-none cursor-pointer accent-emerald-400"
        />

        {/* Smart Tracking Assistants: Ripple Nudge & Auto-Pause on Low Confidence */}
        <div className="bg-[#17171b] border border-[#2b2b36] rounded p-2 flex flex-col gap-1.5 mt-1">
          {onChangeRippleEdit && (
            <label
              className="flex items-center justify-between text-[11px] text-gray-200 cursor-pointer"
              title="When you manually drag a pin on an already-tracked frame to fix drift, automatically smooths neighboring +-8 frames so there is no jump"
            >
              <span>✨ 1-Drag Ripple Drift Fix (±8 frames)</span>
              <input
                type="checkbox"
                checked={rippleEditEnabled}
                onChange={(e) => onChangeRippleEdit(e.target.checked)}
                className="rounded accent-[#3ea6ff]"
              />
            </label>
          )}

          {onChangeAutoPause && (
            <div className="flex flex-col gap-1 pt-1 border-t border-[#25252e]">
              <div className="flex items-center justify-between text-[11px]">
                <label
                  className="flex items-center gap-1.5 text-gray-200 cursor-pointer"
                  title="Automatically pauses tracking if object gets blocked/occluded and match confidence drops below threshold"
                >
                  <input
                    type="checkbox"
                    checked={autoPauseEnabled}
                    onChange={(e) => onChangeAutoPause(e.target.checked, autoPauseThreshold)}
                    className="rounded accent-amber-400"
                  />
                  <span>🛑 Auto-Pause on Occlusion / Low Conf</span>
                </label>
                <span className="font-mono text-[10px] text-amber-300">
                  &lt; {autoPauseThreshold}%
                </span>
              </div>
              {autoPauseEnabled && (
                <input
                  type="range"
                  min={35}
                  max={85}
                  step={5}
                  aria-label="Auto-Pause Confidence Threshold"
                  value={autoPauseThreshold}
                  onChange={(e) =>
                    onChangeAutoPause(true, parseInt(e.target.value, 10))
                  }
                  className="w-full h-1 bg-[#2c2c35] rounded appearance-none cursor-pointer accent-amber-400"
                />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
