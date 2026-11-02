import React from 'react';
import { Download, Code2, Film, Box, Sparkles, CheckCircle2, Cpu, Zap, ShieldCheck } from 'lucide-react';
import { TrackingMode } from '../types/tracker';
import { createWindowsInstallerBat } from '../services/cepExportFiles';

interface HeaderProps {
  isCEP: boolean;
  trackingMode: TrackingMode;
  onSelectMode: (mode: TrackingMode) => void;
  onOpenExtensionFiles: () => void;
  onOpenPayloadInspector: () => void;
  hasKeyframes: boolean;
  keyframesCount: number;
  useGPU: boolean;
  isGPUSupported: boolean;
  gpuRendererName: string;
  onToggleGPU: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  isCEP,
  trackingMode,
  onSelectMode,
  onOpenExtensionFiles,
  onOpenPayloadInspector,
  hasKeyframes,
  keyframesCount,
  useGPU,
  isGPUSupported,
  gpuRendererName,
  onToggleGPU,
}) => {
  const handleDownloadOneClickInstaller = () => {
    const batContent = createWindowsInstallerBat();
    const blob = new Blob([batContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Install_MotionTracker_Plugin.bat';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <header className="bg-[#181818] border-b border-[#2d2d2d] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 select-none">
      {/* Brand & Identity */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-[#121212] border border-[#3ea6ff]/40 flex items-center justify-center p-0.5 shadow-sm overflow-hidden shrink-0">
          <img
            src="/assets/aistudio/LOGO_FACE_b4ea04e0.png"
            alt="MotionTracker by Nightosphere Logo"
            className="w-full h-full object-contain"
          />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-sm font-semibold text-gray-100 tracking-tight">
              MotionTracker <span className="text-[#3ea6ff] font-normal">by Nightosphere</span>
            </h1>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#2a2a2a] text-gray-300 font-mono border border-[#3a3a3a]">
              PPRO 2020–2026+
            </span>
          </div>
          <p className="text-[11px] text-gray-400">GPU Optical Flow, 3D Surface Corner-Pin &amp; Premiere Timeline Bridge</p>
        </div>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="flex items-center bg-[#121212] p-1 rounded-md border border-[#2b2b2b]">
        <button
          onClick={() => onSelectMode('canvas')}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded transition-colors ${
            trackingMode === 'canvas'
              ? 'bg-[#2f2f2f] text-[#3ea6ff] shadow-sm'
              : 'text-gray-400 hover:text-gray-200'
          }`}
          title="1-Point & 2-Point Optical Flow Point Tracker"
        >
          <Film className="w-3.5 h-3.5" />
          <span>Point Optical Tracker (1/2-Pt)</span>
        </button>
        <button
          onClick={() => onSelectMode('surface')}
          className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded transition-colors ${
            trackingMode === 'surface'
              ? 'bg-gradient-to-r from-[#1f2f4d] to-[#311f4d] text-purple-300 border border-purple-500/40 shadow-sm'
              : 'text-gray-400 hover:text-gray-200'
          }`}
          title="Free-Edit 4-Pin 3D Surface & Screen Perspective Tracker (Corner Pin + 3D Yaw/Pitch/Roll)"
        >
          <Box className="w-3.5 h-3.5 text-purple-400" />
          <span>Surface Tracking Mode (4-Pin 3D)</span>
        </button>
      </div>

      {/* Environment Status & Action Buttons */}
      <div className="flex items-center gap-2">
        {/* WebGL GPU Acceleration Toggle Badge */}
        <button
          onClick={onToggleGPU}
          title={
            isGPUSupported
              ? `WebGL GPU Acceleration (${gpuRendererName}). Click to switch between GPU Shader and CPU Integral-Image engine.`
              : 'WebGL unavailable — running on CPU Integral-Image engine'
          }
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors ${
            useGPU && isGPUSupported
              ? 'bg-violet-950/80 border-violet-500/50 text-violet-200 hover:bg-violet-900/80'
              : 'bg-[#252525] border-[#3d3d3d] text-gray-300 hover:bg-[#303030]'
          }`}
        >
          {useGPU && isGPUSupported ? (
            <>
              <Zap className="w-3 h-3 text-violet-400" />
              <span>GPU WebGL: ON</span>
            </>
          ) : (
            <>
              <Cpu className="w-3 h-3 text-gray-400" />
              <span>CPU Mode</span>
            </>
          )}
        </button>

        {/* CEP vs Dev Mode Badge */}
        {isCEP ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/70 border border-emerald-600/40 text-emerald-400 text-[11px]">
            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
            <span>Premiere Pro CEP Host</span>
          </div>
        ) : (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-950/60 border border-amber-600/40 text-amber-300 text-[11px]"
            title="Running inside Browser Preview. Full tracking is enabled with interactive demo footage!"
          >
            <Sparkles className="w-3 h-3 text-amber-400" />
            <span>Live Browser Tracker</span>
          </div>
        )}

        {/* Payload Inspector Button */}
        {hasKeyframes && (
          <button
            onClick={onOpenPayloadInspector}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#252525] hover:bg-[#303030] text-gray-200 hover:text-white rounded border border-[#3c3c3c] text-xs font-medium transition-colors"
            title="Inspect generated keyframes and ExtendScript call"
          >
            <Code2 className="w-3.5 h-3.5 text-[#3ea6ff]" />
            <span>Payload ({keyframesCount} kf)</span>
          </button>
        )}

        {/* 1-Click Windows Defender-Safe Installer Button */}
        <button
          onClick={handleDownloadOneClickInstaller}
          className="flex items-center gap-1.5 px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold shadow-sm transition-colors"
          title="Download 100% Plain-Text, Windows Defender-Safe 1-Click Installer (Install_MotionTracker_Plugin.bat — zero .exe binaries or Base64 obfuscation)"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          <span>1-Click Safe Installer (.bat)</span>
        </button>

        {/* Export Extension Files Button */}
        <button
          onClick={onOpenExtensionFiles}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#1473e6] hover:bg-[#0d66d0] text-white rounded text-xs font-medium shadow-sm transition-colors"
          title="Download manifest.xml, host.jsx, and 1-Click Windows Auto-Installer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Install / Update Plugin</span>
        </button>
      </div>
    </header>
  );
};
