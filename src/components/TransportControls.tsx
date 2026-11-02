import React, { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Square,
  FastForward,
  Rewind,
  Scissors,
  Trash2,
} from 'lucide-react';
import { secondsToTimecode } from '../utils/math';

interface TransportControlsProps {
  isPlaying: boolean;
  isTracking: boolean;
  currentFrame: number;
  totalFrames: number;
  currentTime: number;
  duration: number;
  fps: number;
  onTogglePlay: () => void;
  onStepFrame: (direction: -1 | 1) => void;
  onTrackForward: () => void;
  onTrackBackward: () => void;
  onStopTracking: () => void;
  onSeekFrame: (frame: number) => void;
  keyframesCount: number;
  trackedFrameNumbers?: number[];
  onKeepUpToPlayhead: () => void;
  onDeleteBeforePlayhead: () => void;
  onTrimByTimeRange: (startSec: number, endSec: number, mode: 'keep-only-range' | 'delete-range') => void;
  onClearAllKeyframes: () => void;
}

export const TransportControls: React.FC<TransportControlsProps> = ({
  isPlaying,
  isTracking,
  currentFrame,
  totalFrames,
  currentTime,
  duration,
  fps,
  onTogglePlay,
  onStepFrame,
  onTrackForward,
  onTrackBackward,
  onStopTracking,
  onSeekFrame,
  keyframesCount,
  trackedFrameNumbers = [],
  onKeepUpToPlayhead,
  onDeleteBeforePlayhead,
  onTrimByTimeRange,
  onClearAllKeyframes,
}) => {
  const [rangeStartSec, setRangeStartSec] = useState<string>('0');
  const [rangeEndSec, setRangeEndSec] = useState<string>('5');

  useEffect(() => {
    if (duration > 0 && parseFloat(rangeEndSec) > duration) {
      setRangeEndSec(Math.max(1, Math.round(duration * 0.65 * 10) / 10).toString());
    }
  }, [duration]);

  const minTrackedSec =
    trackedFrameNumbers.length > 0 ? (Math.min(...trackedFrameNumbers) / fps).toFixed(1) : '0.0';
  const maxTrackedSec =
    trackedFrameNumbers.length > 0 ? (Math.max(...trackedFrameNumbers) / fps).toFixed(1) : '0.0';

  return (
    <div className="bg-[#1f1f1f] rounded-md border border-[#2d2d2d] p-3 flex flex-col gap-2.5 shadow-sm select-none">
      {/* Timeline Scrubber */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-mono text-[#3ea6ff] w-20" title="Current Timecode">
            {secondsToTimecode(currentTime, fps)}
          </span>
          <div className="relative flex-1 flex flex-col gap-1">
            <input
              type="range"
              min={0}
              max={Math.max(1, totalFrames - 1)}
              value={currentFrame}
              onChange={(e) => onSeekFrame(parseInt(e.target.value, 10))}
              disabled={isTracking}
              className="w-full h-1.5 bg-[#333333] rounded-lg appearance-none cursor-pointer accent-[#3ea6ff] disabled:opacity-50"
            />
            {/* Visual Tracked Keyframe Bar */}
            {trackedFrameNumbers.length > 0 && (
              <div
                className="w-full h-1.5 bg-[#141414] rounded overflow-hidden relative border border-[#292929]"
                title={`Tracked keyframes span ${minTrackedSec}s – ${maxTrackedSec}s (${keyframesCount} frames)`}
              >
                {trackedFrameNumbers.map((fn) => {
                  const leftPct = (fn / Math.max(1, totalFrames - 1)) * 100;
                  const widthPct = Math.max(0.6, 100 / Math.max(1, totalFrames));
                  return (
                    <div
                      key={fn}
                      style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                      className={`absolute top-0 bottom-0 ${
                        fn <= currentFrame ? 'bg-emerald-500' : 'bg-amber-500/80'
                      }`}
                    />
                  );
                })}
              </div>
            )}
          </div>
          <span className="text-[11px] font-mono text-gray-400 w-28 text-right">
            {currentTime.toFixed(2)}s ({currentFrame + 1}/{totalFrames})
          </span>
        </div>
      </div>

      {/* Button Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#2a2a2a]">
        {/* Playback & Frame Stepping */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => onSeekFrame(0)}
            disabled={isTracking}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-[#2b2b2b] rounded disabled:opacity-40 transition-colors"
            title="First Frame"
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onStepFrame(-1)}
            disabled={isTracking || currentFrame <= 0}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-[#2b2b2b] rounded disabled:opacity-40 transition-colors"
            title="Step Back 1 Frame"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={onTogglePlay}
            disabled={isTracking}
            className="p-1.5 text-white bg-[#2b2b2b] hover:bg-[#383838] rounded disabled:opacity-40 transition-colors"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onStepFrame(1)}
            disabled={isTracking || currentFrame >= totalFrames - 1}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-[#2b2b2b] rounded disabled:opacity-40 transition-colors"
            title="Step Forward 1 Frame"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => onSeekFrame(totalFrames - 1)}
            disabled={isTracking}
            className="p-1.5 text-gray-400 hover:text-white hover:bg-[#2b2b2b] rounded disabled:opacity-40 transition-colors"
            title="Last Frame"
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Optical Flow Tracking Actions */}
        <div className="flex items-center gap-1.5">
          {/* Track Backward */}
          <button
            onClick={onTrackBackward}
            disabled={isTracking || currentFrame <= 0}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-[#2a2a2a] hover:bg-[#343434] text-gray-200 hover:text-white rounded text-xs font-medium border border-[#3c3c3c] disabled:opacity-40 transition-colors"
            title="Track Backward from current frame to beginning"
          >
            <Rewind className="w-3.5 h-3.5 text-red-400" />
            <span>Track Back</span>
          </button>

          {/* Stop / Pause Tracking */}
          {isTracking ? (
            <button
              onClick={onStopTracking}
              className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-semibold shadow-md animate-pulse transition-colors"
              title="Stop Tracking"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              <span>Stop Track</span>
            </button>
          ) : (
            <button
              onClick={onTrackForward}
              disabled={currentFrame >= totalFrames - 1}
              className="flex items-center gap-1 px-3 py-1.5 bg-[#1473e6] hover:bg-[#0d66d0] text-white rounded text-xs font-semibold shadow-sm disabled:opacity-40 transition-colors"
              title="Track Forward from current frame to end of clip"
            >
              <FastForward className="w-3.5 h-3.5" />
              <span>Track Fwd ►</span>
            </button>
          )}
        </div>

        {/* Keyframe Counter Status */}
        <div className="text-right">
          <span className="text-[10px] uppercase tracking-wider text-gray-400 block">Baked Keys</span>
          <span className="font-mono text-xs font-bold text-[#3ea6ff]">
            {keyframesCount} frames
          </span>
        </div>
      </div>

      {/* Trim / Cut Bad Track Data Bar (Keep Good Seconds, Delete Messed-Up Seconds) */}
      <div className="bg-[#17171b] border border-[#2e293a] rounded p-2 flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-amber-300">
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>Trim / Delete Messed-Up Track Data</span>
            {keyframesCount > 0 && (
              <span className="text-[10px] font-mono text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-700/50">
                Tracked: {minTrackedSec}s – {maxTrackedSec}s
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onKeepUpToPlayhead}
              disabled={keyframesCount === 0 || isTracking}
              className="px-2 py-1 bg-amber-600/25 hover:bg-amber-600/40 text-amber-200 border border-amber-500/50 rounded text-[11px] font-medium disabled:opacity-40 transition-colors"
              title="Keep all good keyframes from 0s up to the current playhead and delete everything after it"
            >
              ✂️ Keep First {currentTime.toFixed(1)}s (Delete After Playhead)
            </button>
            <button
              type="button"
              onClick={onDeleteBeforePlayhead}
              disabled={keyframesCount === 0 || isTracking || currentFrame <= 0}
              className="px-2 py-1 bg-[#252525] hover:bg-rose-950/60 text-gray-300 hover:text-rose-200 border border-[#3a3a3a] rounded text-[11px] disabled:opacity-40 transition-colors"
              title="Delete keyframes before the current playhead and keep the rest"
            >
              ✂️ Delete Before {currentTime.toFixed(1)}s
            </button>
            <button
              type="button"
              onClick={onClearAllKeyframes}
              disabled={keyframesCount === 0 || isTracking}
              className="p-1 text-gray-400 hover:text-rose-400 disabled:opacity-40 transition-colors"
              title="Clear all tracked keyframes"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Explicit Second Range Trimmer: e.g., Tracked 8s -> Keep 0s to 5s or Delete 5s to 8s */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-[#25252c] text-[11px]">
          <div className="flex items-center gap-1.5 text-gray-300">
            <span className="text-gray-400">Range (sec):</span>
            <input
              type="number"
              step="0.1"
              min="0"
              aria-label="Trim Start Seconds"
              value={rangeStartSec}
              onChange={(e) => setRangeStartSec(e.target.value)}
              className="w-14 bg-[#101014] border border-[#383844] rounded px-1.5 py-0.5 text-xs font-mono text-white"
            />
            <span className="text-gray-500">s to</span>
            <input
              type="number"
              step="0.1"
              min="0"
              aria-label="Trim End Seconds"
              value={rangeEndSec}
              onChange={(e) => setRangeEndSec(e.target.value)}
              className="w-14 bg-[#101014] border border-[#383844] rounded px-1.5 py-0.5 text-xs font-mono text-white"
            />
            <span className="text-gray-500">s</span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                onTrimByTimeRange(
                  parseFloat(rangeStartSec) || 0,
                  parseFloat(rangeEndSec) || 0,
                  'keep-only-range'
                )
              }
              disabled={keyframesCount === 0 || isTracking}
              className="px-2 py-0.5 bg-emerald-900/40 hover:bg-emerald-800/60 text-emerald-200 border border-emerald-600/50 rounded text-[11px] font-medium disabled:opacity-40 transition-colors"
              title="Keep ONLY keyframes inside this second range (e.g. keep 0s to 5s and delete the last 3s)"
            >
              ✅ Keep Only {rangeStartSec || 0}s–{rangeEndSec || 0}s
            </button>
            <button
              type="button"
              onClick={() =>
                onTrimByTimeRange(
                  parseFloat(rangeStartSec) || 0,
                  parseFloat(rangeEndSec) || 0,
                  'delete-range'
                )
              }
              disabled={keyframesCount === 0 || isTracking}
              className="px-2 py-0.5 bg-rose-950/50 hover:bg-rose-900/70 text-rose-200 border border-rose-700/50 rounded text-[11px] font-medium disabled:opacity-40 transition-colors"
              title="Delete keyframes inside this second range (e.g. delete 5s to 8s and keep the rest)"
            >
              🗑️ Delete {rangeStartSec || 0}s–{rangeEndSec || 0}s
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

