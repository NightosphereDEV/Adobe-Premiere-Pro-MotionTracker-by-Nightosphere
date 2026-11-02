import React, { useState } from 'react';
import { Table, Activity, Trash2, Edit3, Check, TrendingUp } from 'lucide-react';
import { ProcessedKeyframe } from '../types/tracker';

interface TrackDataEditorProps {
  keyframes: ProcessedKeyframe[];
  currentFrame: number;
  fps: number;
  onSelectFrame: (frame: number) => void;
  onUpdateKeyframe: (frameNumber: number, newValues: { x?: number; y?: number; scale?: number; rotation?: number }) => void;
  onDeleteKeyframe: (frameNumber: number) => void;
  onDeleteRange: (startFrame: number, endFrame: number) => void;
  onClearAll: () => void;
  isOpen: boolean;
  onToggleOpen: () => void;
}

export const TrackDataEditor: React.FC<TrackDataEditorProps> = ({
  keyframes,
  currentFrame,
  fps,
  onSelectFrame,
  onUpdateKeyframe,
  onDeleteKeyframe,
  onDeleteRange,
  onClearAll,
  isOpen,
  onToggleOpen,
}) => {
  const [editingFrame, setEditingFrame] = useState<number | null>(null);
  const [editX, setEditX] = useState<string>('');
  const [editY, setEditY] = useState<string>('');
  const [editScale, setEditScale] = useState<string>('');
  const [editRot, setEditRot] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'table' | 'curves'>('table');

  const startEditing = (k: ProcessedKeyframe) => {
    setEditingFrame(k.frameNumber);
    setEditX(k.x.toString());
    setEditY(k.y.toString());
    setEditScale(k.scale.toString());
    setEditRot(k.rotation.toString());
  };

  const saveEditing = (frameNumber: number) => {
    onUpdateKeyframe(frameNumber, {
      x: parseFloat(editX) || 0,
      y: parseFloat(editY) || 0,
      scale: parseFloat(editScale) || 100,
      rotation: parseFloat(editRot) || 0,
    });
    setEditingFrame(null);
  };

  if (!isOpen) {
    return (
      <div className="bg-[#1f1f1f] rounded-md border border-[#2d2d2d] p-2.5 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#3ea6ff]" />
          <span className="text-xs font-semibold text-gray-200">Track Data & Keyframe Editor</span>
          <span className="text-[11px] font-mono text-gray-400 bg-[#161616] px-2 py-0.5 rounded border border-[#2b2b2b]">
            {keyframes.length} keyframes recorded
          </span>
        </div>
        <button
          onClick={onToggleOpen}
          className="px-3 py-1 bg-[#282828] hover:bg-[#323232] text-xs font-medium text-gray-200 rounded border border-[#3c3c3c] transition-colors"
        >
          Open Editor ({keyframes.length})
        </button>
      </div>
    );
  }

  const minX = keyframes.length ? Math.min(...keyframes.map((k) => k.x)) : 0;
  const maxX = keyframes.length ? Math.max(...keyframes.map((k) => k.x)) : 640;
  const minY = keyframes.length ? Math.min(...keyframes.map((k) => k.y)) : 0;
  const maxY = keyframes.length ? Math.max(...keyframes.map((k) => k.y)) : 360;

  return (
    <div className="bg-[#1b1b1b] rounded-md border border-[#303030] p-3 flex flex-col gap-3 shadow-md select-none">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#2a2a2a]">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#3ea6ff]" />
          <span className="text-xs font-semibold text-gray-200">Track Data & Keyframe Editor</span>
          <span className="text-[11px] font-mono text-[#3ea6ff] bg-[#142334] px-2 py-0.5 rounded border border-[#1e3e60]">
            {keyframes.length} Baked Points
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#141414] rounded p-0.5 border border-[#2a2a2a]">
            <button
              onClick={() => setActiveTab('table')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                activeTab === 'table' ? 'bg-[#2a2a2a] text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <Table className="w-3 h-3" />
              <span>Table</span>
            </button>
            <button
              onClick={() => setActiveTab('curves')}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                activeTab === 'curves' ? 'bg-[#2a2a2a] text-[#3ea6ff]' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <TrendingUp className="w-3 h-3" />
              <span>Curves</span>
            </button>
          </div>

          <button
            onClick={onToggleOpen}
            className="text-xs text-gray-400 hover:text-white px-2 py-1"
          >
            Collapse
          </button>
        </div>
      </div>

      {/* Quick Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-[#161616] p-2 rounded border border-[#262626] text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-gray-400 text-[11px]">
            Playhead @ Fr {currentFrame} ({(currentFrame / fps).toFixed(1)}s):
          </span>
          <button
            onClick={() => onDeleteKeyframe(currentFrame)}
            disabled={!keyframes.some((k) => k.frameNumber === currentFrame)}
            className="px-2 py-1 bg-[#252525] hover:bg-rose-950/60 hover:text-rose-300 text-gray-300 rounded border border-[#333] text-[11px] disabled:opacity-40 transition-colors"
            title="Delete keyframe at playhead"
          >
            Delete Frame
          </button>
          <button
            onClick={() => onDeleteRange(currentFrame + 1, 999999)}
            disabled={keyframes.length === 0}
            className="px-2 py-1 bg-amber-950/40 hover:bg-amber-900/60 text-amber-200 rounded border border-amber-600/40 text-[11px] disabled:opacity-40 transition-colors"
            title="Keep everything from 0s up to current playhead and delete all messed-up keyframes after it"
          >
            ✂️ Keep First {(currentFrame / fps).toFixed(1)}s (Delete After)
          </button>
          <button
            onClick={() => onDeleteRange(0, Math.max(0, currentFrame - 1))}
            disabled={keyframes.length === 0 || currentFrame <= 0}
            className="px-2 py-1 bg-[#252525] hover:bg-rose-950/60 hover:text-rose-300 text-gray-300 rounded border border-[#333] text-[11px] disabled:opacity-40 transition-colors"
            title="Delete all keyframes before playhead"
          >
            ✂️ Delete Before {(currentFrame / fps).toFixed(1)}s
          </button>
        </div>

        <button
          onClick={onClearAll}
          disabled={keyframes.length === 0}
          className="flex items-center gap-1 text-[11px] text-rose-400 hover:text-rose-300 disabled:opacity-40"
        >
          <Trash2 className="w-3 h-3" />
          <span>Clear All Data</span>
        </button>
      </div>

      {/* Visual Curves View */}
      {activeTab === 'curves' && (
        <div className="bg-[#121212] p-2 rounded border border-[#262626] flex flex-col gap-2">
          <div className="flex justify-between text-[10px] text-gray-400 font-mono">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#3ea6ff]"></span> X Coordinate ({Math.round(minX)}px - {Math.round(maxX)}px)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#f59e0b]"></span> Y Coordinate ({Math.round(minY)}px - {Math.round(maxY)}px)
            </span>
          </div>

          <div className="h-28 w-full relative border border-[#222] bg-[#0d0d0d] rounded overflow-hidden">
            <svg className="w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
              <line x1="0" y1="25" x2="100" y2="25" stroke="#1c1c1c" strokeWidth="0.5" />
              <line x1="0" y1="50" x2="100" y2="50" stroke="#1c1c1c" strokeWidth="0.5" />
              <line x1="0" y1="75" x2="100" y2="75" stroke="#1c1c1c" strokeWidth="0.5" />

              {keyframes.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#3ea6ff"
                  strokeWidth="1.5"
                  points={keyframes
                    .map((k, i) => {
                      const px = (i / (keyframes.length - 1)) * 100;
                      const py = 100 - ((k.x - minX) / (maxX - minX || 1)) * 90 - 5;
                      return `${px},${py}`;
                    })
                    .join(' ')}
                />
              )}

              {keyframes.length > 1 && (
                <polyline
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.5"
                  points={keyframes
                    .map((k, i) => {
                      const px = (i / (keyframes.length - 1)) * 100;
                      const py = 100 - ((k.y - minY) / (maxY - minY || 1)) * 90 - 5;
                      return `${px},${py}`;
                    })
                    .join(' ')}
                />
              )}
            </svg>
          </div>
        </div>
      )}

      {/* Keyframe Table View */}
      {activeTab === 'table' && (
        <div className="max-h-52 overflow-y-auto rounded border border-[#282828] bg-[#141414]">
          <table className="w-full text-left font-mono text-xs text-gray-300">
            <thead className="sticky top-0 bg-[#1c1c1c] border-b border-[#2b2b2b] text-gray-400 text-[11px]">
              <tr>
                <th className="py-1.5 px-2">Frame</th>
                <th className="py-1.5 px-2">Timecode</th>
                <th className="py-1.5 px-2">X (px)</th>
                <th className="py-1.5 px-2">Y (px)</th>
                <th className="py-1.5 px-2">Scale (%)</th>
                <th className="py-1.5 px-2">Rot / 3D Pose</th>
                <th className="py-1.5 px-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keyframes.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-4 text-center text-gray-500 font-sans text-xs">
                    No keyframes tracked yet. Click "Track Fwd ►" to generate data.
                  </td>
                </tr>
              ) : (
                keyframes.map((k) => {
                  const isCurrent = k.frameNumber === currentFrame;
                  const isEditing = editingFrame === k.frameNumber;

                  return (
                    <tr
                      key={k.frameNumber}
                      onClick={() => onSelectFrame(k.frameNumber)}
                      className={`border-b border-[#1e1e1e] cursor-pointer transition-colors ${
                        isCurrent
                          ? 'bg-[#1b2a3d] text-white'
                          : 'hover:bg-[#1a1a1a] text-gray-300'
                      }`}
                    >
                      <td className="py-1.5 px-2 font-semibold text-[#3ea6ff]">
                        {k.frameNumber}
                      </td>
                      <td className="py-1.5 px-2 text-gray-400">{k.timecode}</td>

                      <td className="py-1.5 px-2">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editX}
                            onChange={(e) => setEditX(e.target.value)}
                            className="w-16 bg-[#0a0a0a] border border-[#3ea6ff] rounded px-1 py-0.5 text-xs text-white"
                          />
                        ) : (
                          k.x
                        )}
                      </td>

                      <td className="py-1.5 px-2">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editY}
                            onChange={(e) => setEditY(e.target.value)}
                            className="w-16 bg-[#0a0a0a] border border-[#3ea6ff] rounded px-1 py-0.5 text-xs text-white"
                          />
                        ) : (
                          k.y
                        )}
                      </td>

                      <td className="py-1.5 px-2">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editScale}
                            onChange={(e) => setEditScale(e.target.value)}
                            className="w-14 bg-[#0a0a0a] border border-[#3ea6ff] rounded px-1 py-0.5 text-xs text-white"
                          />
                        ) : (
                          `${k.scale}%`
                        )}
                      </td>

                      <td className="py-1.5 px-2">
                        {isEditing ? (
                          <input
                            type="number"
                            value={editRot}
                            onChange={(e) => setEditRot(e.target.value)}
                            className="w-14 bg-[#0a0a0a] border border-[#3ea6ff] rounded px-1 py-0.5 text-xs text-white"
                          />
                        ) : k.yaw3D !== undefined && k.pitch3D !== undefined ? (
                          <span className="text-[11px] text-purple-300" title="2D Roll / 3D Yaw / 3D Pitch">
                            {k.rotation}° <span className="text-gray-400">({k.yaw3D}°/{k.pitch3D}°)</span>
                          </span>
                        ) : (
                          `${k.rotation}°`
                        )}
                      </td>

                      <td className="py-1.5 px-2 text-right">
                        {isEditing ? (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              saveEditing(k.frameNumber);
                            }}
                            className="p-1 text-emerald-400 hover:text-emerald-300"
                            title="Save"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditing(k);
                              }}
                              className="p-1 text-gray-400 hover:text-white"
                              title="Edit coordinates"
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteKeyframe(k.frameNumber);
                              }}
                              className="p-1 text-gray-400 hover:text-rose-400"
                              title="Delete keyframe"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
