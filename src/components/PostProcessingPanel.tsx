import React from 'react';
import { SlidersHorizontal, Sparkles, CheckSquare, Move, Zap } from 'lucide-react';
import { ExportSettings } from '../types/tracker';

interface PostProcessingPanelProps {
  settings: ExportSettings;
  onUpdateSettings: (newSettings: Partial<ExportSettings>) => void;
  onExportToTimeline: (targetType?: 'object' | 'text') => void;
  onApplyCameraFollow: () => void;
  onApplyStabilize: () => void;
  onCopyKeyframeText: () => void;
  onCopyCameraFollowText: () => void;
  onCopyStabilizeText: () => void;
  onCopyJson: () => void;
  isExporting: boolean;
  keyframesCount: number;
  isCEP: boolean;
}

export const PostProcessingPanel: React.FC<PostProcessingPanelProps> = ({
  settings,
  onUpdateSettings,
  onExportToTimeline,
  onApplyCameraFollow,
  onApplyStabilize,
  onCopyKeyframeText,
  onCopyCameraFollowText,
  onCopyStabilizeText,
  onCopyJson,
  isExporting,
  keyframesCount,
  isCEP,
}) => {
  return (
    <div className="bg-[#1f1f1f] rounded-md border border-[#2d2d2d] p-3 flex flex-col gap-3 shadow-sm select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-[#3ea6ff]" />
          <span className="text-xs font-semibold text-gray-200">Smoothing & Export</span>
        </div>
        <span className="text-[11px] text-gray-400 font-mono">
          {keyframesCount} points ready
        </span>
      </div>

      {/* Target Type Selector: Object vs Text */}
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">
          Pin Target Destination:
        </span>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onUpdateSettings({ targetType: 'object' })}
            className={`flex items-center justify-center gap-2 py-2 px-2.5 rounded text-xs font-medium border transition-all ${
              (settings.targetType || 'object') === 'object'
                ? 'bg-[#182a44] border-[#3ea6ff] text-white shadow-sm'
                : 'bg-[#252525] border-[#333333] text-gray-400 hover:text-gray-200'
            }`}
          >
            <span>🎯</span>
            <span>Object / Graphic</span>
          </button>

          <button
            type="button"
            onClick={() => onUpdateSettings({ targetType: 'text' })}
            className={`flex items-center justify-center gap-2 py-2 px-2.5 rounded text-xs font-medium border transition-all ${
              settings.targetType === 'text'
                ? 'bg-[#182a44] border-[#3ea6ff] text-white shadow-sm'
                : 'bg-[#252525] border-[#333333] text-gray-400 hover:text-gray-200'
            }`}
          >
            <span>✍️</span>
            <span>Text Layer / Title</span>
          </button>
        </div>
      </div>

      {/* Gaussian Smoothing Slider */}
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-gray-300">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Gaussian Smoothing:</span>
          </div>
          <span className="font-mono text-xs text-amber-400 bg-[#171717] px-2 py-0.5 rounded border border-[#2b2b2b]">
            {settings.smoothingFactor === 0 ? 'Raw (0%)' : `Kernel: ${settings.smoothingFactor}`}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={15}
          step={1}
          value={settings.smoothingFactor}
          onChange={(e) => onUpdateSettings({ smoothingFactor: parseInt(e.target.value, 10) })}
          className="w-full h-1.5 bg-[#333333] rounded-lg appearance-none cursor-pointer accent-amber-400"
        />
        <div className="flex justify-between text-[10px] text-gray-400">
          <span>0 (Raw)</span>
          <span>5 (Smooth)</span>
          <span>15 (Maximum)</span>
        </div>
      </div>

      {/* Manual Pin Offset (Nudge graphic without breaking keyframes) */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#2a2a2a]">
        <div className="flex items-center justify-between text-xs text-gray-300">
          <div className="flex items-center gap-1.5">
            <Move className="w-3.5 h-3.5 text-[#3ea6ff]" />
            <span>Pin Offset (Nudge Target)</span>
          </div>
          {(settings.offsetX !== 0 || settings.offsetY !== 0) && (
            <button
              onClick={() => onUpdateSettings({ offsetX: 0, offsetY: 0 })}
              className="text-[11px] text-gray-400 hover:text-white"
            >
              Reset Offset
            </button>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Offset X:</span>
              <span className="font-mono text-gray-300">{settings.offsetX}px</span>
            </div>
            <input
              type="range"
              min={-200}
              max={200}
              step={1}
              value={settings.offsetX}
              onChange={(e) => onUpdateSettings({ offsetX: parseInt(e.target.value, 10) })}
              className="w-full h-1.5 bg-[#333333] rounded appearance-none cursor-pointer accent-[#3ea6ff]"
            />
          </div>

          <div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>Offset Y:</span>
              <span className="font-mono text-gray-300">{settings.offsetY}px</span>
            </div>
            <input
              type="range"
              min={-200}
              max={200}
              step={1}
              value={settings.offsetY}
              onChange={(e) => onUpdateSettings({ offsetY: parseInt(e.target.value, 10) })}
              className="w-full h-1.5 bg-[#333333] rounded appearance-none cursor-pointer accent-[#3ea6ff]"
            />
          </div>
        </div>
      </div>

      {/* Camera Follow (Ball / Player Tracking Reframing) */}
      <div className="bg-[#1a2333] border border-[#234166] p-2.5 rounded-md flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">⚽</span>
            <span className="text-xs font-semibold text-blue-200">
              Camera Follow Mode (e.g. Football / Ball Tracking)
            </span>
          </div>
          <span className="font-mono text-[11px] text-[#3ea6ff] bg-[#111926] px-1.5 py-0.5 rounded border border-[#1e3452]">
            Zoom: {settings.cameraFollowZoom || 125}%
          </span>
        </div>
        <p className="text-[11px] text-gray-300 leading-snug">
          Locks the camera view onto the tracked ball or player, keeping it centered on screen as the camera follows the action!
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 whitespace-nowrap">Edge Padding Zoom:</span>
          <input
            type="range"
            min={105}
            max={180}
            step={5}
            value={settings.cameraFollowZoom || 125}
            onChange={(e) => onUpdateSettings({ cameraFollowZoom: parseInt(e.target.value, 10) })}
            className="w-full h-1.5 bg-[#253348] rounded appearance-none cursor-pointer accent-[#3ea6ff]"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            onClick={onApplyCameraFollow}
            disabled={keyframesCount === 0 || isExporting}
            className="py-1.5 px-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded text-xs font-semibold shadow flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Applies Camera Follow keyframes so the camera locks onto and follows the ball"
          >
            <span>⚽</span>
            <span>Apply Camera Follow</span>
          </button>
          <button
            onClick={onCopyCameraFollowText}
            disabled={keyframesCount === 0}
            className="py-1.5 px-2 bg-[#202b3d] hover:bg-[#28374f] border border-[#2f4363] text-blue-200 rounded text-[11px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Copy Camera Follow Keyframe data for Ctrl+V"
          >
            <span>📋</span>
            <span>Copy Follow (Ctrl+V)</span>
          </button>
        </div>
      </div>

      {/* Video Stabilization Mode (Anti-Shake / Lock-Down) */}
      <div className="bg-[#182c25] border border-[#1f513f] p-2.5 rounded-md flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">🛡️</span>
            <span className="text-xs font-semibold text-emerald-200">
              Video Stabilization Mode (Anti-Shake)
            </span>
          </div>
          <span className="font-mono text-[11px] text-emerald-300 bg-[#0f1f1a] px-1.5 py-0.5 rounded border border-[#1b4335]">
            {settings.stabilizeStrength ?? 100}% • {settings.stabilizeZoom || 115}% Zoom
          </span>
        </div>
        <p className="text-[11px] text-gray-300 leading-snug">
          Counter-moves (and counter-rotates/scales in 2-Point mode) the video clip against tracked camera shake to lock the shot steady.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-gray-300">
              <span>Strength:</span>
              <span className="font-mono text-emerald-300">{settings.stabilizeStrength ?? 100}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={settings.stabilizeStrength ?? 100}
              onChange={(e) => onUpdateSettings({ stabilizeStrength: parseInt(e.target.value, 10) })}
              aria-label="Stabilization Strength"
              className="w-full h-1.5 bg-[#1f3b31] rounded appearance-none cursor-pointer accent-emerald-400"
            />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[10px] text-gray-300">
              <span>Border Crop Zoom:</span>
              <span className="font-mono text-emerald-300">{settings.stabilizeZoom || 115}%</span>
            </div>
            <input
              type="range"
              min={100}
              max={160}
              step={2}
              value={settings.stabilizeZoom || 115}
              onChange={(e) => onUpdateSettings({ stabilizeZoom: parseInt(e.target.value, 10) })}
              aria-label="Stabilization Border Crop Zoom"
              className="w-full h-1.5 bg-[#1f3b31] rounded appearance-none cursor-pointer accent-emerald-400"
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-1">
          <button
            type="button"
            onClick={onApplyStabilize}
            disabled={keyframesCount === 0 || isExporting}
            className="py-1.5 px-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded text-xs font-semibold shadow flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Applies inverse counter-motion keyframes to stabilize the selected video clip"
          >
            <span>🛡️</span>
            <span>Stabilize Clip</span>
          </button>
          <button
            type="button"
            onClick={onCopyStabilizeText}
            disabled={keyframesCount === 0}
            className="py-1.5 px-2 bg-[#162923] hover:bg-[#1e3830] border border-[#285244] text-emerald-200 rounded text-[11px] font-medium flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Copy Stabilization Keyframe data for Ctrl+V"
          >
            <span>📋</span>
            <span>Copy Stabilize (Ctrl+V)</span>
          </button>
        </div>
      </div>

      {/* Export Property Checkboxes */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#2a2a2a]">
        <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
          <CheckSquare className="w-3.5 h-3.5 text-[#3ea6ff]" />
          <span>Properties to Apply</span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex items-center gap-2 bg-[#252525] hover:bg-[#2b2b2b] p-2 rounded border border-[#333333] text-xs text-gray-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.exportPosition}
              onChange={(e) => onUpdateSettings({ exportPosition: e.target.checked })}
              className="rounded accent-[#3ea6ff]"
            />
            <span>Position X/Y</span>
          </label>

          <label className="flex items-center gap-2 bg-[#252525] hover:bg-[#2b2b2b] p-2 rounded border border-[#333333] text-xs text-gray-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.exportScale}
              onChange={(e) => onUpdateSettings({ exportScale: e.target.checked })}
              className="rounded accent-[#3ea6ff]"
            />
            <span>Scale (X/Y)</span>
          </label>

          <label className="flex items-center gap-2 bg-[#252525] hover:bg-[#2b2b2b] p-2 rounded border border-[#333333] text-xs text-gray-200 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.exportRotation}
              onChange={(e) => onUpdateSettings({ exportRotation: e.target.checked })}
              className="rounded accent-[#3ea6ff]"
            />
            <span>Rotation / Roll</span>
          </label>

          <label className="flex items-center gap-2 bg-[#252525] hover:bg-[#2b2b2b] p-2 rounded border border-purple-500/40 text-xs text-purple-200 cursor-pointer" title="Applies 4-Corner Pin + Basic 3D Swivel/Tilt + Perspective Scale Width/Height when 4-Pin 3D Surface is tracked">
            <input
              type="checkbox"
              checked={settings.exportCornerPin3D !== false}
              onChange={(e) => onUpdateSettings({ exportCornerPin3D: e.target.checked })}
              className="rounded accent-purple-500"
            />
            <span>3D / Corner Pin</span>
          </label>
        </div>
      </div>

      {/* Motion Blur for Tracked Text & Objects (Transform Shutter Angle + Velocity Directional Blur) */}
      <div className="bg-[#23192d] border border-fuchsia-500/40 p-2.5 rounded-md flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.enableMotionBlur === true}
              onChange={(e) =>
                onUpdateSettings({
                  enableMotionBlur: e.target.checked,
                  applyToTransformEffect: e.target.checked ? true : settings.applyToTransformEffect,
                  shutterAngle: settings.shutterAngle ?? 180,
                })
              }
              aria-label="Enable Motion Blur (Shutter Angle)"
              className="w-4 h-4 rounded accent-fuchsia-400 cursor-pointer"
            />
            <span className="text-xs font-semibold text-fuchsia-200">
              💨 Motion Blur (Tracked Text & Layers)
            </span>
          </label>
          <span className="font-mono text-[11px] text-fuchsia-300 bg-[#150f1d] px-1.5 py-0.5 rounded border border-fuchsia-700/50">
            {settings.enableMotionBlur ? `${settings.shutterAngle ?? 180}° Shutter` : 'OFF'}
          </span>
        </div>

        <p className="text-[11px] text-gray-300 leading-snug">
          Applies native <strong>Transform → Shutter Angle</strong> motion blur in Premiere Pro and calculates frame-to-frame velocity directional blur so fast-moving tracked text blurs naturally with the shot.
        </p>

        {settings.enableMotionBlur && (
          <div className="flex flex-col gap-1.5 pt-1 border-t border-fuchsia-800/40">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-gray-300">Shutter Angle (0°–360°):</span>
              <div className="flex items-center gap-1">
                {[90, 180, 270, 360].map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => onUpdateSettings({ shutterAngle: deg })}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                      (settings.shutterAngle ?? 180) === deg
                        ? 'bg-fuchsia-600 text-white border-fuchsia-400'
                        : 'bg-[#181220] text-fuchsia-200 border-fuchsia-800/60 hover:bg-[#241b30]'
                    }`}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            </div>
            <input
              type="range"
              min={0}
              max={360}
              step={15}
              aria-label="Motion Blur Shutter Angle"
              value={settings.shutterAngle ?? 180}
              onChange={(e) => onUpdateSettings({ shutterAngle: parseInt(e.target.value, 10) })}
              className="w-full h-1.5 bg-[#362747] rounded appearance-none cursor-pointer accent-fuchsia-400"
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>0° (No Blur)</span>
              <span>180° (Cinema Standard)</span>
              <span>360° (Max Trail)</span>
            </div>
          </div>
        )}
      </div>

      {/* Use Transform Effect Toggle */}
      <div className="bg-[#18212e] border border-[#234166] p-2.5 rounded-md flex flex-col gap-1.5">
        <label className="flex items-center justify-between cursor-pointer">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-[#3ea6ff]" />
            <span className="text-xs font-semibold text-white">
              Use 'Transform' Effect (Keep Intrinsic Motion Free)
            </span>
          </div>
          <input
            type="checkbox"
            checked={settings.applyToTransformEffect}
            onChange={(e) => onUpdateSettings({ applyToTransformEffect: e.target.checked })}
            className="w-4 h-4 rounded accent-[#3ea6ff] cursor-pointer"
          />
        </label>
        <p className="text-[11px] text-gray-300 leading-relaxed">
          {settings.applyToTransformEffect
            ? 'Bakes to Transform effect so you can still manually move, scale, or reposition the target layer freely!'
            : 'Bakes into the intrinsic Motion > Position component.'}
        </p>
      </div>

      {/* Primary Action Buttons: Pin to Object vs Pin to Text */}
      <div className="flex flex-col gap-2 pt-2 border-t border-[#2a2a2a]">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onExportToTimeline('object')}
            disabled={keyframesCount === 0 || isExporting}
            className={`py-2 px-3 rounded text-xs font-semibold shadow-md flex items-center justify-center gap-1.5 transition-all ${
              keyframesCount === 0
                ? 'bg-[#2a2a2a] text-gray-500 cursor-not-allowed border border-[#383838]'
                : 'bg-gradient-to-r from-[#1473e6] to-[#0052cc] hover:from-[#0d66d0] hover:to-[#0047b3] text-white'
            }`}
          >
            <span>🎯</span>
            <span>Pin to Object/Clip</span>
          </button>

          <button
            onClick={() => onExportToTimeline('text')}
            disabled={keyframesCount === 0 || isExporting}
            className={`py-2 px-3 rounded text-xs font-semibold shadow-md flex items-center justify-center gap-1.5 transition-all ${
              keyframesCount === 0
                ? 'bg-[#2a2a2a] text-gray-500 cursor-not-allowed border border-[#383838]'
                : 'bg-gradient-to-r from-[#10b981] to-[#059669] hover:from-[#059669] hover:to-[#047857] text-white'
            }`}
          >
            <span>✍️</span>
            <span>Pin to Text Layer</span>
          </button>
        </div>

        {/* Copy as Text or JSON */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCopyKeyframeText}
            disabled={keyframesCount === 0}
            className="py-1.5 px-2 bg-[#282828] hover:bg-[#333333] border border-[#3a3a3a] rounded text-[11px] text-gray-200 flex items-center justify-center gap-1.5 font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="Copies standard Adobe AE / Premiere Keyframe text. Select any layer and press Ctrl+V to paste!"
          >
            <span>📋</span>
            <span>Copy Keyframes (Ctrl+V)</span>
          </button>

          <button
            type="button"
            onClick={onCopyJson}
            disabled={keyframesCount === 0}
            className="py-1.5 px-2 bg-[#282828] hover:bg-[#333333] border border-[#3a3a3a] rounded text-[11px] text-gray-200 flex items-center justify-center gap-1.5 font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>{'{ }'}</span>
            <span>Copy JSON Data</span>
          </button>
        </div>
      </div>
    </div>
  );
};
