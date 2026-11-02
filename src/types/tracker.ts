export interface Point2D {
  x: number;
  y: number;
}

export interface SurfaceCorners {
  p1: Point2D; // Top-Left
  p2: Point2D; // Top-Right
  p3: Point2D; // Bottom-Right
  p4: Point2D; // Bottom-Left
}

export type PointCountMode = 1 | 2 | 4;

export interface BoxSize {
  width: number;
  height: number;
}

export interface TrackerPoint {
  id: string;
  name: string;
  x: number;
  y: number;
  featureSize: number; // radius or half-box
  searchSize: number;  // search window radius
  color: string;
}

export interface RawKeyframe {
  frameNumber: number;
  timeSeconds: number;
  points: { [id: string]: Point2D };
  confidence: number;
}

export interface ProcessedKeyframe {
  frameNumber: number;
  timeSeconds: number;
  timecode: string;
  // Computed values
  x: number;
  y: number;
  scale: number;    // 100 is base
  scaleX?: number;  // Horizontal perspective foreshortening scale (%)
  scaleY?: number;  // Vertical perspective foreshortening scale (%)
  rotation: number; // 2D Roll degrees
  yaw3D?: number;   // 3D Horizontal Swivel / Yaw degrees (-90 to +90)
  pitch3D?: number; // 3D Vertical Tilt / Pitch degrees (-90 to +90)
  skew?: number;    // Planar shear / perspective skew degrees
  corners?: SurfaceCorners; // 4-Pin Surface planar corners
  velocityX?: number;      // Instantaneous X velocity (px/frame)
  velocityY?: number;      // Instantaneous Y velocity (px/frame)
  motionBlurAngle?: number; // Directional blur angle in degrees (-180 to 180)
  motionBlurLength?: number; // Shutter-scaled directional blur length (px)
  confidence: number;
}

export interface ClipInfo {
  name: string;
  mediaPath: string;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
  inPointSeconds: number;
  outPointSeconds: number;
  startFrame: number;
  endFrame: number;
  currentFrame: number;
}

export interface ExportSettings {
  applyToTransformEffect: boolean; // true = Transform effect, false = Motion component
  exportPosition: boolean;
  exportScale: boolean;
  exportRotation: boolean;
  exportCornerPin3D?: boolean;     // true = Apply 4-Pin Corner Pin & 3D Swivel/Tilt when 4-pin surface tracked
  enableMotionBlur?: boolean;      // true = Enable native Transform Shutter Angle & velocity directional motion blur
  shutterAngle?: number;           // 0 to 360 degrees (180° standard cinema shutter, 360° max blur)
  offsetX: number;
  offsetY: number;
  scaleMultiplier: number;
  rotationOffset: number;
  smoothingFactor: number; // 0 to 20 kernel size
  targetLayerName: string;
  targetType?: 'object' | 'text';
  isCameraFollow?: boolean;    // When true, camera follows the tracked point (e.g. ball/player follow)
  cameraFollowZoom?: number;   // Zoom percentage to prevent edge crop (e.g. 125%)
  isStabilize?: boolean;       // When true, counter-moves/rotates/scales clip to stabilize shaky footage
  stabilizeStrength?: number;  // 10 to 100% stabilization strength (100% = full lock-down)
  stabilizeZoom?: number;      // Border-safe crop zoom percentage (e.g. 115%)
}

export type TrackingMode = 'canvas' | 'surface';

export interface TimelineClipItem {
  trackIndex: number;
  trackName: string;
  clipIndex: number;
  name: string;
  mediaPath: string;
  inPointSeconds: number;
  outPointSeconds: number;
  durationSeconds: number;
  isSelected: boolean;
}

export interface CEPBridgeStatus {
  isCEP: boolean;
  hostVersion: string;
  statusMessage: string;
}

