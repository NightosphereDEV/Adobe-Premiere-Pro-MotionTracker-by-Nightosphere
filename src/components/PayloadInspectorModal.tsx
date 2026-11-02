import React, { useState } from 'react';
import { X, Copy, Check, Code2, Database, Table, FileText, ShieldCheck } from 'lucide-react';
import { ProcessedKeyframe, ExportSettings } from '../types/tracker';
import { generateAdobeKeyframeText, copyToClipboard } from '../utils/math';
import { createWindowsInstallerBat } from '../services/cepExportFiles';

interface PayloadInspectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  keyframes: ProcessedKeyframe[];
  settings: ExportSettings;
}

export const PayloadInspectorModal: React.FC<PayloadInspectorModalProps> = ({
  isOpen,
  onClose,
  keyframes,
  settings,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'json' | 'adobeText' | 'table' | 'extendscript'>('json');

  if (!isOpen) return null;

  const payload = {
    targetType: settings.targetType || 'object',
    isCameraFollow: settings.isCameraFollow || false,
    cameraFollowZoom: settings.cameraFollowZoom || 125,
    isStabilize: settings.isStabilize || false,
    stabilizeStrength: settings.stabilizeStrength ?? 100,
    stabilizeZoom: settings.stabilizeZoom || 115,
    applyToTransformEffect: settings.applyToTransformEffect,
    exportPosition: settings.exportPosition,
    exportScale: settings.exportScale,
    exportRotation: settings.exportRotation,
    targetLayerName: settings.targetLayerName || 'Selected Timeline Clip',
    canvasWidth: 640,
    canvasHeight: 360,
    keyframesCount: keyframes.length,
    smoothingApplied: settings.smoothingFactor,
    offsets: { x: settings.offsetX, y: settings.offsetY },
    keyframes: keyframes.map((k) => ({
      frameNumber: k.frameNumber,
      timeSeconds: k.timeSeconds,
      timecode: k.timecode,
      x: k.x,
      y: k.y,
      scale: k.scale,
      rotation: k.rotation,
      confidence: k.confidence,
    })),
  };

  const jsonString = JSON.stringify(payload, null, 2);
  const escapedPayload = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const extendScriptCall = `// Premiere Pro 2026 ExtendScript Invocation
applyTrackingData('${escapedPayload}');`;

  const adobeKeyframeText = generateAdobeKeyframeText(keyframes, {
    fps: 30,
    width: 1920,
    height: 1080,
    canvasWidth: 640,
    canvasHeight: 360,
    exportPosition: settings.exportPosition,
    exportScale: settings.exportScale,
    exportRotation: settings.exportRotation,
    isCameraFollow: settings.isCameraFollow,
    cameraFollowZoom: settings.cameraFollowZoom,
    isStabilize: settings.isStabilize,
    stabilizeStrength: settings.stabilizeStrength,
    stabilizeZoom: settings.stabilizeZoom,
  });

  const handleCopy = async () => {
    let textToCopy = jsonString;
    if (viewMode === 'extendscript') textToCopy = extendScriptCall;
    else if (viewMode === 'adobeText') textToCopy = adobeKeyframeText;
    await copyToClipboard(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadOneClickBat = () => {
    const batContent = createWindowsInstallerBat(payload);
    const blob = new Blob([batContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Update_And_Apply_To_Premiere.bat';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#1b1b1b] border border-[#333333] rounded-lg w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#222222] border-b border-[#303030] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <Database className="w-5 h-5 text-[#3ea6ff]" />
            <div>
              <h2 className="text-sm font-semibold text-gray-100">
                Apply {keyframes.length} Keyframes to Adobe Premiere Pro Timeline
              </h2>
              <p className="text-[11px] text-gray-400">
                Direct Premiere Pro ExtendScript Bridge (`addKey` + `setValueAtKey`)
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleDownloadOneClickBat}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-semibold shadow-md transition-colors"
              title="100% Plain-Text, Windows Defender-Safe 1-Click Script — Updates your Premiere Pro extension AND sends these keyframes directly to your timeline"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>🛡️ 1-Click Safe Update &amp; Apply (.bat)</span>
            </button>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2a2a2a] hover:bg-[#343434] text-gray-200 rounded text-xs font-medium border border-[#3c3c3c] transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Payload'}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 text-gray-400 hover:text-white rounded hover:bg-[#2e2e2e]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Direct Action Instructions Banner */}
        <div className="px-5 py-3 bg-[#142234] border-b border-[#233f63] text-xs text-blue-100 space-y-1.5">
          <div className="font-semibold text-amber-300 flex items-center gap-1.5">
            <span>Why didn&apos;t keyframes move on the timeline before?</span>
          </div>
          <p className="text-[11px] text-blue-200 leading-relaxed">
            1. <strong>Fixed Premiere Keyframe Engine:</strong> Older versions of <code className="bg-black/40 px-1 rounded">host.jsx</code> used After Effects&apos; <code className="bg-black/40 px-1 rounded">setValueAtTime</code> instead of Premiere Pro&apos;s <code className="bg-black/40 px-1 rounded">addKey() + setValueAtKey()</code>, which enabled the stopwatch without adding keyframes.
            <br />
            2. <strong>How to Apply Right Now:</strong> Click the green <strong>⚡ 1-Click Update Plugin &amp; Apply Keyframes (.bat)</strong> button above and run the downloaded <code className="bg-black/40 px-1 rounded">.bat</code> file once. It automatically updates your Premiere Pro extension in <code className="bg-black/40 px-1 rounded">%APPDATA%\Adobe\CEP\extensions\MotionTracker_by_Nightosphere_CEP</code> and injects your <strong>{keyframes.length} keyframes</strong> directly into your selected Premiere clip!
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center px-4 bg-[#181818] border-b border-[#2a2a2a]">
          <button
            onClick={() => setViewMode('json')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              viewMode === 'json'
                ? 'border-[#3ea6ff] text-[#3ea6ff] bg-[#222222]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>Premiere Panel Paste Payload (JSON)</span>
          </button>
          <button
            onClick={() => setViewMode('adobeText')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              viewMode === 'adobeText'
                ? 'border-[#3ea6ff] text-[#3ea6ff] bg-[#222222]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>After Effects Text (Ctrl+V in AE)</span>
          </button>
          <button
            onClick={() => setViewMode('extendscript')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              viewMode === 'extendscript'
                ? 'border-[#3ea6ff] text-[#3ea6ff] bg-[#222222]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>ExtendScript Call</span>
          </button>
          <button
            onClick={() => setViewMode('table')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
              viewMode === 'table'
                ? 'border-[#3ea6ff] text-[#3ea6ff] bg-[#222222]'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            <span>Keyframes Table ({keyframes.length})</span>
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-4 overflow-auto bg-[#121212]">
          {viewMode === 'json' && (
            <div>
              <div className="mb-2 p-2 bg-[#1b2533] border border-[#234166] rounded text-[11px] text-blue-200">
                💡 <strong>Paste into Premiere Panel:</strong> Click <strong>Copy Payload</strong> above, or press <kbd className="bg-black/50 px-1 py-0.5 rounded font-mono">Ctrl+C</kbd> on the selected text below, then paste it into the <strong>&quot;Paste &amp; Apply Here&quot;</strong> box inside the MotionTracker Pro panel in Premiere Pro.
              </div>
              <pre
                onClick={(e) => {
                  const range = document.createRange();
                  range.selectNodeContents(e.currentTarget);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }}
                className="font-mono text-xs text-emerald-400 whitespace-pre leading-relaxed select-all bg-[#161616] p-3 rounded border border-[#262626] cursor-pointer"
              >
                {jsonString}
              </pre>
            </div>
          )}

          {viewMode === 'adobeText' && (
            <div>
              <div className="mb-2 p-2 bg-[#1b2533] border border-[#234166] rounded text-[11px] text-blue-200">
                💡 <strong>Note for Premiere Pro vs After Effects:</strong> Adobe After Effects supports direct <kbd className="bg-black/50 px-1 py-0.5 rounded font-mono">Ctrl+V</kbd> of this text format on timeline layers. For <strong>Adobe Premiere Pro</strong>, either paste this text into the <strong>MotionTracker Pro CEP Panel&apos;s Paste Box</strong> or click the green <strong>⚡ 1-Click Update Plugin &amp; Apply Keyframes (.bat)</strong> button above!
              </div>
              <pre
                onClick={(e) => {
                  const range = document.createRange();
                  range.selectNodeContents(e.currentTarget);
                  const sel = window.getSelection();
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                }}
                className="font-mono text-xs text-amber-300 whitespace-pre leading-relaxed select-all bg-[#161616] p-3 rounded border border-[#262626] cursor-pointer"
              >
                {adobeKeyframeText || '// No keyframes recorded yet'}
              </pre>
            </div>
          )}

          {viewMode === 'extendscript' && (
            <pre className="font-mono text-xs text-blue-300 whitespace-pre leading-relaxed select-all">
              {extendScriptCall}
            </pre>
          )}

          {viewMode === 'table' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left font-mono text-xs text-gray-300">
                <thead>
                  <tr className="border-b border-[#2c2c2c] text-gray-400 bg-[#1a1a1a]">
                    <th className="py-2 px-3">Frame</th>
                    <th className="py-2 px-3">Timecode</th>
                    <th className="py-2 px-3">X (px)</th>
                    <th className="py-2 px-3">Y (px)</th>
                    <th className="py-2 px-3">Scale (%)</th>
                    <th className="py-2 px-3">Rotation (°)</th>
                  </tr>
                </thead>
                <tbody>
                  {keyframes.map((k) => (
                    <tr
                      key={k.frameNumber}
                      className="border-b border-[#222222] hover:bg-[#1f1f1f]"
                    >
                      <td className="py-1.5 px-3 text-[#3ea6ff]">{k.frameNumber}</td>
                      <td className="py-1.5 px-3 text-gray-400">{k.timecode}</td>
                      <td className="py-1.5 px-3">{k.x}</td>
                      <td className="py-1.5 px-3">{k.y}</td>
                      <td className="py-1.5 px-3">{k.scale}%</td>
                      <td className="py-1.5 px-3">{k.rotation}°</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
