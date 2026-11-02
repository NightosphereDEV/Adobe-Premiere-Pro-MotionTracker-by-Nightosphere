import { ClipInfo, ExportSettings, ProcessedKeyframe } from '../types/tracker';
import { HOST_JSX } from './cepExportFiles';

// Extend Window interface for Adobe CEP
declare global {
  interface Window {
    __adobe_cep__?: unknown;
    CSInterface?: new () => {
      evalScript: (script: string, callback?: (result: string) => void) => void;
      getHostEnvironment: () => string;
      closeExtension: () => void;
    };
  }
}

export interface BridgeResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  isSimulated?: boolean;
}

export class CEPBridgeService {
  private static instance: CEPBridgeService;
  private csInterface: { evalScript: (script: string, callback?: (res: string) => void) => void } | null = null;
  public readonly isCEP: boolean = false;

  private constructor() {
    this.isCEP = typeof window !== 'undefined' && typeof window.__adobe_cep__ !== 'undefined';
    if (this.isCEP && typeof window.CSInterface !== 'undefined') {
      try {
        this.csInterface = new window.CSInterface();
      } catch (e) {
        console.warn('CSInterface initialization failed:', e);
      }
    }
  }

  public static getInstance(): CEPBridgeService {
    if (!CEPBridgeService.instance) {
      CEPBridgeService.instance = new CEPBridgeService();
    }
    return CEPBridgeService.instance;
  }

  /**
   * Evaluates ExtendScript code asynchronously
   */
  public evalScript(script: string): Promise<string> {
    return new Promise((resolve) => {
      if (this.csInterface) {
        this.csInterface.evalScript(script, (result: string) => {
          resolve(result);
        });
      } else {
        // Not in CEP environment
        resolve(JSON.stringify({ simulated: true }));
      }
    });
  }

  /**
   * Converts local file system paths (Windows or Mac) to a file:/// URI for the HTML5 <video> tag
   */
  public pathToLocalURI(filePath: string): string {
    if (!filePath) return '';
    if (filePath.startsWith('file://')) return filePath;

    // Normalize Windows backslashes
    let normalized = filePath.replace(/\\/g, '/');

    // Windows drive letter like C:/
    if (/^[a-zA-Z]:\//.test(normalized)) {
      return `file:///${normalized}`;
    }

    // POSIX path like /Users/...
    if (normalized.startsWith('/')) {
      return `file://${normalized}`;
    }

    return `file:///${normalized}`;
  }

  /**
   * Retrieves active clip info from Premiere Pro timeline
   */
  public async getSelectedClipInfo(): Promise<BridgeResult<ClipInfo>> {
    if (!this.isCEP) {
      // In Dev Mode / Browser Preview, return simulated clip info
      return {
        success: true,
        isSimulated: true,
        data: {
          name: 'Demo_Action_Footage.mp4',
          mediaPath: '',
          durationSeconds: 5.0,
          fps: 30,
          width: 1920,
          height: 1080,
          inPointSeconds: 0,
          outPointSeconds: 5.0,
          startFrame: 0,
          endFrame: 150,
          currentFrame: 0,
        },
      };
    }

    try {
      const resRaw = await this.evalScript('getSelectedClipInfo()');
      const parsed = JSON.parse(resRaw);
      if (parsed.error) {
        return { success: false, error: parsed.error };
      }

      if (parsed.mediaPath) {
        parsed.mediaPath = this.pathToLocalURI(parsed.mediaPath);
      }

      return { success: true, data: parsed };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: 'ExtendScript evaluation failed: ' + errorMsg };
    }
  }

  /**
   * Retrieves all video clips across all tracks on the active sequence
   */
  public async getTimelineClipsList(): Promise<BridgeResult<import('../types/tracker').TimelineClipItem[]>> {
    if (!this.isCEP) {
      // Simulated timeline clips for dev testing
      return {
        success: true,
        isSimulated: true,
        data: [
          {
            trackIndex: 0,
            trackName: 'Video 1',
            clipIndex: 0,
            name: 'Scene01_MainFootage.mp4',
            mediaPath: 'C:\\Projects\\Footage\\Scene01_MainFootage.mp4',
            inPointSeconds: 0,
            outPointSeconds: 8.5,
            durationSeconds: 8.5,
            isSelected: true,
          },
          {
            trackIndex: 1,
            trackName: 'Video 2',
            clipIndex: 0,
            name: 'Drone_Aerial_Track.mp4',
            mediaPath: 'C:\\Projects\\Footage\\Drone_Aerial_Track.mp4',
            inPointSeconds: 2.0,
            outPointSeconds: 7.0,
            durationSeconds: 5.0,
            isSelected: false,
          },
          {
            trackIndex: 2,
            trackName: 'Video 3',
            clipIndex: 0,
            name: 'Overlay_Title_Graphic.png',
            mediaPath: '',
            inPointSeconds: 1.0,
            outPointSeconds: 6.0,
            durationSeconds: 5.0,
            isSelected: false,
          },
        ],
      };
    }

    try {
      const resRaw = await this.evalScript('getTimelineTracks()');
      const parsed = JSON.parse(resRaw);
      const items: import('../types/tracker').TimelineClipItem[] = [];

      if (parsed.tracks && Array.isArray(parsed.tracks)) {
        for (const track of parsed.tracks) {
          if (track.clips && Array.isArray(track.clips)) {
            for (const clip of track.clips) {
              items.push({
                trackIndex: track.trackIndex,
                trackName: track.name || `Video ${track.trackIndex + 1}`,
                clipIndex: clip.index,
                name: clip.name,
                mediaPath: clip.mediaPath ? this.pathToLocalURI(clip.mediaPath) : '',
                inPointSeconds: clip.inPoint || 0,
                outPointSeconds: clip.outPoint || 0,
                durationSeconds: (clip.outPoint || 0) - (clip.inPoint || 0),
                isSelected: !!clip.selected,
              });
            }
          }
        }
      }

      return { success: true, data: items };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: 'Failed to retrieve timeline tracks: ' + errorMsg };
    }
  }

  /**
   * Applies tracking data to selected timeline clip
   */
  public async applyTrackingData(
    keyframes: ProcessedKeyframe[],
    settings: ExportSettings
  ): Promise<BridgeResult<{ message: string; targetClip?: string; keyframesCount: number }>> {
    const payload = {
      targetType: settings.targetType || 'object',
      applyToTransformEffect: settings.applyToTransformEffect,
      exportPosition: settings.exportPosition,
      exportScale: settings.exportScale,
      exportRotation: settings.exportRotation,
      targetLayerName: settings.targetLayerName,
      isCameraFollow: settings.isCameraFollow || false,
      cameraFollowZoom: settings.cameraFollowZoom || 125,
      isStabilize: settings.isStabilize || false,
      stabilizeStrength: settings.stabilizeStrength ?? 100,
      stabilizeZoom: settings.stabilizeZoom || 115,
      canvasWidth: 640,
      canvasHeight: 360,
      keyframes: keyframes.map((k) => ({
        frameNumber: k.frameNumber,
        timeSeconds: k.timeSeconds,
        x: k.x,
        y: k.y,
        scale: k.scale,
        rotation: k.rotation,
      })),
    };

    if (!this.isCEP) {
      // First try pushing directly to the Premiere Pro CEP Panel's local live bridge (http://127.0.0.1:17890/apply)
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const res = await fetch('http://127.0.0.1:17890/apply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          const parsed = await res.json();
          if (parsed && parsed.error) {
            return { success: false, error: parsed.error };
          }
          if (parsed && parsed.status === 'success') {
            return {
              success: true,
              isSimulated: false,
              data: {
                message: parsed.message || `Applied ${keyframes.length} keyframes directly to Premiere Pro timeline!`,
                targetClip: parsed.targetClip,
                keyframesCount: parsed.keyframesCount || keyframes.length,
              },
            };
          }
        }
      } catch {
        // Local CEP bridge not reachable yet — fall back to simulated mode + 1-Click .bat Injector modal
      }

      const modeDesc = settings.isStabilize
        ? `Video Stabilization (${settings.stabilizeStrength ?? 100}% Strength, ${settings.stabilizeZoom || 115}% Zoom)`
        : settings.isCameraFollow
        ? `Camera Follow (${settings.cameraFollowZoom || 125}% Zoom)`
        : settings.applyToTransformEffect
        ? 'Transform Effect'
        : 'Vector Motion / Intrinsic Motion';
      return {
        success: true,
        isSimulated: true,
        data: {
          message: `Ready to inject ${keyframes.length} keyframes (${modeDesc}) into Premiere Pro! Use the 1-Click Updater & Injector (.bat) or Paste box.`,
          targetClip: settings.targetLayerName || 'Selected Graphic / Text Layer',
          keyframesCount: keyframes.length,
        },
      };
    }

    try {
      const payloadString = JSON.stringify(payload).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      const scriptCall = `${HOST_JSX}\napplyTrackingData('${payloadString}')`;
      const resRaw = await this.evalScript(scriptCall);
      const parsed = JSON.parse(resRaw);

      if (parsed.error) {
        return { success: false, error: parsed.error };
      }
      return {
        success: true,
        isSimulated: false,
        data: {
          message: parsed.message || 'Keyframes applied successfully.',
          targetClip: parsed.targetClip,
          keyframesCount: parsed.keyframesCount,
        },
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: 'ExtendScript failed: ' + errorMsg };
    }
  }

  /**
   * Mode A: Reads tracked mask or point effect keyframes
   */
  public async readMaskOrPointEffectData(): Promise<BridgeResult<{ points: Array<{ timeSeconds: number; x: number; y: number }>; source: string }>> {
    if (!this.isCEP) {
      // Simulate detecting keyframes from a helper point effect
      const simulatedPoints = [];
      const totalKeys = 60;
      for (let i = 0; i < totalKeys; i++) {
        const t = i / 30;
        simulatedPoints.push({
          timeSeconds: t,
          x: 960 + Math.sin(t * 3) * 240,
          y: 540 + Math.cos(t * 2) * 120,
        });
      }
      return {
        success: true,
        isSimulated: true,
        data: {
          source: 'Simulated: Circle > Center Keyframes (Mode A)',
          points: simulatedPoints,
        },
      };
    }

    try {
      const resRaw = await this.evalScript('readMaskOrPointEffectData()');
      const parsed = JSON.parse(resRaw);
      if (parsed.error) {
        return { success: false, error: parsed.error };
      }
      if (parsed.status === 'empty') {
        return { success: false, error: parsed.message };
      }
      return { success: true, data: { points: parsed.points, source: parsed.source } };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: 'Error reading mask/point data: ' + errorMsg };
    }
  }
}
