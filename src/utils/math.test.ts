import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  secondsToTimecode,
  smooth1D,
  processKeyframeData,
  generateAdobeKeyframeText,
  computeCameraFollowKeyframes,
  computeStabilizeKeyframes,
  compute3DSurfacePose,
  trimKeyframesByFrameRange,
  trimKeyframesByTimeRange,
  isSupportedVideoFile,
  needsServerRemuxOrTranscode,
  matchTemplateNCC,
  snapToStrongestFeature,
  blendForwardBackwardKeyframes,
  nudgeKeyframeWithRipple,
  computeMotionBlurVectors,
} from './math.ts';
import { remuxTSToMP4, isMPEGTransportStream } from './tsRemuxer.ts';
import { createWindowsInstallerBat, createZipCopyInstallerBat } from '../services/cepExportFiles.ts';
import { RawKeyframe, ProcessedKeyframe } from '../types/tracker.ts';

describe('Math and Tracker Utilities', () => {
  test('compute3DSurfacePose computes accurate 3D yaw, pitch, roll, and perspective scale from 4 free-form corner pins', () => {
    const refCorners = {
      p1: { x: 400, y: 300 }, // Top-Left
      p2: { x: 800, y: 300 }, // Top-Right (width 400)
      p3: { x: 800, y: 600 }, // Bottom-Right (height 300)
      p4: { x: 400, y: 600 }, // Bottom-Left
    };

    // Identity pose at reference frame
    const refPose = compute3DSurfacePose(refCorners, refCorners);
    assert.equal(refPose.centerX, 600);
    assert.equal(refPose.centerY, 450);
    assert.ok(Math.abs(refPose.scale - 100) < 0.01);
    assert.ok(Math.abs(refPose.yaw3D) < 0.01);
    assert.ok(Math.abs(refPose.pitch3D) < 0.01);
    assert.ok(Math.abs(refPose.rotation) < 0.01);

    // Perspective foreshortening: right edge grows taller (340px) while left edge shrinks (260px) -> positive 3D Yaw (Swivel)
    // and bottom edge widens (440px) while top edge narrows (360px) -> positive 3D Pitch (Tilt)
    const tiltedCorners = {
      p1: { x: 420, y: 320 },
      p2: { x: 780, y: 280 },
      p3: { x: 820, y: 620 },
      p4: { x: 380, y: 580 },
    };
    const pose3D = compute3DSurfacePose(tiltedCorners, refCorners);
    assert.ok(pose3D.yaw3D > 8, `Expected positive 3D yaw > 8 deg from right-edge perspective expansion, got ${pose3D.yaw3D}`);
    assert.ok(pose3D.pitch3D > 8, `Expected positive 3D pitch > 8 deg from bottom-edge perspective expansion, got ${pose3D.pitch3D}`);
  });

  test('processKeyframeData and generateAdobeKeyframeText support 4-Pin 3D Surface Corner Pin and 3D X/Y Rotation', () => {
    const rawKeyframes: RawKeyframe[] = [
      {
        frameNumber: 0,
        timeSeconds: 0,
        points: {
          p1: { x: 500, y: 300 },
          p2: { x: 900, y: 300 },
          p3: { x: 900, y: 600 },
          p4: { x: 500, y: 600 },
        },
        confidence: 0.99,
      },
      {
        frameNumber: 1,
        timeSeconds: 0.033,
        points: {
          p1: { x: 520, y: 310 },
          p2: { x: 910, y: 295 },
          p3: { x: 930, y: 615 },
          p4: { x: 510, y: 595 },
        },
        confidence: 0.98,
      },
    ];

    const processed = processKeyframeData(rawKeyframes, 4, 0, 0, 0, 100, 0, 30);
    assert.equal(processed.length, 2);
    assert.ok(processed[0].corners !== undefined, 'Expected 4-pin corners to be populated');
    assert.equal(processed[0].x, 700);
    assert.equal(processed[0].y, 450);
    assert.ok(processed[1].yaw3D !== undefined && processed[1].yaw3D !== 0, 'Expected non-zero 3D yaw on frame 1');

    const adobeText = generateAdobeKeyframeText(processed, {
      fps: 30,
      width: 1920,
      height: 1080,
      exportPosition: true,
      exportScale: true,
      exportRotation: true,
      exportCornerPin3D: true,
    });
    assert.ok(adobeText.includes('Effects\tCorner Pin #1\tUpper Left'), 'Expected Corner Pin Upper Left section');
    assert.ok(adobeText.includes('Effects\tCorner Pin #1\tUpper Right'), 'Expected Corner Pin Upper Right section');
    assert.ok(adobeText.includes('Effects\tCorner Pin #1\tLower Left'), 'Expected Corner Pin Lower Left section');
    assert.ok(adobeText.includes('Effects\tCorner Pin #1\tLower Right'), 'Expected Corner Pin Lower Right section');
    assert.ok(adobeText.includes('Transform\tY Rotation'), 'Expected 3D Y Rotation (Yaw/Swivel) section');
    assert.ok(adobeText.includes('Transform\tX Rotation'), 'Expected 3D X Rotation (Pitch/Tilt) section');
  });

  test('trimKeyframesByTimeRange and trimKeyframesByFrameRange delete bad track segments (e.g. keep first 5s of 8s track, delete last 3s)', () => {
    // Simulate an 8-second track at 10 fps (frames 0..80, 0.0s..8.0s)
    const eightSecondTrack: RawKeyframe[] = [];
    for (let f = 0; f <= 80; f++) {
      eightSecondTrack.push({
        frameNumber: f,
        timeSeconds: f / 10,
        points: { p1: { x: 100 + f * 5, y: 200 + f * 2 } },
        confidence: f <= 50 ? 0.98 : 0.25, // First 5s (0..50) are good, last 3s (51..80) are messed up
      });
    }

    // 1. Keep only 0s to 5s using keep-only-range mode
    const keptFirst5s = trimKeyframesByTimeRange(eightSecondTrack, 0, 5.0, 'keep-only-range');
    assert.equal(keptFirst5s.length, 51); // frames 0..50 inclusive
    assert.equal(keptFirst5s[0].timeSeconds, 0);
    assert.equal(keptFirst5s[keptFirst5s.length - 1].timeSeconds, 5.0);

    // 2. Delete 5.1s to 8.0s using delete-range mode
    const deletedLast3s = trimKeyframesByTimeRange(eightSecondTrack, 5.1, 8.0, 'delete-range');
    assert.equal(deletedLast3s.length, 51);
    assert.equal(deletedLast3s[deletedLast3s.length - 1].frameNumber, 50);

    // 3. Frame-based keep-only-range from frame 0 to playhead frame 50 (5.0s)
    const playheadTrim = trimKeyframesByFrameRange(eightSecondTrack, 0, 50, 'keep-only-range');
    assert.equal(playheadTrim.length, 51);
    assert.equal(playheadTrim[playheadTrim.length - 1].frameNumber, 50);
  });

  test('isSupportedVideoFile recognizes .ts, .mkv, .mxf, .mov, .mp4 even when MIME is empty or TypeScript', () => {
    // Windows often reports .ts (MPEG Transport Stream) as text/vnd.trolltech.linguist or video/mp2t or empty string
    assert.equal(isSupportedVideoFile({ name: 'broadcast_capture.ts', type: 'text/vnd.trolltech.linguist' }), true);
    assert.equal(isSupportedVideoFile({ name: 'camcorder_clip.mts', type: '' }), true);
    assert.equal(isSupportedVideoFile({ name: 'bluray_stream.m2ts', type: '' }), true);
    assert.equal(isSupportedVideoFile({ name: 'obs_recording.mkv', type: '' }), true);
    assert.equal(isSupportedVideoFile({ name: 'cinema_camera.mxf', type: 'application/octet-stream' }), true);
    assert.equal(isSupportedVideoFile({ name: 'prores_footage.mov', type: 'video/quicktime' }), true);
    assert.equal(isSupportedVideoFile({ name: 'red_raw.r3d', type: '' }), true);
    assert.equal(isSupportedVideoFile({ name: 'blackmagic.braw', type: '' }), true);
    assert.equal(isSupportedVideoFile({ name: 'standard.mp4', type: 'video/mp4' }), true);
    assert.equal(isSupportedVideoFile({ name: 'document.pdf', type: 'application/pdf' }), false);
  });

  test('needsServerRemuxOrTranscode flags .ts, .mkv, .mxf, .avi for FFmpeg H.264 stream conversion', () => {
    assert.equal(needsServerRemuxOrTranscode('match_highlight.ts'), true);
    assert.equal(needsServerRemuxOrTranscode('stream.mkv'), true);
    assert.equal(needsServerRemuxOrTranscode('broadcast.mxf'), true);
    assert.equal(needsServerRemuxOrTranscode('legacy.avi'), true);
    assert.equal(needsServerRemuxOrTranscode('native.mp4'), false);
    assert.equal(needsServerRemuxOrTranscode('native.webm'), false);
  });

  test('matchTemplateNCC with Gaussian weighting + Lucas-Kanade achieves sub-pixel accuracy (< 0.15px error)', () => {
    const tw = 20;
    const th = 20;
    const sw = 48;
    const sh = 48;
    const templateBuf = new Uint8ClampedArray(tw * th * 4);
    const searchBuf = new Uint8ClampedArray(sw * sh * 4);

    // Render a bright Gaussian target at center of template (9.5, 9.5)
    const tCx = (tw - 1) * 0.5;
    const tCy = (th - 1) * 0.5;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const d2 = (x - tCx) * (x - tCx) + (y - tCy) * (y - tCy);
        const val = Math.round(30 + 210 * Math.exp(-d2 / (2 * 3.2 * 3.2)));
        const idx = (y * tw + x) * 4;
        templateBuf[idx] = val;
        templateBuf[idx + 1] = val;
        templateBuf[idx + 2] = val;
        templateBuf[idx + 3] = 255;
      }
    }

    // Place the same target at a known fractional sub-pixel offset in search window:
    // trueOx = 14.35, trueOy = 11.68 -> true center = (14.35 + 10, 11.68 + 10) = (24.35, 21.68)
    const trueOx = 14.35;
    const trueOy = 11.68;
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const tx = x - trueOx;
        const ty = y - trueOy;
        const d2 = (tx - tCx) * (tx - tCx) + (ty - tCy) * (ty - tCy);
        const val = Math.round(30 + 210 * Math.exp(-d2 / (2 * 3.2 * 3.2)));
        const idx = (y * sw + x) * 4;
        searchBuf[idx] = val;
        searchBuf[idx + 1] = val;
        searchBuf[idx + 2] = val;
        searchBuf[idx + 3] = 255;
      }
    }

    const searchData = { data: searchBuf, width: sw, height: sh } as unknown as ImageData;
    const templateData = { data: templateBuf, width: tw, height: th } as unknown as ImageData;

    const res = matchTemplateNCC(searchData, templateData, 100, 200);
    const expectedX = 100 + trueOx + tw / 2;
    const expectedY = 200 + trueOy + th / 2;

    assert.ok(Math.abs(res.bestX - expectedX) < 0.15, `Expected X ~ ${expectedX}, got ${res.bestX}`);
    assert.ok(Math.abs(res.bestY - expectedY) < 0.15, `Expected Y ~ ${expectedY}, got ${res.bestY}`);
    assert.ok(res.score > 0.90, `Expected high confidence score > 0.90, got ${res.score}`);
  });

  test('computeCameraFollowKeyframes computes centered camera reframing coordinates', () => {
    // If football moves right from 960 to 1100, camera moves left to 820 to keep football centered
    const keyframes: ProcessedKeyframe[] = [
      { frameNumber: 0, timeSeconds: 0, timecode: '00:00:00:00', x: 960, y: 540, scale: 100, rotation: 0, confidence: 1 },
      { frameNumber: 1, timeSeconds: 0.033, timecode: '00:00:00:01', x: 1100, y: 600, scale: 100, rotation: 0, confidence: 1 }
    ];

    const followKeys = computeCameraFollowKeyframes(keyframes, { sequenceWidth: 1920, sequenceHeight: 1080, zoomPercent: 130 });
    assert.equal(followKeys.length, 2);
    // At center, no offset
    assert.equal(followKeys[0].x, 960);
    assert.equal(followKeys[0].y, 540);
    assert.equal(followKeys[0].scale, 130);

    // Ball moved to 1100 (+140px), so camera inverse position is 960 - 140 = 820
    assert.equal(followKeys[1].x, 820);
    assert.equal(followKeys[1].y, 480);
    assert.equal(followKeys[1].scale, 130);
  });

  test('generateAdobeKeyframeText outputs valid Adobe format with Ctrl+V compatibility', () => {
    const keyframes: ProcessedKeyframe[] = [
      { frameNumber: 0, timeSeconds: 0, timecode: '00:00:00:00', x: 960, y: 540, scale: 100, rotation: 0, confidence: 1 },
      { frameNumber: 1, timeSeconds: 0.033, timecode: '00:00:00:01', x: 965.5, y: 542.2, scale: 102, rotation: 1.5, confidence: 1 }
    ];

    const text = generateAdobeKeyframeText(keyframes, { fps: 30, width: 1920, height: 1080 });
    assert.ok(text.includes('Adobe After Effects 8.0 Keyframe Data'));
    assert.ok(text.includes('Transform\tPosition'));
    assert.ok(text.includes('Transform\tScale'));
    assert.ok(text.includes('Transform\tRotation'));
    assert.ok(text.includes('960.000000\t540.000000'));
    assert.ok(text.includes('End of Keyframe Data'));
  });
  test('secondsToTimecode formats standard 30fps accurately', () => {
    assert.equal(secondsToTimecode(0, 30), '00:00:00:00');
    assert.equal(secondsToTimecode(1.0, 30), '00:00:01:00');
    assert.equal(secondsToTimecode(65.5, 30), '00:01:05:15');
    assert.equal(secondsToTimecode(3661.1, 30), '01:01:01:03');
  });

  test('smooth1D leaves constant array unchanged', () => {
    const input = [100, 100, 100, 100, 100];
    const smoothed = smooth1D(input, 2);
    for (const val of smoothed) {
      assert.ok(Math.abs(val - 100) < 1e-4);
    }
  });

  test('smooth1D smooths impulse noise spike', () => {
    const input = [0, 0, 100, 0, 0];
    const smoothed = smooth1D(input, 2);
    // Peak should be significantly attenuated by Gaussian kernel
    assert.ok(smoothed[2] < 70);
    assert.ok(smoothed[1] > 0);
    assert.ok(smoothed[3] > 0);
  });

  test('processKeyframeData correctly calculates 1-point offset and coordinates', () => {
    const rawKeyframes: RawKeyframe[] = [
      { frameNumber: 0, timeSeconds: 0, points: { p1: { x: 100, y: 200 } }, confidence: 1 },
      { frameNumber: 1, timeSeconds: 0.033, points: { p1: { x: 110, y: 210 } }, confidence: 1 },
      { frameNumber: 2, timeSeconds: 0.066, points: { p1: { x: 120, y: 220 } }, confidence: 1 },
    ];

    const result = processKeyframeData(
      rawKeyframes,
      false, // isTwoPoint = false
      0,     // smoothing = 0
      15,    // offsetX = 15
      -20,   // offsetY = -20
      100,
      0,
      30
    );

    assert.equal(result.length, 3);
    assert.equal(result[0].x, 115);
    assert.equal(result[0].y, 180);
    assert.equal(result[2].x, 135);
    assert.equal(result[2].y, 200);
  });

  test('processKeyframeData computes 2-point rotation and scale correctly', () => {
    const rawKeyframes: RawKeyframe[] = [
      // Frame 0: horizontal distance 100
      {
        frameNumber: 0,
        timeSeconds: 0,
        points: {
          p1: { x: 100, y: 100 },
          p2: { x: 200, y: 100 },
        },
        confidence: 1,
      },
      // Frame 1: scaled 1.5x (distance 150)
      {
        frameNumber: 1,
        timeSeconds: 0.033,
        points: {
          p1: { x: 100, y: 100 },
          p2: { x: 250, y: 100 },
        },
        confidence: 1,
      },
    ];

    const result = processKeyframeData(
      rawKeyframes,
      true, // isTwoPoint
      0,
      0,
      0,
      100,
      0,
      30
    );

    assert.equal(result.length, 2);
    // Base scale is 100%
    assert.equal(result[0].scale, 100);
    // Frame 1 scale is 150%
    assert.equal(result[1].scale, 150);
    // Angle is 0 degrees
    assert.equal(result[0].rotation, 0);
  });

  test('computeStabilizeKeyframes computes counter-motion, counter-rotation, and border-safe zoom relative to Frame 0', () => {
    const keyframes: ProcessedKeyframe[] = [
      { frameNumber: 0, timeSeconds: 0, timecode: '00:00:00:00', x: 1200, y: 300, scale: 100, rotation: 2.0, confidence: 1 },
      { frameNumber: 1, timeSeconds: 0.033, timecode: '00:00:00:01', x: 1230, y: 280, scale: 100, rotation: 5.5, confidence: 1 },
    ];

    const stabKeys = computeStabilizeKeyframes(keyframes, {
      sequenceWidth: 1920,
      sequenceHeight: 1080,
      strengthPercent: 100,
      zoomPercent: 115,
    });

    assert.equal(stabKeys.length, 2);
    // Frame 0 stays at sequence center (960, 540) with 0 deg delta rotation and 115% zoom
    assert.equal(stabKeys[0].x, 960);
    assert.equal(stabKeys[0].y, 540);
    assert.equal(stabKeys[0].rotation, 0);
    assert.equal(stabKeys[0].scale, 115);

    // Frame 1 moved +30px in X and -20px in Y, and +3.5 deg in rotation
    // Counter-motion should shift clip to (960 - 30 = 930, 540 - (-20) = 560) and rotation -3.5 deg
    assert.equal(stabKeys[1].x, 930);
    assert.equal(stabKeys[1].y, 560);
    assert.equal(stabKeys[1].rotation, -3.5);
    assert.equal(stabKeys[1].scale, 115);
  });

  test('snapToStrongestFeature locates a high-contrast micro-corner within the search radius', () => {
    const w = 64;
    const h = 64;
    const buf = new Uint8ClampedArray(w * h * 4);
    // Create a sharp bright corner at (x >= 35, y >= 28)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const val = x >= 35 && y >= 28 ? 240 : 20;
        const idx = (y * w + x) * 4;
        buf[idx] = val;
        buf[idx + 1] = val;
        buf[idx + 2] = val;
        buf[idx + 3] = 255;
      }
    }
    const imgData = { data: buf, width: w, height: h } as unknown as ImageData;
    // Click roughly near (29, 22) and snap within 14px radius
    const snapped = snapToStrongestFeature(imgData, 29, 22, 14);
    assert.ok(Math.abs(snapped.x - 35) <= 1.5, `Expected snapped X near 35, got ${snapped.x}`);
    assert.ok(Math.abs(snapped.y - 28) <= 1.5, `Expected snapped Y near 28, got ${snapped.y}`);
    assert.ok(snapped.strength > 0.1, `Expected positive corner strength, got ${snapped.strength}`);
  });

  test('blendForwardBackwardKeyframes blends forward and backward passes with temporal ramp and confidence weighting', () => {
    const forward: RawKeyframe[] = [
      { frameNumber: 0, timeSeconds: 0, points: { p1: { x: 100, y: 100 } }, confidence: 0.99 },
      { frameNumber: 1, timeSeconds: 0.033, points: { p1: { x: 110, y: 100 } }, confidence: 0.80 },
      { frameNumber: 2, timeSeconds: 0.066, points: { p1: { x: 124, y: 100 } }, confidence: 0.60 }, // drifted +4px at end
    ];
    const backward: RawKeyframe[] = [
      { frameNumber: 0, timeSeconds: 0, points: { p1: { x: 96, y: 100 } }, confidence: 0.60 }, // drifted -4px at start
      { frameNumber: 1, timeSeconds: 0.033, points: { p1: { x: 110, y: 100 } }, confidence: 0.80 },
      { frameNumber: 2, timeSeconds: 0.066, points: { p1: { x: 120, y: 100 } }, confidence: 0.99 },
    ];

    const blended = blendForwardBackwardKeyframes(forward, backward);
    assert.equal(blended.length, 3);
    // At frame 0 (t=0), forward pass dominates
    assert.ok(Math.abs(blended[0].points.p1.x - 100) < 0.01);
    // At frame 1 (midpoint), both agree at 110
    assert.ok(Math.abs(blended[1].points.p1.x - 110) < 0.01);
    // At frame 2 (t=1), backward pass dominates
    assert.ok(Math.abs(blended[2].points.p1.x - 120) < 0.01);
  });

  test('nudgeKeyframeWithRipple applies exact correction at target frame and smoothly feathers across neighbors', () => {
    const raw: RawKeyframe[] = [];
    for (let f = 0; f <= 10; f++) {
      raw.push({
        frameNumber: f,
        timeSeconds: f / 30,
        points: { p1: { x: 200, y: 150 } },
        confidence: 0.9,
      });
    }

    // Nudge frame 5 by (+20, -10) with ripple radius 4 frames
    const nudged = nudgeKeyframeWithRipple(raw, 5, 'p1', { x: 220, y: 140 }, 4);
    // Exact target frame 5 has full delta (+20, -10) and confidence 1.0
    assert.equal(nudged[5].points.p1.x, 220);
    assert.equal(nudged[5].points.p1.y, 140);
    assert.equal(nudged[5].confidence, 1.0);
    // Neighbor frame 4 has partial feathered correction (between 200 and 220)
    assert.ok(nudged[4].points.p1.x > 205 && nudged[4].points.p1.x < 220);
    // Frame 0 (outside radius 4 from frame 5) is untouched
    assert.equal(nudged[0].points.p1.x, 200);
    assert.equal(nudged[0].points.p1.y, 150);
  });

  test('computeMotionBlurVectors and generateAdobeKeyframeText export Premiere Transform Shutter Angle & Directional Blur', () => {
    const raw: RawKeyframe[] = [
      { frameNumber: 0, timeSeconds: 0, points: { p1: { x: 100, y: 180 } }, confidence: 1 },
      { frameNumber: 1, timeSeconds: 0.033, points: { p1: { x: 130, y: 180 } }, confidence: 1 }, // moving +30px right per frame
      { frameNumber: 2, timeSeconds: 0.066, points: { p1: { x: 160, y: 180 } }, confidence: 1 },
    ];

    const processed = processKeyframeData(raw, 1, 0, 0, 0, 100, 0, 30, 180);
    assert.equal(processed.length, 3);
    // Moving purely horizontally right (+X, 0 Y) -> Adobe Direction angle = 90 deg (East), velocityX = 30
    assert.equal(processed[1].velocityX, 30);
    assert.equal(processed[1].velocityY, 0);
    assert.equal(processed[1].motionBlurAngle, 90);
    assert.ok((processed[1].motionBlurLength || 0) > 5, `Expected positive motion blur length, got ${processed[1].motionBlurLength}`);

    const textWithBlur = generateAdobeKeyframeText(processed, {
      fps: 30,
      width: 1920,
      height: 1080,
      enableMotionBlur: true,
      shutterAngle: 225,
    });
    assert.ok(textWithBlur.includes("Effects\tTransform #1\tUse Composition's Shutter Angle #10"), 'Expected Use Composition Shutter Angle override');
    assert.ok(textWithBlur.includes('Effects\tTransform #1\tShutter Angle #11'), 'Expected Transform Shutter Angle header');
    assert.ok(textWithBlur.includes('225.000000'), 'Expected 225 deg Shutter Angle value');
    assert.ok(textWithBlur.includes('Effects\tDirectional Blur #1\tDirection #1'), 'Expected Directional Blur Direction keyframes');
    assert.ok(textWithBlur.includes('Effects\tDirectional Blur #1\tBlur Length #2'), 'Expected Directional Blur Length keyframes');
  });

  test('remuxTSToMP4 demuxes an H.264 MPEG-2 Transport Stream (.ts) into a valid ISO-BMFF MP4 container', () => {
    assert.equal(isMPEGTransportStream('camera_capture.ts'), true);
    assert.equal(isMPEGTransportStream('avchd_clip.mts'), true);
    assert.equal(isMPEGTransportStream('bluray.m2ts'), true);
    assert.equal(isMPEGTransportStream('normal.mp4'), false);

    // Construct a 3-packet synthetic 188-byte MPEG-TS stream (PAT + PMT + PES with H.264 SPS, PPS, and IDR slice)
    const tsBuf = new Uint8Array(188 * 3);

    // Packet 0: PAT (PID 0x0000) mapping Program 1 -> PMT PID 0x0100
    tsBuf[0] = 0x47;
    tsBuf[1] = 0x40; // PUSI = 1, PID = 0
    tsBuf[2] = 0x00;
    tsBuf[3] = 0x10; // payload only
    tsBuf[4] = 0x00; // pointer_field = 0
    tsBuf[5] = 0x00; // table_id = 0 (PAT)
    tsBuf[6] = 0xb0;
    tsBuf[7] = 0x0d; // section_length = 13
    tsBuf[13] = 0x00; tsBuf[14] = 0x01; // program_number = 1
    tsBuf[15] = 0xe1; tsBuf[16] = 0x00; // PMT PID = 0x0100

    // Packet 1: PMT (PID 0x0100) mapping H.264 stream_type 0x1B -> Video PID 0x0101
    const p1 = 188;
    tsBuf[p1 + 0] = 0x47;
    tsBuf[p1 + 1] = 0x41; // PUSI = 1, PID = 0x0100
    tsBuf[p1 + 2] = 0x00;
    tsBuf[p1 + 3] = 0x10;
    tsBuf[p1 + 4] = 0x00; // pointer_field = 0
    tsBuf[p1 + 5] = 0x02; // table_id = 2 (PMT)
    tsBuf[p1 + 6] = 0xb0;
    tsBuf[p1 + 7] = 0x12; // section_length = 18
    tsBuf[p1 + 15] = 0x00; tsBuf[p1 + 16] = 0x00; // program_info_length = 0
    tsBuf[p1 + 17] = 0x1b; // stream_type = 0x1B (H.264)
    tsBuf[p1 + 18] = 0xe1; tsBuf[p1 + 19] = 0x01; // elementary_PID = 0x0101
    tsBuf[p1 + 20] = 0xf0; tsBuf[p1 + 21] = 0x00; // ES_info_length = 0

    // Packet 2: Video PES (PID 0x0101) with PTS + Annex-B SPS (type 7), PPS (type 8), IDR Slice (type 5)
    const p2 = 376;
    tsBuf[p2 + 0] = 0x47;
    tsBuf[p2 + 1] = 0x41; // PUSI = 1, PID = 0x0101
    tsBuf[p2 + 2] = 0x01;
    tsBuf[p2 + 3] = 0x10;
    const pesAndNals = [
      // PES Header
      0x00, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x80, 0x80, 0x05, 0x21, 0x00, 0x01, 0x00, 0x01,
      // SPS NAL (type 7)
      0x00, 0x00, 0x00, 0x01, 0x67, 0x64, 0x00, 0x28, 0xac, 0xd9, 0x40, 0x78, 0x02, 0x27, 0xe5, 0xc0,
      // PPS NAL (type 8)
      0x00, 0x00, 0x00, 0x01, 0x68, 0xeb, 0xe3, 0xcb, 0x22, 0xc0,
      // IDR Slice NAL (type 5)
      0x00, 0x00, 0x00, 0x01, 0x65, 0x88, 0x84, 0x00, 0x33, 0xff
    ];
    tsBuf.set(pesAndNals, p2 + 4);

    const mp4Bytes = remuxTSToMP4(tsBuf);
    assert.ok(mp4Bytes !== null, 'Expected remuxTSToMP4 to return non-null MP4 buffer');
    // Verify ISO-BMFF 'ftyp' header at offset 4..8
    const boxType = String.fromCharCode(mp4Bytes[4], mp4Bytes[5], mp4Bytes[6], mp4Bytes[7]);
    assert.equal(boxType, 'ftyp');
    assert.ok(mp4Bytes.length > 200, 'Expected valid MP4 container size');
  });

  test('createWindowsInstallerBat and createZipCopyInstallerBat are 100% plain-text and free of Antivirus/Defender triggers', () => {
    const zipBat = createZipCopyInstallerBat();
    assert.ok(zipBat.includes('reg add "HKCU\\Software\\Adobe\\CSXS.%%V" /v PlayerDebugMode'), 'Expected native reg add for PlayerDebugMode');
    assert.ok(zipBat.includes('copy /Y "%~dp0CSXS\\manifest.xml"'), 'Expected native copy command for manifest.xml');
    assert.ok(zipBat.includes('copy /Y "%~dp0jsx\\host.jsx"'), 'Expected native copy command for host.jsx');
    assert.equal(zipBat.includes('powershell'), false, 'Expected ZIP installer .bat to use zero PowerShell');
    assert.equal(zipBat.includes('FromBase64String'), false, 'Expected zero Base64 decoding');
    assert.equal(zipBat.includes('-EncodedCommand'), false, 'Expected zero -EncodedCommand');

    const standaloneBat = createWindowsInstallerBat({ keyframes: [{ frameNumber: 0, x: 320, y: 180 }] });
    // Must NOT contain any obfuscated PowerShell or binary dropper patterns that trigger Windows Defender Wacatac
    assert.equal(standaloneBat.includes('-EncodedCommand'), false, 'Standalone .bat must not use -EncodedCommand');
    assert.equal(standaloneBat.includes('FromBase64String'), false, 'Standalone .bat must not use FromBase64String');
    assert.equal(standaloneBat.includes('Invoke-Expression'), false, 'Standalone .bat must not use Invoke-Expression');
    assert.equal(standaloneBat.includes('-ExecutionPolicy Bypass'), false, 'Standalone .bat must not use -ExecutionPolicy Bypass');

    // Must contain all 6 readable plain-text file markers and live payload marker
    assert.ok(standaloneBat.includes('::::FILE::::CSXS\\manifest.xml'), 'Expected plain-text manifest.xml section');
    assert.ok(standaloneBat.includes('::::FILE::::jsx\\host.jsx'), 'Expected plain-text host.jsx section');
    assert.ok(standaloneBat.includes('::::FILE::::index.html'), 'Expected plain-text index.html section');
    assert.ok(standaloneBat.includes('::::FILE::::style.css'), 'Expected plain-text style.css section');
    assert.ok(standaloneBat.includes('::::FILE::::CSInterface.js'), 'Expected plain-text CSInterface.js section');
    assert.ok(standaloneBat.includes('::::FILE::::main.js'), 'Expected plain-text main.js section');
    assert.ok(standaloneBat.includes('::::LIVE_PAYLOAD::::motiontracker_live_payload.json'), 'Expected plain-text live payload section');
    assert.ok(standaloneBat.includes('::::ENDFILE::::'), 'Expected plain-text end marker');

    // Must remove legacy MotionTrackerPro / com.motiontracker.pro / MotionTracker_by_Nightosphere folders and install to MotionTracker_by_Nightosphere_CEP
    assert.ok(standaloneBat.includes('rmdir /S /Q "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTrackerPro"'), 'Expected legacy MotionTrackerPro cleanup in standalone .bat');
    assert.ok(standaloneBat.includes('set "MT_DEST=%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP"'), 'Expected MotionTracker_by_Nightosphere_CEP destination folder in standalone .bat');
    assert.ok(zipBat.includes('set "DEST=%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP"'), 'Expected MotionTracker_by_Nightosphere_CEP destination folder in ZIP .bat');
    assert.ok(standaloneBat.includes('com.nightosphere.motiontracker.panel'), 'Expected com.nightosphere.motiontracker.panel extension ID');
    assert.ok(standaloneBat.includes('<Menu>MotionTracker by Nightosphere</Menu>'), 'Expected MotionTracker by Nightosphere menu title');

    // Must include Nightosphere logo instead of plain MT badge in Premiere Pro CEP HTML
    assert.equal(standaloneBat.includes('<span class="logo-badge">MT</span>'), false, 'Expected MT text badge to be replaced by Nightosphere logo');
    assert.ok(standaloneBat.includes('aria-label="Nightosphere Logo"'), 'Expected Nightosphere logo in Premiere Pro CEP HTML');

    // Premiere Pro CEP Panel must include Pan Mode, Corner Snap, Bi-Dir Refine, Motion Blur Shutter Angle, and 8px Micro-Point Feature Size
    assert.ok(standaloneBat.includes('id="btn-pan-mode"'), 'Expected #btn-pan-mode button in Premiere Pro CEP HTML');
    assert.ok(standaloneBat.includes('id="btn-snap-feature"'), 'Expected #btn-snap-feature button in Premiere Pro CEP HTML');
    assert.ok(standaloneBat.includes('id="btn-bidi-track"'), 'Expected #btn-bidi-track button in Premiere Pro CEP HTML');
    assert.ok(standaloneBat.includes('id="chk-motion-blur"'), 'Expected #chk-motion-blur toggle in Premiere Pro CEP HTML');
    assert.ok(standaloneBat.includes('id="slider-shutter-angle"'), 'Expected #slider-shutter-angle in Premiere Pro CEP HTML');
    assert.ok(standaloneBat.includes('id="chk-auto-pause"'), 'Expected #chk-auto-pause in Premiere Pro CEP HTML');
    assert.ok(standaloneBat.includes('id="slider-feature" min="8"'), 'Expected 8px micro-point minimum on #slider-feature');
  });
});


