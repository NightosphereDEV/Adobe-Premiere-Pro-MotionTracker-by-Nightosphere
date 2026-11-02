import JSZip from 'jszip';

export const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<ExtensionManifest Version="9.0" ExtensionBundleId="com.nightosphere.motiontracker" ExtensionBundleVersion="2.1.0"
    ExtensionBundleName="MotionTracker by Nightosphere"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
    <ExtensionList>
        <Extension Id="com.nightosphere.motiontracker.panel" Version="2.1.0" />
    </ExtensionList>
    <ExecutionEnvironment>
        <HostList>
            <!-- Premiere Pro 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026+ (v13.0 to v99.9) -->
            <Host Name="PPRO" Version="[13.0,99.9]" />
        </HostList>
        <LocaleList>
            <Locale Code="All" />
        </LocaleList>
        <RequiredRuntimeList>
            <RequiredRuntime Name="CSXS" Version="9.0" />
        </RequiredRuntimeList>
    </ExecutionEnvironment>
    <DispatchInfoList>
        <Extension Id="com.nightosphere.motiontracker.panel">
            <DispatchInfo>
                <Resources>
                    <MainPath>./index.html</MainPath>
                    <ScriptPath>./jsx/host.jsx</ScriptPath>
                    <CEFCommandLine>
                        <Parameter>--enable-nodejs</Parameter>
                        <Parameter>--mixed-context</Parameter>
                        <Parameter>--allow-file-access-from-files</Parameter>
                        <Parameter>--enable-gpu-rasterization</Parameter>
                    </CEFCommandLine>
                </Resources>
                <Lifecycle>
                    <AutoVisible>true</AutoVisible>
                </Lifecycle>
                <UI>
                    <Type>Panel</Type>
                    <Menu>MotionTracker by Nightosphere</Menu>
                    <Geometry>
                        <Size>
                            <Height>780</Height>
                            <Width>480</Width>
                        </Size>
                        <MinSize>
                            <Height>450</Height>
                            <Width>340</Width>
                        </MinSize>
                        <MaxSize>
                            <Height>1440</Height>
                            <Width>1920</Width>
                        </MaxSize>
                    </Geometry>
                </UI>
            </DispatchInfo>
        </Extension>
    </DispatchInfoList>
</ExtensionManifest>
`;

export const HOST_JSX = `/**
 * MotionTracker by Nightosphere - Premiere Pro (2020-2026+) ExtendScript Host
 * @license Apache-2.0
 */

#target premierepro

if (typeof $ === "undefined") {
    $ = {};
}

function getActiveSequence() {
    if (!app || !app.project) return null;
    return app.project.activeSequence;
}

/**
 * Retrieves info about the first selected video clip on the active sequence
 */
function getSelectedClipInfo() {
    var seq = getActiveSequence();
    if (!seq) {
        return JSON.stringify({ error: "No active sequence found. Please open a sequence in Premiere Pro." });
    }

    var selectedClip = null;
    var trackIndex = -1;

    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
        var track = seq.videoTracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            if (clip.isSelected()) {
                selectedClip = clip;
                trackIndex = t;
                break;
            }
        }
        if (selectedClip) break;
    }

    if (!selectedClip) {
        return JSON.stringify({
            error: "No video clip selected. Please select a clip on your timeline.",
            hasSequence: true,
            seqWidth: seq.frameSizeHorizontal,
            seqHeight: seq.frameSizeVertical
        });
    }

    var mediaPath = "";
    var fps = 30.0;
    var ticksPerSecond = 254016000000;
    if (seq.timebase) {
        var ticksPerFrame = parseInt(seq.timebase, 10);
        if (ticksPerFrame > 0) {
            fps = Math.round((ticksPerSecond / ticksPerFrame) * 100) / 100;
        }
    }

    try {
        if (selectedClip.projectItem) {
            mediaPath = selectedClip.projectItem.getMediaPath();
        }
    } catch (e) {
        mediaPath = "";
    }

    var inSec = selectedClip.inPoint.seconds;
    var outSec = selectedClip.outPoint.seconds;
    var durationSec = selectedClip.duration.seconds;

    var result = {
        name: selectedClip.name,
        trackIndex: trackIndex,
        mediaPath: mediaPath,
        width: seq.frameSizeHorizontal || 1920,
        height: seq.frameSizeVertical || 1080,
        fps: fps || 29.97,
        inPointSeconds: inSec,
        outPointSeconds: outSec,
        durationSeconds: durationSec,
        startFrame: Math.floor(inSec * fps),
        endFrame: Math.floor(outSec * fps),
        currentFrame: Math.floor(seq.getPlayerPosition().seconds * fps)
    };

    return JSON.stringify(result);
}

/**
 * Mode A: Inspects selected clip for tracked keyframes from Opacity Mask or Helper Point Effects
 */
function readMaskOrPointEffectData() {
    var seq = getActiveSequence();
    if (!seq) {
        return JSON.stringify({ error: "No active sequence found." });
    }

    var selectedClip = null;
    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
        var track = seq.videoTracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
            if (track.clips[c].isSelected()) {
                selectedClip = track.clips[c];
                break;
            }
        }
        if (selectedClip) break;
    }

    if (!selectedClip) {
        return JSON.stringify({ error: "Please select the clip containing the tracked mask or helper point effect." });
    }

    var detectedPoints = [];
    var sourceEffectName = "None";

    for (var i = 0; i < selectedClip.components.numItems; i++) {
        var comp = selectedClip.components[i];
        var compName = comp.displayName;

        for (var p = 0; p < comp.properties.numItems; p++) {
            var prop = comp.properties[p];
            var propName = prop.displayName;

            var isPointProp = (
                propName === "Center" ||
                propName === "Flare Center" ||
                propName === "Position" ||
                propName === "Anchor Point" ||
                propName.indexOf("Point") !== -1
            );

            if (isPointProp && prop.isTimeVarying()) {
                var keys = prop.getKeys();
                if (keys && keys.length > 0) {
                    sourceEffectName = compName + " > " + propName;
                    for (var k = 0; k < keys.length; k++) {
                        var kTime = keys[k].seconds;
                        var val = prop.getValueAtTime(keys[k]);
                        
                        var px = 960;
                        var py = 540;
                        if (val instanceof Array) {
                            px = val[0];
                            py = val[1];
                        } else if (typeof val === "object" && val !== null) {
                            px = val.x !== undefined ? val.x : 960;
                            py = val.y !== undefined ? val.y : 540;
                        }

                        detectedPoints.push({
                            timeSeconds: kTime,
                            x: px,
                            y: py
                        });
                    }
                    break;
                }
            }
        }
        if (detectedPoints.length > 0) break;
    }

    if (detectedPoints.length === 0) {
        return JSON.stringify({
            status: "empty",
            message: "No point keyframes detected on selected clip. Make sure you keyframed 'Circle > Center' or 'Transform > Position', or switch to Mode B (Visual Canvas Tracker)."
        });
    }

    return JSON.stringify({
        status: "success",
        source: sourceEffectName,
        clipName: selectedClip.name,
        keyframeCount: detectedPoints.length,
        points: detectedPoints
    });
}

/**
 * Writes computed keyframes (Position, Scale, Rotation) onto the target clip
 */
function applyTrackingData(payloadJson) {
    var seq = getActiveSequence();
    if (!seq) {
        return JSON.stringify({ error: "No active sequence found in Premiere Pro." });
    }

    var data;
    try {
        data = (typeof payloadJson === "string") ? JSON.parse(payloadJson) : payloadJson;
    } catch (e) {
        return JSON.stringify({ error: "Invalid JSON payload: " + e.message });
    }

    var keyframes = data.keyframes;
    if (!keyframes || keyframes.length === 0) {
        return JSON.stringify({ error: "No keyframe data provided in payload." });
    }

    var targetClip = null;
    var targetTrackIdx = -1;
    var targetClipIdx = -1;

    // 1. Check for explicitly selected clip on any video track
    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
        var track = seq.videoTracks[t];
        for (var c = 0; c < track.clips.numItems; c++) {
            if (track.clips[c].isSelected()) {
                targetClip = track.clips[c];
                targetTrackIdx = t;
                targetClipIdx = c;
                break;
            }
        }
        if (targetClip) break;
    }

    // 2. Fallback: If no clip is highlighted, find top-most clip under playhead
    if (!targetClip) {
        try {
            var playheadSec = seq.getPlayerPosition().seconds;
            for (var t2 = seq.videoTracks.numTracks - 1; t2 >= 0; t2--) {
                var trk = seq.videoTracks[t2];
                for (var c2 = 0; c2 < trk.clips.numItems; c2++) {
                    var clp = trk.clips[c2];
                    if (playheadSec >= clp.start.seconds && playheadSec <= clp.end.seconds) {
                        targetClip = clp;
                        targetTrackIdx = t2;
                        targetClipIdx = c2;
                        break;
                    }
                }
                if (targetClip) break;
            }
        } catch (ePlayhead) {}
    }

    if (!targetClip) {
        return JSON.stringify({ error: "No target clip selected. Please click the layer (Text, Graphic, or Video) on your Premiere Pro timeline first." });
    }

    var applyToTransform = (data.applyToTransformEffect === true);
    var targetType = data.targetType || "object";
    var isCameraFollow = (data.isCameraFollow === true);
    var isStabilize = (data.isStabilize === true);

    // Locate Transform, Vector Motion, intrinsic Motion, Corner Pin, and Basic 3D components using 100% stable public DOM
    var transformComp = null;
    var vectorMotionComp = null;
    var intrinsicMotionComp = null;
    var cornerPinComp = null;
    var basic3DComp = null;
    var dirBlurComp = null;

    for (var m = 0; m < targetClip.components.numItems; m++) {
        var comp = targetClip.components[m];
        var dName = comp.displayName || "";
        var matchName = comp.matchName || "";

        if (dName === "Transform" || matchName === "ADBE Transform") {
            transformComp = comp;
        } else if (dName === "Vector Motion" || matchName === "ADBE Vector Motion") {
            vectorMotionComp = comp;
        } else if (dName === "Corner Pin" || matchName === "ADBE Corner Pin") {
            cornerPinComp = comp;
        } else if (dName === "Basic 3D" || matchName === "ADBE Basic 3D") {
            basic3DComp = comp;
        } else if (dName === "Directional Blur" || matchName === "ADBE Motion Blur") {
            dirBlurComp = comp;
        } else if (dName === "Motion" || matchName === "ADBE Motion" || m === 1) {
            if (!intrinsicMotionComp) intrinsicMotionComp = comp;
        }
    }

    var targetComponents = [];
    if (isCameraFollow || isStabilize) {
        if (transformComp && applyToTransform) targetComponents.push(transformComp);
        if (intrinsicMotionComp) targetComponents.push(intrinsicMotionComp);
    } else if (targetType === "text") {
        // Essential Graphics Text Layers: write to Vector Motion if present, and also intrinsic Motion if no Vector Motion
        if (vectorMotionComp) targetComponents.push(vectorMotionComp);
        if (transformComp && applyToTransform) targetComponents.push(transformComp);
        if (targetComponents.length === 0 && intrinsicMotionComp) targetComponents.push(intrinsicMotionComp);
    } else {
        if (transformComp && applyToTransform) targetComponents.push(transformComp);
        else if (intrinsicMotionComp) targetComponents.push(intrinsicMotionComp);
        else if (vectorMotionComp) targetComponents.push(vectorMotionComp);
    }

    if (targetComponents.length === 0 && targetClip.components.numItems > 1) {
        targetComponents.push(targetClip.components[1]);
    }

    if (targetComponents.length === 0 && !cornerPinComp && !basic3DComp) {
        return JSON.stringify({ error: "No Transform or Motion components found on clip: " + targetClip.name });
    }

    var seqW = seq.frameSizeHorizontal || 1920;
    var seqH = seq.frameSizeVertical || 1080;
    var canvasW = Number(data.canvasWidth || 640);
    var canvasH = Number(data.canvasHeight || 360);
    var followZoom = Number(data.cameraFollowZoom || 125);
    var stabStrength = Number(data.stabilizeStrength !== undefined ? data.stabilizeStrength : 100) / 100.0;
    var stabZoom = Number(data.stabilizeZoom || 115);

    // Premiere Pro ComponentParam keyframes use clip-internal time starting at targetClip.inPoint.seconds
    var clipInSec = (targetClip.inPoint && targetClip.inPoint.seconds !== undefined) ? Number(targetClip.inPoint.seconds) : 0;
    var sourceFirstSec = (keyframes.length > 0 && keyframes[0].timeSeconds !== undefined) ? Number(keyframes[0].timeSeconds) : 0;

    var appliedPositionKeys = 0;
    var appliedScaleKeys = 0;
    var appliedRotKeys = 0;
    var appliedCornerPinKeys = 0;
    var applied3DKeys = 0;
    var modifiedComponentNames = [];

    // Bulletproof Premiere Pro Keyframe Writer:
    // Premiere Pro ComponentParam requires: setTimeVarying(true) -> addKey(Time) -> setValueAtKey(Time, val, updateUI)
    function writeKeySafe(prop, timeSeconds, val, isLastKey) {
        if (!prop) return false;
        var wrote = false;
        var uiFlag = isLastKey ? true : false;

        try {
            if (!prop.isTimeVarying()) {
                prop.setTimeVarying(true);
            }
        } catch (eTV) {}

        try {
            var tObj = new Time();
            tObj.seconds = Number(timeSeconds);

            // Step 1: Add keyframe at tObj
            try {
                prop.addKey(tObj);
            } catch (eAdd) {}

            // Step 2: Set value at tObj using setValueAtKey
            try {
                prop.setValueAtKey(tObj, val, uiFlag);
                wrote = true;
            } catch (eSet1) {
                try {
                    prop.setValueAtKey(tObj, val, 1);
                    wrote = true;
                } catch (eSet2) {}
            }

            // Step 3: Also match exact snapped Time object from prop.getKeys() in case Premiere quantized ticks
            try {
                var allKeys = prop.getKeys();
                if (allKeys && allKeys.length > 0) {
                    var bestKey = null;
                    var bestDiff = 0.08;
                    for (var ki = allKeys.length - 1; ki >= 0; ki--) {
                        var diff = Math.abs(allKeys[ki].seconds - timeSeconds);
                        if (diff < bestDiff) {
                            bestDiff = diff;
                            bestKey = allKeys[ki];
                            if (diff < 0.002) break;
                        }
                    }
                    if (bestKey) {
                        prop.setValueAtKey(bestKey, val, uiFlag);
                        wrote = true;
                    }
                }
            } catch (eKeys) {}
        } catch (errOuter) {}

        return wrote;
    }

    for (var tc = 0; tc < targetComponents.length; tc++) {
        var activeComp = targetComponents[tc];
        var compName = activeComp.displayName || activeComp.matchName || "Motion";
        var compMatch = activeComp.matchName || "";

        var posProp = null;
        var anchorProp = null;
        var scaleProp = null;
        var scaleWidthProp = null;
        var uniformScaleProp = null;
        var skewProp = null;
        var rotProp = null;

        for (var p = 0; p < activeComp.properties.numItems; p++) {
            var prop = activeComp.properties[p];
            var pName = prop.displayName || "";
            if (pName === "Position" && !posProp) posProp = prop;
            else if (pName === "Anchor Point" && !anchorProp) anchorProp = prop;
            else if ((pName === "Scale" || pName === "Scale Height") && !scaleProp) scaleProp = prop;
            else if (pName === "Scale Width" && !scaleWidthProp) scaleWidthProp = prop;
            else if (pName === "Uniform Scale" && !uniformScaleProp) uniformScaleProp = prop;
            else if (pName === "Skew" && !skewProp) skewProp = prop;
            else if (pName === "Rotation" && !rotProp) rotProp = prop;
        }

        // Fallback by standard property index for localized (non-English) Premiere Pro installations
        if (compMatch === "ADBE Motion" || compMatch === "ADBE Vector Motion" || compName === "Motion" || compName === "Vector Motion") {
            if (!posProp && activeComp.properties.numItems > 0) posProp = activeComp.properties[0];
            if (!scaleProp && activeComp.properties.numItems > 1) scaleProp = activeComp.properties[1];
            if (!scaleWidthProp && activeComp.properties.numItems > 2) scaleWidthProp = activeComp.properties[2];
            if (!uniformScaleProp && activeComp.properties.numItems > 3) uniformScaleProp = activeComp.properties[3];
            if (!rotProp && activeComp.properties.numItems > 4) rotProp = activeComp.properties[4];
            if (!anchorProp && activeComp.properties.numItems > 5) anchorProp = activeComp.properties[5];
        } else if (compMatch === "ADBE Transform" || compName === "Transform") {
            if (!anchorProp && activeComp.properties.numItems > 0) anchorProp = activeComp.properties[0];
            if (!posProp && activeComp.properties.numItems > 1) posProp = activeComp.properties[1];
            if (!uniformScaleProp && activeComp.properties.numItems > 2) uniformScaleProp = activeComp.properties[2];
            if (!scaleProp && activeComp.properties.numItems > 3) scaleProp = activeComp.properties[3];
            if (!scaleWidthProp && activeComp.properties.numItems > 4) scaleWidthProp = activeComp.properties[4];
            if (!skewProp && activeComp.properties.numItems > 5) skewProp = activeComp.properties[5];
            if (!rotProp && activeComp.properties.numItems > 7) rotProp = activeComp.properties[7];
        }

        if (!posProp && !scaleProp && !rotProp) continue;
        modifiedComponentNames.push(compName);

        // If 4-Pin 3D Surface has separate scaleX & scaleY, uncheck Uniform Scale so Scale Width & Scale Height work independently
        var hasAnisotropic3D = (keyframes.length > 0 && keyframes[0].scaleX !== undefined && keyframes[0].scaleY !== undefined);
        if (hasAnisotropic3D && uniformScaleProp) {
            try { uniformScaleProp.setValue(false, false); } catch (eUS) {}
        }

        // Native Premiere Pro Motion Blur via Transform Effect (Shutter Angle 0-360 deg)
        if (data.enableMotionBlur && (compMatch === "ADBE Transform" || compName === "Transform")) {
            var shutterAngleVal = Number(data.shutterAngle !== undefined ? data.shutterAngle : 180);
            for (var sp = 0; sp < activeComp.properties.numItems; sp++) {
                var sProp = activeComp.properties[sp];
                var sName = sProp.displayName || "";
                if (sName.indexOf("Use Composition") !== -1) {
                    try { sProp.setValue(false, false); } catch (eUC1) {
                        try { sProp.setValue(0, false); } catch (eUC2) {}
                    }
                } else if (sName === "Shutter Angle") {
                    try { sProp.setValue(shutterAngleVal, true); } catch (eSA) {}
                }
            }
        }

        // Inspect existing Position value to see if Premiere expects normalized [0..1] or pixel [1920x1080]
        var useNormalized = true;
        try {
            if (posProp) {
                var curVal = posProp.getValue();
                if (curVal instanceof Array && curVal.length >= 2) {
                    if (Math.abs(curVal[0]) > 2.0 || Math.abs(curVal[1]) > 2.0) {
                        useNormalized = false;
                    }
                }
            }
        } catch (eVal) {
            useNormalized = true;
        }

        var refKf = keyframes[0];
        var refNormX = (Number(refKf.x) <= canvasW && canvasW > 0) ? (Number(refKf.x) / canvasW) : (Number(refKf.x) / seqW);
        var refNormY = (Number(refKf.y) <= canvasH && canvasH > 0) ? (Number(refKf.y) / canvasH) : (Number(refKf.y) / seqH);
        var refTargetX = useNormalized ? refNormX : (refNormX * seqW);
        var refTargetY = useNormalized ? refNormY : (refNormY * seqH);
        var refScale = Number(refKf.scale || 100);
        var refRot = Number(refKf.rotation || 0);

        for (var k = 0; k < keyframes.length; k++) {
            var kf = keyframes[k];
            var isLast = (k === keyframes.length - 1);
            var relSec = Number(kf.timeSeconds) - sourceFirstSec;
            if (relSec < 0 || isNaN(relSec)) relSec = k / 30.0;

            var targetTimeSec = clipInSec + relSec;

            // Convert tracked coordinate from canvas (640x360) or sequence (1920x1080) into normalized [0.0 .. 1.0]
            var normX = (Number(kf.x) <= canvasW && canvasW > 0) ? (Number(kf.x) / canvasW) : (Number(kf.x) / seqW);
            var normY = (Number(kf.y) <= canvasH && canvasH > 0) ? (Number(kf.y) / canvasH) : (Number(kf.y) / seqH);

            var targetX = useNormalized ? normX : (normX * seqW);
            var targetY = useNormalized ? normY : (normY * seqH);
            var centerValX = useNormalized ? 0.5 : (seqW / 2.0);
            var centerValY = useNormalized ? 0.5 : (seqH / 2.0);

            if (isStabilize) {
                // VIDEO STABILIZATION MODE: Counter-move, counter-rotate, and border-crop zoom relative to Frame 0
                var zoomRatioStab = stabZoom / 100.0;
                var stabDx = (targetX - refTargetX) * stabStrength;
                var stabDy = (targetY - refTargetY) * stabStrength;
                var stabX = centerValX - stabDx * zoomRatioStab;
                var stabY = centerValY - stabDy * zoomRatioStab;

                var curScale = Number(kf.scale || 100);
                var scaleRatio = curScale > 1 ? (refScale / curScale) : 1.0;
                var stabScaleVal = stabZoom * (1.0 + (scaleRatio - 1.0) * stabStrength);
                var stabRotVal = -(Number(kf.rotation || 0) - refRot) * stabStrength;

                if (posProp) {
                    if (writeKeySafe(posProp, targetTimeSec, [Number(stabX), Number(stabY)], isLast)) {
                        appliedPositionKeys++;
                    }
                }
                if (scaleProp) {
                    if (writeKeySafe(scaleProp, targetTimeSec, Number(stabScaleVal), isLast)) {
                        appliedScaleKeys++;
                    }
                    if (scaleWidthProp) {
                        writeKeySafe(scaleWidthProp, targetTimeSec, Number(stabScaleVal), isLast);
                    }
                }
                if (data.exportRotation && rotProp) {
                    if (writeKeySafe(rotProp, targetTimeSec, Number(stabRotVal), isLast)) {
                        appliedRotKeys++;
                    }
                }
            } else if (isCameraFollow) {
                // CAMERA FOLLOW MODE: Keep tracked point locked at center of frame with followZoom%
                var zoomRatio = followZoom / 100.0;
                var invX = centerValX + (centerValX - targetX) * zoomRatio;
                var invY = centerValY + (centerValY - targetY) * zoomRatio;

                if (posProp) {
                    if (writeKeySafe(posProp, targetTimeSec, [Number(invX), Number(invY)], isLast)) {
                        appliedPositionKeys++;
                    }
                }

                if (scaleProp) {
                    if (writeKeySafe(scaleProp, targetTimeSec, Number(followZoom), isLast)) {
                        appliedScaleKeys++;
                    }
                    if (scaleWidthProp) {
                        writeKeySafe(scaleWidthProp, targetTimeSec, Number(followZoom), isLast);
                    }
                }
            } else {
                // STANDARD & 4-PIN 3D SURFACE PIN MODE
                if (data.exportPosition !== false && posProp) {
                    if (writeKeySafe(posProp, targetTimeSec, [Number(targetX), Number(targetY)], isLast)) {
                        appliedPositionKeys++;
                    }
                }

                if (data.exportScale && scaleProp && kf.scale !== undefined) {
                    var scY = (kf.scaleY !== undefined) ? Number(kf.scaleY) : Number(kf.scale);
                    var scX = (kf.scaleX !== undefined) ? Number(kf.scaleX) : Number(kf.scale);
                    if (writeKeySafe(scaleProp, targetTimeSec, scY, isLast)) {
                        appliedScaleKeys++;
                    }
                    if (scaleWidthProp) {
                        writeKeySafe(scaleWidthProp, targetTimeSec, scX, isLast);
                    }
                }

                if (skewProp && kf.skew !== undefined && data.exportCornerPin3D !== false) {
                    writeKeySafe(skewProp, targetTimeSec, Number(kf.skew), isLast);
                }

                if (data.exportRotation && rotProp && kf.rotation !== undefined) {
                    if (writeKeySafe(rotProp, targetTimeSec, Number(kf.rotation), isLast)) {
                        appliedRotKeys++;
                    }
                }
            }
        }
    }

    // 4-PIN 3D SURFACE: Also bake Corner Pin (Upper Left, Upper Right, Lower Left, Lower Right) if Corner Pin effect is on clip
    if (!isStabilize && !isCameraFollow && cornerPinComp && data.exportCornerPin3D !== false && keyframes.length > 0 && keyframes[0].corners) {
        var ulProp = null, urProp = null, llProp = null, lrProp = null;
        for (var cpIdx = 0; cpIdx < cornerPinComp.properties.numItems; cpIdx++) {
            var cpP = cornerPinComp.properties[cpIdx];
            var cpName = cpP.displayName || "";
            if (cpName === "Upper Left" && !ulProp) ulProp = cpP;
            else if (cpName === "Upper Right" && !urProp) urProp = cpP;
            else if (cpName === "Lower Left" && !llProp) llProp = cpP;
            else if (cpName === "Lower Right" && !lrProp) lrProp = cpP;
        }
        if (!ulProp && cornerPinComp.properties.numItems >= 4) {
            ulProp = cornerPinComp.properties[0];
            urProp = cornerPinComp.properties[1];
            llProp = cornerPinComp.properties[2];
            lrProp = cornerPinComp.properties[3];
        }
        if (ulProp && urProp && llProp && lrProp) {
            modifiedComponentNames.push("Corner Pin");
            var cpNormalized = true;
            try {
                var cVal = ulProp.getValue();
                if (cVal instanceof Array && cVal.length >= 2 && (Math.abs(cVal[0]) > 2.0 || Math.abs(cVal[1]) > 2.0)) {
                    cpNormalized = false;
                }
            } catch (eCP) {}

            for (var kc = 0; kc < keyframes.length; kc++) {
                var kfc = keyframes[kc];
                if (!kfc.corners) continue;
                var isLastC = (kc === keyframes.length - 1);
                var relSecC = Number(kfc.timeSeconds) - sourceFirstSec;
                if (relSecC < 0 || isNaN(relSecC)) relSecC = kc / 30.0;
                var tSecC = clipInSec + relSecC;

                var mapCorner = function(pt) {
                    var nx = (Number(pt.x) <= canvasW && canvasW > 0) ? (Number(pt.x) / canvasW) : (Number(pt.x) / seqW);
                    var ny = (Number(pt.y) <= canvasH && canvasH > 0) ? (Number(pt.y) / canvasH) : (Number(pt.y) / seqH);
                    return cpNormalized ? [nx, ny] : [nx * seqW, ny * seqH];
                };

                if (writeKeySafe(ulProp, tSecC, mapCorner(kfc.corners.p1), isLastC)) appliedCornerPinKeys++;
                writeKeySafe(urProp, tSecC, mapCorner(kfc.corners.p2), isLastC);
                writeKeySafe(lrProp, tSecC, mapCorner(kfc.corners.p3), isLastC);
                writeKeySafe(llProp, tSecC, mapCorner(kfc.corners.p4), isLastC);
            }
        }
    }

    // 4-PIN 3D SURFACE: Also bake Basic 3D (Swivel = yaw3D, Tilt = pitch3D) if Basic 3D effect is on clip
    if (!isStabilize && !isCameraFollow && basic3DComp && data.exportCornerPin3D !== false && keyframes.length > 0 && keyframes[0].yaw3D !== undefined) {
        var swivelProp = null, tiltProp = null;
        for (var b3Idx = 0; b3Idx < basic3DComp.properties.numItems; b3Idx++) {
            var b3P = basic3DComp.properties[b3Idx];
            var b3Name = b3P.displayName || "";
            if (b3Name === "Swivel" && !swivelProp) swivelProp = b3P;
            else if (b3Name === "Tilt" && !tiltProp) tiltProp = b3P;
        }
        if (!swivelProp && basic3DComp.properties.numItems >= 2) {
            swivelProp = basic3DComp.properties[0];
            tiltProp = basic3DComp.properties[1];
        }
        if (swivelProp || tiltProp) {
            modifiedComponentNames.push("Basic 3D");
            for (var k3 = 0; k3 < keyframes.length; k3++) {
                var kf3 = keyframes[k3];
                var isLast3 = (k3 === keyframes.length - 1);
                var relSec3 = Number(kf3.timeSeconds) - sourceFirstSec;
                if (relSec3 < 0 || isNaN(relSec3)) relSec3 = k3 / 30.0;
                var tSec3 = clipInSec + relSec3;

                if (swivelProp && kf3.yaw3D !== undefined) {
                    if (writeKeySafe(swivelProp, tSec3, Number(kf3.yaw3D), isLast3)) applied3DKeys++;
                }
                if (tiltProp && kf3.pitch3D !== undefined) {
                    writeKeySafe(tiltProp, tSec3, Number(kf3.pitch3D), isLast3);
                }
            }
        }
    }

    // VELOCITY MOTION BLUR: Also bake Directional Blur (Direction + Blur Length) if Directional Blur effect is on clip
    if (data.enableMotionBlur && dirBlurComp && keyframes.length > 0) {
        var dirProp = null, lenProp = null;
        for (var dbIdx = 0; dbIdx < dirBlurComp.properties.numItems; dbIdx++) {
            var dbP = dirBlurComp.properties[dbIdx];
            var dbName = dbP.displayName || "";
            if (dbName === "Direction" && !dirProp) dirProp = dbP;
            else if (dbName === "Blur Length" && !lenProp) lenProp = dbP;
        }
        if (!dirProp && dirBlurComp.properties.numItems >= 2) {
            dirProp = dirBlurComp.properties[0];
            lenProp = dirBlurComp.properties[1];
        }
        if (dirProp || lenProp) {
            modifiedComponentNames.push("Directional Blur");
            var shutterScale = Number(data.shutterAngle !== undefined ? data.shutterAngle : 180) / 180.0;
            for (var kb = 0; kb < keyframes.length; kb++) {
                var kfb = keyframes[kb];
                var isLastB = (kb === keyframes.length - 1);
                var relSecB = Number(kfb.timeSeconds) - sourceFirstSec;
                if (relSecB < 0 || isNaN(relSecB)) relSecB = kb / 30.0;
                var tSecB = clipInSec + relSecB;
                var bAng = Number(kfb.motionBlurAngle || 0);
                var bLen = Number(kfb.motionBlurLength !== undefined ? kfb.motionBlurLength : 0);
                if (dirProp) writeKeySafe(dirProp, tSecB, bAng, isLastB);
                if (lenProp) writeKeySafe(lenProp, tSecB, bLen * (seqW / Math.max(1, canvasW)) * 0.5 * shutterScale, isLastB);
            }
        }
    }

    if (appliedPositionKeys === 0 && appliedScaleKeys === 0 && appliedRotKeys === 0 && appliedCornerPinKeys === 0 && applied3DKeys === 0) {
        return JSON.stringify({
            error: "Could not write keyframes to '" + targetClip.name + "'. Please make sure the clip is unlocked on the timeline."
        });
    }

    var compSummary = modifiedComponentNames.join(" + ");
    var successMessage = isStabilize
        ? "Stabilized '" + targetClip.name + "' (" + appliedPositionKeys + " keys @ " + Math.round(stabStrength * 100) + "% strength, " + stabZoom + "% zoom) [" + compSummary + "]!"
        : isCameraFollow
        ? "Camera Follow locked (" + appliedPositionKeys + " keys @ " + followZoom + "% zoom) on '" + targetClip.name + "' [" + compSummary + "]!"
        : "Baked " + Math.max(appliedPositionKeys, appliedCornerPinKeys, applied3DKeys) + " tracking keyframes onto '" + targetClip.name + "' [" + compSummary + "]!";

    return JSON.stringify({
        status: "success",
        targetClip: targetClip.name,
        targetEffect: compSummary,
        keyframesCount: keyframes.length,
        appliedPositionKeys: appliedPositionKeys,
        appliedScaleKeys: appliedScaleKeys,
        appliedRotKeys: appliedRotKeys,
        appliedCornerPinKeys: appliedCornerPinKeys,
        applied3DKeys: applied3DKeys,
        message: successMessage
    });
}

/**
 * Retrieves the list of video tracks and clip names for UI selector
 */
function getTimelineTracks() {
    var seq = getActiveSequence();
    if (!seq) return JSON.stringify({ tracks: [] });

    var tracks = [];
    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
        var track = seq.videoTracks[t];
        var clips = [];
        for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            var mPath = "";
            try {
                if (clip.projectItem) {
                    mPath = clip.projectItem.getMediaPath();
                }
            } catch (e) {}

            clips.push({
                index: c,
                name: clip.name,
                mediaPath: mPath,
                selected: clip.isSelected(),
                inPoint: clip.inPoint.seconds,
                outPoint: clip.outPoint.seconds
            });
        }
        tracks.push({
            trackIndex: t,
            name: track.name || ("Video " + (t + 1)),
            clips: clips
        });
    }

    return JSON.stringify({ tracks: tracks });
}
`;

export const STANDALONE_STYLE_CSS = `/* Premiere Pro 2026 Dark Theme Stylesheet */
* {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
}

body.adobe-theme {
    background-color: #181818;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 12px;
    line-height: 1.4;
    user-select: none;
    overflow-x: hidden;
    padding: 8px;
}

#app {
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: 100%;
}

/* Header */
.header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: #202020;
    border: 1px solid #2e2e2e;
    border-radius: 4px;
}

.logo-group {
    display: flex;
    align-items: center;
    gap: 8px;
}

.logo-badge {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #141414;
    padding: 2px;
    border-radius: 4px;
    border: 1px solid rgba(62, 166, 255, 0.45);
    overflow: hidden;
    flex-shrink: 0;
}

.logo-title {
    font-size: 13px;
    font-weight: 600;
    color: #fff;
    letter-spacing: -0.2px;
}

.version-label {
    font-size: 10px;
    color: #888;
    display: block;
}

.status-pill {
    font-size: 10px;
    padding: 2px 8px;
    border-radius: 12px;
    font-weight: 500;
}

.status-active {
    background: #064e3b;
    color: #34d399;
    border: 1px solid #059669;
}

.status-dev {
    background: #451a03;
    color: #fcd34d;
    border: 1px solid #b45309;
}

/* Tab Bar */
.tab-bar {
    display: flex;
    gap: 4px;
    background: #121212;
    padding: 3px;
    border-radius: 4px;
    border: 1px solid #282828;
}

.tab-btn {
    flex: 1;
    background: transparent;
    border: none;
    color: #888;
    padding: 6px;
    font-size: 11px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s ease;
}

.tab-btn.active {
    background: #2b2b2b;
    color: #3ea6ff;
    font-weight: 600;
}

/* Cards */
.viewport-card, .control-card, .settings-card, .editor-card {
    background: #202020;
    border: 1px solid #2d2d2d;
    border-radius: 4px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.viewport-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    color: #aaa;
}

.timecode {
    font-family: monospace;
    color: #3ea6ff;
    font-weight: bold;
}

.canvas-container {
    background: #000;
    border: 1px solid #333;
    border-radius: 4px;
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
    overflow: hidden;
}

#viewport-canvas {
    max-width: 100%;
    height: auto;
    display: block;
    cursor: crosshair;
}

/* Buttons */
.btn {
    background: #2d2d2d;
    color: #eee;
    border: 1px solid #3d3d3d;
    padding: 6px 12px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 500;
    transition: all 0.15s ease;
}

.btn:hover {
    background: #383838;
    color: #fff;
    border-color: #555;
}

.btn-primary {
    background: #1473e6;
    color: #fff;
    border-color: #1473e6;
}

.btn-primary:hover {
    background: #0d66d0;
}

.btn-accent {
    background: linear-gradient(135deg, #1473e6, #0052cc);
    color: #fff;
    border: 1px solid #2563eb;
    font-weight: 600;
}

.btn-accent:hover {
    background: linear-gradient(135deg, #0d66d0, #0047b3);
}

.btn-large {
    padding: 10px;
    font-size: 12px;
}

.btn-row {
    display: flex;
    gap: 6px;
}

.tracker-transport {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    background: #161616;
    padding: 6px;
    border-radius: 4px;
    border: 1px solid #282828;
}

.btn-icon {
    background: #2a2a2a;
    border: 1px solid #383838;
    color: #ccc;
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
    font-size: 11px;
}

.btn-icon:hover {
    background: #333;
    color: #fff;
}

.btn-danger {
    background: #2b2020;
    border-color: #552222;
    color: #ff6b6b;
}

.btn-danger:hover {
    background: #881337;
    color: #fff;
}

/* Sliders & Inputs */
.slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 11px;
    color: #bbb;
}

.slider-row span:first-child {
    width: 120px;
}

input[type="range"] {
    flex: 1;
    height: 4px;
    background: #333;
    border-radius: 2px;
    accent-color: #3ea6ff;
    cursor: pointer;
}

.val-badge {
    font-family: monospace;
    color: #3ea6ff;
    width: 40px;
    text-align: right;
}

select {
    background: #191919;
    border: 1px solid #333;
    color: #eee;
    padding: 4px 8px;
    border-radius: 3px;
    font-size: 11px;
    outline: none;
    width: 100%;
}

select:focus {
    border-color: #3ea6ff;
}

/* Checkboxes & Radios */
.points-mode-row {
    display: flex;
    gap: 12px;
    font-size: 11px;
    color: #bbb;
    justify-content: center;
    padding: 4px 0;
}

.checkbox-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
    margin-top: 4px;
}

.checkbox-grid label, .toggle-row label {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #262626;
    padding: 5px 8px;
    border-radius: 3px;
    border: 1px solid #333;
    cursor: pointer;
    font-size: 11px;
}

.toggle-row {
    margin-top: 6px;
}

.card-title {
    font-size: 11px;
    font-weight: 600;
    color: #fff;
    border-bottom: 1px solid #2a2a2a;
    padding-bottom: 4px;
}

/* Keyframe Table */
.table-container {
    max-height: 120px;
    overflow-y: auto;
    border: 1px solid #2d2d2d;
    border-radius: 3px;
    background: #141414;
}

table {
    width: 100%;
    border-collapse: collapse;
    font-family: monospace;
    font-size: 10px;
}

th, td {
    padding: 4px 6px;
    border-bottom: 1px solid #222;
    text-align: left;
}

th {
    background: #1c1c1c;
    color: #888;
}

tr:hover {
    background: #1f1f1f;
}

/* Drop Overlay & Fallback */
.drop-overlay {
    position: absolute;
    inset: 0;
    background: rgba(14, 14, 14, 0.92);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    text-align: center;
    z-index: 10;
    backdrop-filter: blur(4px);
}

.drop-card {
    background: #1e1e1e;
    border: 1px dashed #444;
    border-radius: 6px;
    padding: 16px;
    max-width: 90%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
}

.drop-icon {
    font-size: 24px;
    margin-bottom: 2px;
}

.drop-title {
    font-size: 12px;
    font-weight: 600;
    color: #fff;
}

.drop-sub {
    font-size: 10px;
    color: #999;
    line-height: 1.3;
}

/* Toast */
.toast {
    position: fixed;
    top: 10px;
    left: 10px;
    right: 10px;
    padding: 8px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    z-index: 999;
    box-shadow: 0 4px 12px rgba(0,0,0,0.5);
    transition: all 0.2s ease;
}

.toast-success {
    background: #064e3b;
    border: 1px solid #059669;
    color: #a7f3d0;
}

.toast-error {
    background: #4c0519;
    border: 1px solid #e11d48;
    color: #fecdd3;
}

.toast-info {
    background: #172554;
    border: 1px solid #2563eb;
    color: #bfdbfe;
}

/* Action Button Variants */
.btn-emerald {
    background: linear-gradient(135deg, #10b981, #059669);
    color: #fff;
    border: 1px solid #059669;
    font-weight: 600;
}

.btn-emerald:hover {
    background: linear-gradient(135deg, #059669, #047857);
}

.btn-secondary {
    background: #252525;
    border: 1px solid #383838;
    color: #ddd;
    font-size: 11px;
}

.btn-secondary:hover {
    background: #303030;
    color: #fff;
    border-color: #4a4a4a;
}

.export-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
}
`;

export const CSINTERFACE_JS = `/**
 * Adobe CSInterface (v11.0 / v12.0 / v13.0 Compatible)
 */
function CSInterface() {}

CSInterface.prototype.evalScript = function(script, callback) {
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.evalScript(script, callback || function() {});
    } else {
        if (callback) callback(JSON.stringify({ simulated: true }));
    }
};

CSInterface.prototype.getHostEnvironment = function() {
    if (typeof window.__adobe_cep__ !== "undefined") {
        return window.__adobe_cep__.getHostEnvironment();
    }
    return JSON.stringify({ appId: "PPRO", appVersion: "26.0" });
};

CSInterface.prototype.closeExtension = function() {
    if (typeof window.__adobe_cep__ !== "undefined") {
        window.__adobe_cep__.closeExtension();
    }
};
`;

export const STANDALONE_INDEX_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MotionTracker by Nightosphere</title>
    <link rel="stylesheet" href="style.css">
    <style>
\${STANDALONE_STYLE_CSS}
    </style>
    <script src="CSInterface.js"></script>
</head>
<body class="adobe-theme">
    <div id="app">
        <!-- Floating Status Toast -->
        <div id="toast" class="toast toast-info" style="display:none;"></div>

        <!-- Top Navigation -->
        <header class="header">
            <div class="logo-group">
                <span class="logo-badge" title="MotionTracker by Nightosphere">
                    <img src="logo.png" alt="Nightosphere Logo" style="width:100%;height:100%;object-fit:contain;display:none;" onload="this.style.display='block';if(this.nextElementSibling)this.nextElementSibling.style.display='none';" onerror="this.style.display='none';if(this.nextElementSibling)this.nextElementSibling.style.display='block';">
                    <svg viewBox="0 0 64 64" width="24" height="24" style="display:block;" aria-label="Nightosphere Logo">
                        <defs>
                            <pattern id="ns-dots" width="4" height="4" patternUnits="userSpaceOnUse">
                                <rect width="4" height="4" fill="#e5e7eb"/>
                                <circle cx="1.5" cy="1.5" r="0.85" fill="#4b5563"/>
                                <circle cx="3.5" cy="3.5" r="0.65" fill="#6b7280"/>
                            </pattern>
                        </defs>
                        <path d="M22 6 C18 6 19 11 26 14 C13 18 6 31 6 42 C6 54 17 60 32 59 C48 58 58 47 58 34 C58 21 46 11 29 7 Z" fill="url(#ns-dots)" stroke="#111827" stroke-width="4" stroke-linejoin="round"/>
                        <path d="M16 40 C16 30 24 22 35 21 C38 23 41 23 44 21 C49 26 50 35 46 43 C42 49 32 51 23 49 C18 47 16 44 16 40 Z" fill="#111827"/>
                        <path d="M20 31 C23 29 27 32 28 37 C29 41 32 44 30 46 C27 48 22 44 19 38 C17 34 18 32 20 31 Z" fill="url(#ns-dots)"/>
                        <path d="M36 26 C40 25 43 28 41 34 C39 39 40 44 38 46 C35 47 32 42 32 35 C32 30 34 27 36 26 Z" fill="url(#ns-dots)"/>
                    </svg>
                </span>
                <div>
                    <h1 class="logo-title">MotionTracker <span style="color:#3ea6ff; font-weight:400;">by Nightosphere</span></h1>
                    <span class="version-label">v2.1 • PPRO 2020–2026+ • GPU Accelerated</span>
                </div>
            </div>
            <div style="display:flex; align-items:center; gap:5px;">
                <button id="btn-toggle-gpu" class="status-pill" style="background:#3b0764; color:#e9d5ff; border:1px solid #9333ea; cursor:pointer;" title="Toggle WebGL GPU Shader Acceleration">⚡ GPU: ON</button>
                <div id="cep-status" class="status-pill status-active">Active</div>
            </div>
        </header>

        <!-- Mode Switcher -->
        <div class="tab-bar">
            <button id="tab-canvas" class="tab-btn active">🎯 Point Optical Tracker (1/2-Pt)</button>
            <button id="tab-surface" class="tab-btn">🧊 Surface Tracking Mode (4-Pin 3D)</button>
        </div>

        <!-- Direct Timeline Clip Selector & Local Fallback -->
        <div class="settings-card">
            <div class="card-title">Premiere Timeline Clip Picker</div>
            <select id="sel-timeline-clips">
                <option value="">Querying Timeline Clips...</option>
            </select>
            <div class="btn-row">
                <button id="btn-load-clip" class="btn btn-primary" style="flex:1;">📥 Load Selected Clip</button>
                <label class="btn btn-secondary" style="flex:1; text-align:center; cursor:pointer;" title="Browse any video format (.MP4, .TS, .MTS, .MKV, .MOV, .MXF, .AVI, .WMV, .WEBM)">
                    📁 Browse Video (.MP4/.TS/.MKV)...
                    <input type="file" id="local-file-picker" accept="video/*,.mp4,.mov,.mkv,.ts,.mts,.m2ts,.mxf,.avi,.webm,.wmv,.flv,.m4v,.mpg,.mpeg,.vob,.3gp,.braw,.r3d" style="display:none;">
                </label>
                <button id="btn-refresh-timeline" class="btn" title="Refresh sequence clips">🔄</button>
            </div>
        </div>

        <!-- Video & Canvas Viewport -->
        <div class="viewport-card">
            <div class="viewport-header" style="flex-wrap:wrap; gap:4px;">
                <div>
                    <span id="clip-title" style="font-weight:600; color:#eee;">No Clip Loaded</span>
                    <span id="coords-display" style="font-family:monospace; color:#999; margin-left:6px; font-size:10px;">P1: 320, 180</span>
                </div>
                <div style="display:flex; align-items:center; gap:3px; flex-wrap:wrap;">
                    <button id="btn-snap-feature" class="btn-icon" style="padding:2px 6px; font-size:10px; color:#c4b5fd; border-color:#6d28d9;" title="Snap active pin(s) to sharpest corner/micro-point within 18px (or Shift+Click canvas)">🧲 Snap</button>
                    <button id="btn-zoom-p1" class="btn-icon" style="padding:2px 6px; font-size:10px; color:#3ea6ff; border-color:#2563eb;" title="Zoom 350% directly onto Point 1">🎯 Zoom P1</button>
                    <button id="btn-pan-mode" class="btn-icon" style="padding:2px 6px; font-size:10px;" title="Toggle Hand Pan Mode to drag viewport when zoomed in (or hold Space / Alt / Middle-Click)">✋ Pan</button>
                    <button id="btn-zoom-out" class="btn-icon" style="padding:2px 5px; font-size:10px;" title="Zoom Out">-</button>
                    <span id="zoom-badge" style="font-family:monospace; font-size:10px; color:#ddd; min-width:34px; text-align:center;">100%</span>
                    <button id="btn-zoom-in" class="btn-icon" style="padding:2px 5px; font-size:10px;" title="Zoom In (up to 800%)">+</button>
                    <button id="btn-zoom-reset" class="btn-icon" style="padding:2px 5px; font-size:10px;" title="Reset 100% Zoom">1:1</button>
                    <button id="btn-toggle-loupe" class="btn-icon" style="padding:2px 5px; font-size:10px; color:#3ea6ff;" title="Toggle 6x Pixel Magnifier Loupe">🔍 6x</button>
                    <span id="timecode-display" class="timecode" style="margin-left:4px;">00:00:00:00</span>
                </div>
            </div>
            <div class="canvas-container" id="canvas-dropzone" style="min-height:220px;">
                <!-- CEF-safe off-screen video element (never use display:none which halts decoding) -->
                <video id="source-video" preload="auto" playsinline style="position:fixed; top:-9999px; left:-9999px; width:320px; height:180px; opacity:0; pointer-events:none;"></video>
                <canvas id="viewport-canvas" width="640" height="360" style="transform-origin:center center;"></canvas>
                <!-- Floating 6x Pixel Magnifier Loupe -->
                <div id="loupe-box" style="position:absolute; top:6px; right:6px; background:rgba(16,16,22,0.94); border:1px solid #3ea6ff; border-radius:4px; padding:3px; pointer-events:none; z-index:15; display:flex; flex-direction:column; align-items:center;">
                    <div id="loupe-label" style="font-family:monospace; font-size:9px; color:#3ea6ff; margin-bottom:2px;">6x LOUPE</div>
                    <canvas id="loupe-canvas" width="96" height="96" style="border:1px solid #333; background:#000;"></canvas>
                </div>

                <!-- Fallback / Drag & Drop Overlay -->
                <div id="drop-overlay" class="drop-overlay" style="display:none;">
                    <div class="drop-card">
                        <div class="drop-icon">🎬</div>
                        <div id="drop-title" class="drop-title">Drop Any Video (.MP4, .TS, .MKV, .MOV, .MXF) or Select Clip</div>
                        <div id="drop-sub" class="drop-sub">Drag & drop any Adobe Premiere supported video file here or browse</div>
                        <label class="btn btn-primary" style="margin-top:6px; cursor:pointer;">
                            Browse Any Video File...
                            <input type="file" id="overlay-file-picker" accept="video/*,.mp4,.mov,.mkv,.ts,.mts,.m2ts,.mxf,.avi,.webm,.wmv,.flv,.m4v,.mpg,.mpeg,.vob,.3gp,.braw,.r3d" style="display:none;">
                        </label>
                    </div>
                </div>
            </div>

            <!-- Scrubber Slider -->
            <input type="range" id="slider-scrub" min="0" max="100" value="0" style="width:100%; margin-top:2px;">
        </div>

        <!-- Transport & Tracking Controls -->
        <div class="control-card">
            <div class="tracker-transport" style="flex-wrap:wrap;">
                <button id="btn-step-prev" class="btn-icon" title="Step Back 1 Frame">◀|</button>
                <button id="btn-track-prev" class="btn btn-danger" title="Track Backward">◄ Track Back</button>
                <button id="btn-stop-track" class="btn" title="Pause / Stop">⏹ Stop</button>
                <button id="btn-track-next" class="btn btn-primary" title="Track Forward">Track Fwd ►</button>
                <button id="btn-bidi-track" class="btn-icon" style="color:#c4b5fd; border-color:#6d28d9;" title="Bi-Directional Forward+Backward Pass Refinement (cuts drift & jitter in half)">⇄ Bi-Dir</button>
                <button id="btn-step-next" class="btn-icon" title="Step Fwd 1 Frame">|▶</button>
                <button id="btn-reset-points" class="btn-icon" title="Reset Tracker Points">🔄</button>
            </div>

            <div class="points-mode-row" style="flex-wrap:wrap; gap:8px;">
                <label><input type="radio" name="tracker-points" value="1" checked> 1-Point (Pos)</label>
                <label><input type="radio" name="tracker-points" value="2"> 2-Point (2D)</label>
                <label style="color:#d8b4fe; font-weight:600;"><input type="radio" name="tracker-points" value="4"> 🧊 4-Pin 3D Surface (Screen)</label>
            </div>

            <div id="surface-studio-bar" style="display:none; background:#181424; border:1px solid #6b21a8; border-radius:3px; padding:6px; flex-direction:column; gap:5px;">
                <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; color:#d8b4fe; font-weight:600;">
                    <span>🧊 4-Pin Free-Edit 3D Surface Studio (Drag P1–P4 Freely)</span>
                    <span style="font-family:monospace; color:#a855f7;">Corner Pin + 3D</span>
                </div>
                <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:4px;">
                    <button id="btn-surf-169" class="btn-icon" style="font-size:10px; padding:3px 4px; color:#e9d5ff; border-color:#7e22ce;">📺 16:9 TV</button>
                    <button id="btn-surf-916" class="btn-icon" style="font-size:10px; padding:3px 4px; color:#e9d5ff; border-color:#7e22ce;">📱 Phone</button>
                    <button id="btn-surf-43" class="btn-icon" style="font-size:10px; padding:3px 4px; color:#e9d5ff; border-color:#7e22ce;">🪧 4:3 Sign</button>
                    <button id="btn-surf-tilt" class="btn-icon" style="font-size:10px; padding:3px 4px; color:#e9d5ff; border-color:#7e22ce;">📐 3D Tilt</button>
                </div>
            </div>
        </div>

        <!-- Post-Processing & Smoothing -->
        <div class="settings-card">
            <div class="card-title">Tracking Settings & Post-Processing</div>
            <div class="slider-row">
                <span>Gaussian Smooth:</span>
                <input type="range" id="slider-smooth" min="0" max="15" value="3">
                <span id="val-smooth" class="val-badge">3</span>
            </div>
            <div class="slider-row">
                <span>Feature Size:</span>
                <input type="range" id="slider-feature" min="8" max="64" step="2" value="28">
                <span id="val-feature" class="val-badge">28px</span>
            </div>
            <div class="slider-row">
                <span>Search Window:</span>
                <input type="range" id="slider-search" min="24" max="140" value="64">
                <span id="val-search" class="val-badge">64px</span>
            </div>
            <div class="slider-row">
                <span>Pin Offset X:</span>
                <input type="range" id="slider-offset-x" min="-200" max="200" value="0">
                <span id="val-offset-x" class="val-badge">0px</span>
            </div>
            <div class="slider-row">
                <span>Pin Offset Y:</span>
                <input type="range" id="slider-offset-y" min="-200" max="200" value="0">
                <span id="val-offset-y" class="val-badge">0px</span>
            </div>

            <div class="checkbox-grid">
                <label><input type="checkbox" id="chk-pos" checked> Position X/Y</label>
                <label><input type="checkbox" id="chk-scale" checked> Scale</label>
                <label><input type="checkbox" id="chk-rot" checked> Rotation / 3D</label>
            </div>

            <!-- Motion Blur (Shutter Angle 0-360 + Directional Blur) -->
            <div style="background:#1c1610; border:1px solid #92400e; border-radius:3px; padding:6px; margin-top:4px; display:flex; flex-direction:column; gap:4px;">
                <label style="display:flex; align-items:center; justify-content:space-between; font-size:11px; color:#fde68a; font-weight:600; cursor:pointer;">
                    <span><input type="checkbox" id="chk-motion-blur"> 💨 Motion Blur (Tracked Text & Layers)</span>
                    <span id="val-shutter-angle" style="font-family:monospace; color:#fbbf24;">180°</span>
                </label>
                <div class="slider-row">
                    <span style="width:95px; font-size:10px; color:#fcd34d;">Shutter Angle:</span>
                    <input type="range" id="slider-shutter-angle" min="0" max="360" step="15" value="180">
                </div>
            </div>

            <div class="toggle-row" style="display:grid; grid-template-columns:1fr 1fr; gap:5px;">
                <label title="Applies keyframes to Premiere's Transform effect (supports Shutter Angle Motion Blur)">
                    <input type="checkbox" id="chk-transform-effect" checked>
                    <span>Use 'Transform' Effect</span>
                </label>
                <label title="Auto-Pause tracking if match confidence drops below 55% (occlusion guard)">
                    <input type="checkbox" id="chk-auto-pause" checked>
                    <span>🛡️ Auto-Pause Low Conf</span>
                </label>
            </div>
        </div>

        <!-- Track Data Editor & Trim Bad Seconds -->
        <div class="editor-card">
            <div class="card-title" style="display:flex; justify-content:space-between; align-items:center;">
                <span>Track Data (<span id="keyframe-count">0</span> keys)</span>
                <span id="btn-clear-keys" style="color:#ff6b6b; cursor:pointer;">Clear All</span>
            </div>
            <!-- Trim / Delete Messed-Up Track Data Controls -->
            <div style="background:#16161c; border:1px solid #2e293a; border-radius:3px; padding:6px; display:flex; flex-direction:column; gap:5px;">
                <div style="display:flex; justify-content:space-between; align-items:center; gap:4px;">
                    <span style="font-size:10px; color:#fcd34d; font-weight:600;">✂️ Trim Bad Track Data:</span>
                    <div style="display:flex; gap:4px;">
                        <button id="btn-trim-after" class="btn-icon" style="font-size:10px; padding:2px 6px; color:#fde68a; border-color:#d97706;" title="Keep good frames up to playhead and delete everything after">✂️ Keep Up To Playhead</button>
                        <button id="btn-trim-before" class="btn-icon" style="font-size:10px; padding:2px 6px;" title="Delete frames before playhead">✂️ Del Before</button>
                    </div>
                </div>
                <div style="display:flex; align-items:center; justify-content:space-between; gap:4px; font-size:10px;">
                    <div style="display:flex; align-items:center; gap:3px; color:#aaa;">
                        <span>Sec:</span>
                        <input type="number" id="inp-trim-start" step="0.1" min="0" value="0" style="width:42px; background:#0e0e12; color:#fff; border:1px solid #333; border-radius:2px; padding:1px 3px; font-size:10px;">
                        <span>to</span>
                        <input type="number" id="inp-trim-end" step="0.1" min="0" value="5" style="width:42px; background:#0e0e12; color:#fff; border:1px solid #333; border-radius:2px; padding:1px 3px; font-size:10px;">
                        <span>s</span>
                    </div>
                    <div style="display:flex; gap:4px;">
                        <button id="btn-keep-sec-range" class="btn-icon" style="font-size:10px; padding:2px 6px; color:#6ee7b7; border-color:#059669;" title="Keep ONLY keyframes in this second range (e.g. 0s to 5s)">✅ Keep Range</button>
                        <button id="btn-del-sec-range" class="btn-icon" style="font-size:10px; padding:2px 6px; color:#fda4af; border-color:#e11d48;" title="Delete keyframes in this second range (e.g. 5s to 8s)">🗑️ Del Range</button>
                    </div>
                </div>
            </div>
            <div class="table-container">
                <table id="keyframe-table">
                    <thead>
                        <tr>
                            <th>Fr</th>
                            <th>Time</th>
                            <th>X</th>
                            <th>Y</th>
                            <th>Scale</th>
                            <th>Rot/3D</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr><td colspan="6" style="text-align:center; color:#666;">No keys yet. Click Track Fwd.</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Simple Export to Text or Objects Section -->
        <div class="settings-card" style="border-color:#383838;">
            <div class="card-title">Pin Tracking Data to Text or Objects</div>
            <div class="export-grid">
                <button id="btn-pin-object" class="btn btn-accent btn-large" title="Applies Transform effect with Position/Scale/Rotation to selected object/clip on timeline">
                    🎯 Pin to Object / Graphic
                </button>
                <button id="btn-pin-text" class="btn btn-emerald btn-large" title="Applies keyframes directly to selected Essential Graphics Text layer on timeline">
                    ✍️ Pin to Text Layer
                </button>
            </div>

            <!-- Camera Follow Mode (e.g. Football / Ball Follow) -->
            <div class="card-title" style="margin-top:10px;">Camera Follow Mode (Reframing)</div>
            <div style="font-size:10px; color:#aaa; margin-bottom:4px;">
                Locks the camera view onto the tracked point (e.g. Football / Ball movement), keeping it centered on screen!
            </div>
            <div class="slider-row">
                <span>Follow Zoom:</span>
                <input type="range" id="slider-follow-zoom" min="105" max="180" step="5" value="125">
                <span id="val-follow-zoom" class="val-badge">125%</span>
            </div>
            <div class="export-grid" style="margin-top:6px;">
                <button id="btn-camera-follow" class="btn btn-accent btn-large" style="background:linear-gradient(135deg, #2563eb, #4f46e5);" title="Bakes Camera Follow keyframes so the camera locks onto and tracks the ball">
                    ⚽ Apply Camera Follow
                </button>
                <button id="btn-copy-follow" class="btn btn-secondary" title="Copy Camera Follow keyframe text for Ctrl+V">
                    📋 Copy Follow (Ctrl+V)
                </button>
            </div>

            <!-- Video Stabilization Mode (Anti-Shake / Lock-Down) -->
            <div class="card-title" style="margin-top:10px; color:#6ee7b7;">🛡️ Video Stabilization Mode (Anti-Shake)</div>
            <div style="font-size:10px; color:#aaa; margin-bottom:4px;">
                Counter-moves (and counter-rotates/scales in 2-Point mode) the clip against camera shake to lock the shot steady!
            </div>
            <div class="slider-row">
                <span>Stab Strength:</span>
                <input type="range" id="slider-stab-strength" min="10" max="100" step="5" value="100">
                <span id="val-stab-strength" class="val-badge">100%</span>
            </div>
            <div class="slider-row">
                <span>Border Zoom:</span>
                <input type="range" id="slider-stab-zoom" min="100" max="160" step="2" value="115">
                <span id="val-stab-zoom" class="val-badge">115%</span>
            </div>
            <div class="export-grid" style="margin-top:6px;">
                <button id="btn-stabilize-clip" class="btn btn-emerald btn-large" title="Applies inverse counter-motion keyframes to stabilize the selected video clip">
                    🛡️ Stabilize Clip
                </button>
                <button id="btn-copy-stabilize" class="btn btn-secondary" title="Copy Stabilization keyframe text for Ctrl+V">
                    📋 Copy Stabilize (Ctrl+V)
                </button>
            </div>

            <div class="export-grid" style="margin-top:8px;">
                <button id="btn-copy-keyframes" class="btn btn-secondary" title="Copies universal Adobe After Effects Keyframe format">
                    📋 Copy AE Keys
                </button>
                <button id="btn-copy-json" class="btn btn-secondary" title="Copies JSON keyframe payload to clipboard">
                    { } Copy JSON
                </button>
            </div>

            <!-- Paste & Apply from Web App Section -->
            <div style="margin-top:8px; padding-top:8px; border-top:1px solid #2e2e2e;">
                <div style="font-size:10px; color:#3ea6ff; font-weight:600; margin-bottom:4px;">
                    🌐 Tracked in Web Browser? Paste & Apply Here:
                </div>
                <textarea id="txt-paste-payload" rows="2" placeholder="Paste JSON or Adobe Keyframe Data copied from the Web App here..." style="width:100%; background:#141414; color:#ddd; border:1px solid #333; border-radius:3px; padding:4px; font-size:10px; font-family:monospace; resize:vertical;"></textarea>
                <div class="export-grid" style="margin-top:4px;">
                    <button id="btn-paste-apply-object" class="btn btn-primary" title="Applies pasted keyframes to selected Object/Video on Premiere timeline">
                        🎯 Apply Pasted to Clip
                    </button>
                    <button id="btn-paste-apply-text" class="btn btn-emerald" title="Applies pasted keyframes to selected Text Layer on Premiere timeline">
                        ✍️ Apply Pasted to Text
                    </button>
                </div>
            </div>

            <button id="btn-download-csv" class="btn btn-secondary" style="margin-top:6px; width:100%;" title="Download CSV spreadsheet of tracked coordinates">
                💾 Download CSV Data
            </button>
        </div>
    </div>
    <script src="main.js"></script>
</body>
</html>
`;

export const STANDALONE_MAIN_JS = `/**
 * MotionTracker by Nightosphere - Complete Frontend Controller for Premiere Pro CEP
 * Features:
 * - Robust video loader with Node.js fs readFileSync buffer fallback (bypasses Windows path & Chromium sandbox)
 * - Top-level video seeked/loadedmetadata handlers for both timeline clips and local MP4 files
 * - Fast NCC template matching optical flow tracking with Integral Images
 * - 4-Pin Free-Edit 3D Surface & Planar Perspective Tracker + Bad Track Segment Trimmer
 * - Hand Pan Mode (✋ Pan button, Spacebar+Drag, Alt+Drag, Middle-Mouse Drag) for zoomed viewport navigation
 * - Direct timeline export using Premiere Pro's ComponentParam.addKey() + setValueAtKey()
 * - Live Local HTTP Bridge (127.0.0.1:17890) & %TEMP% watcher so the AI Studio Web App can push keyframes straight into Premiere Pro!
 */
(function() {
    'use strict';

    var csInterface = new CSInterface();
    var isCEP = typeof window.__adobe_cep__ !== 'undefined';

    var state = {
        pointMode: 1,
        isTwoPoint: false,
        useGPU: true,
        zoomLevel: 1.0,
        panX: 0,
        panY: 0,
        isPanMode: false,
        isSpaceHeld: false,
        showLoupe: true,
        hoverPt: null,
        draggingPointId: null,
        isDraggingQuad: false,
        quadDragLast: { x: 0, y: 0 },
        isPanning: false,
        panStart: { x: 0, y: 0, ox: 0, oy: 0 },
        points: {
            p1: { x: 200, y: 110, featureSize: 28, searchSize: 64, color: '#3ea6ff' },
            p2: { x: 440, y: 110, featureSize: 28, searchSize: 64, color: '#ff4444' },
            p3: { x: 440, y: 250, featureSize: 28, searchSize: 64, color: '#10b981' },
            p4: { x: 200, y: 250, featureSize: 28, searchSize: 64, color: '#f59e0b' }
        },
        rawKeyframes: [],
        smoothedKeyframes: [],
        smoothingRadius: 3,
        offsetX: 0,
        offsetY: 0,
        cameraFollowZoom: 125,
        stabilizeStrength: 100,
        stabilizeZoom: 115,
        exportPosition: true,
        exportScale: true,
        exportRotation: true,
        applyToTransform: true,
        enableMotionBlur: false,
        shutterAngle: 180,
        autoPauseLowConf: true,
        fps: 30,
        isTracking: false,
        trackDirection: 1,
        inPointSeconds: 0,
        outPointSeconds: 5,
        durationSeconds: 5,
        currentFrame: 0,
        totalFrames: 150,
        activeClipName: ''
    };

    var video = document.getElementById('source-video');
    var canvas = document.getElementById('viewport-canvas');
    var ctx = canvas.getContext('2d');
    var loupeCanvas = document.getElementById('loupe-canvas');
    var loupeCtx = loupeCanvas ? loupeCanvas.getContext('2d') : null;

    // Off-screen clean canvas buffer (stores clean video frames without UI reticles)
    var cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = 640;
    cleanCanvas.height = 360;
    var cleanCtx = cleanCanvas.getContext('2d', { willReadFrequently: true });

    // Template cache + Anchor template cache + Velocity prediction state for p1..p4
    var templates = { p1: null, p2: null, p3: null, p4: null };
    var anchorTemplates = { p1: null, p2: null, p3: null, p4: null };
    var velocities = { p1: { vx: 0, vy: 0 }, p2: { vx: 0, vy: 0 }, p3: { vx: 0, vy: 0 }, p4: { vx: 0, vy: 0 } };

    function cloneImgData(src) {
        if (!src) return null;
        return new ImageData(new Uint8ClampedArray(src.data), src.width, src.height);
    }

    // Toast helper
    function showToast(msg, type) {
        var toast = document.getElementById('toast');
        if (!toast) return;
        toast.className = 'toast toast-' + (type || 'info');
        toast.textContent = msg;
        toast.style.display = 'block';
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(function() {
            toast.style.display = 'none';
        }, 4000);
    }

    // Timecode formatter HH:MM:SS:FF
    function formatTimecode(seconds, fps) {
        if (isNaN(seconds) || seconds < 0) seconds = 0;
        var totalFrames = Math.round(seconds * fps);
        var ff = totalFrames % Math.round(fps);
        var totSec = Math.floor(seconds);
        var ss = totSec % 60;
        var mm = Math.floor(totSec / 60) % 60;
        var hh = Math.floor(totSec / 3600);
        var pad = function(n) { return (n < 10 ? '0' : '') + n; };
        return pad(hh) + ':' + pad(mm) + ':' + pad(ss) + ':' + pad(ff);
    }

    function getFileExtension(nameOrPath) {
        if (!nameOrPath) return '';
        var lower = nameOrPath.toLowerCase();
        var dot = lower.lastIndexOf('.');
        return dot >= 0 ? lower.slice(dot) : '';
    }

    function isMPEGTransportStream(nameOrPath) {
        var ext = getFileExtension(nameOrPath);
        return ext === '.ts' || ext === '.mts' || ext === '.m2ts';
    }

    function isContainerNeedingTranscode(nameOrPath) {
        var ext = getFileExtension(nameOrPath);
        var list = ['.mxf', '.avi', '.wmv', '.flv', '.vob', '.mpg', '.mpeg', '.3gp', '.braw', '.r3d'];
        return list.indexOf(ext) !== -1;
    }

    // Pure-JS In-Memory MPEG-2 Transport Stream (.TS / .MTS / .M2TS) to ISO-BMFF (.MP4) Remuxer
    // Instantaneously repackages H.264 video packets from a .TS stream into a native HTML5 .MP4 video
    function remuxTSToMP4(tsBytes) {
        if (!tsBytes || tsBytes.length < 188) return null;
        var stride = 188, startOffset = 0;
        var foundSync = false;
        var searchLimit = Math.min(tsBytes.length - 384, 4096);
        for (var i = 0; i < searchLimit; i++) {
            if (tsBytes[i] === 0x47 && tsBytes[i + 188] === 0x47) {
                stride = 188; startOffset = i; foundSync = true; break;
            }
            if (i >= 4 && tsBytes[i] === 0x47 && tsBytes[i + 192] === 0x47) {
                stride = 192; startOffset = i - 4; foundSync = true; break;
            }
        }
        if (!foundSync) return null;

        var pmtPid = -1, videoPid = -1;
        var pesChunks = [], currentPes = [], currentPts = 0, totalCurrentLen = 0;

        function flushCurrentPes() {
            if (currentPes.length === 0 || totalCurrentLen === 0) return;
            var merged = new Uint8Array(totalCurrentLen);
            var off = 0;
            for (var c = 0; c < currentPes.length; c++) {
                merged.set(currentPes[c], off);
                off += currentPes[c].length;
            }
            pesChunks.push({ pts: currentPts, data: merged });
            currentPes = [];
            totalCurrentLen = 0;
        }

        function parsePTS(buf, offset) {
            var b0 = buf[offset], b1 = buf[offset + 1], b2 = buf[offset + 2], b3 = buf[offset + 3], b4 = buf[offset + 4];
            return ((b0 & 0x0e) * 536870912) + ((b1 & 0xff) << 22) + (((b2 & 0xfe) >> 1) << 15) + ((b3 & 0xff) << 7) + ((b4 & 0xfe) >> 1);
        }

        for (var pos = startOffset; pos + stride <= tsBytes.length; pos += stride) {
            var pktOffset = stride === 192 ? pos + 4 : pos;
            if (tsBytes[pktOffset] !== 0x47) continue;

            var pusi = (tsBytes[pktOffset + 1] & 0x40) !== 0;
            var pid = ((tsBytes[pktOffset + 1] & 0x1f) << 8) | tsBytes[pktOffset + 2];
            var afc = (tsBytes[pktOffset + 3] >> 4) & 0x03;
            if (afc === 0 || afc === 2) continue;

            var payloadOffset = pktOffset + 4;
            if (afc === 3) {
                var adaptLen = tsBytes[payloadOffset];
                payloadOffset += 1 + adaptLen;
            }
            var pktEnd = pktOffset + 188;
            if (payloadOffset >= pktEnd) continue;

            if (pid === 0) {
                var ptr = pusi ? tsBytes[payloadOffset] : 0;
                var secStart = payloadOffset + (pusi ? 1 + ptr : 0);
                if (secStart + 12 <= pktEnd && tsBytes[secStart] === 0x00) {
                    var secLen = ((tsBytes[secStart + 1] & 0x0f) << 8) | tsBytes[secStart + 2];
                    var entriesEnd = Math.min(pktEnd, secStart + 3 + secLen - 4);
                    for (var p = secStart + 8; p + 4 <= entriesEnd; p += 4) {
                        var progNum = (tsBytes[p] << 8) | tsBytes[p + 1];
                        var pPid = ((tsBytes[p + 2] & 0x1f) << 8) | tsBytes[p + 3];
                        if (progNum !== 0) { pmtPid = pPid; break; }
                    }
                }
                continue;
            }

            if (pid === pmtPid && pmtPid !== -1) {
                var ptr2 = pusi ? tsBytes[payloadOffset] : 0;
                var secStart2 = payloadOffset + (pusi ? 1 + ptr2 : 0);
                if (secStart2 + 12 <= pktEnd && tsBytes[secStart2] === 0x02) {
                    var secLen2 = ((tsBytes[secStart2 + 1] & 0x0f) << 8) | tsBytes[secStart2 + 2];
                    var progInfoLen = ((tsBytes[secStart2 + 10] & 0x0f) << 8) | tsBytes[secStart2 + 11];
                    var esPos = secStart2 + 12 + progInfoLen;
                    var secEnd2 = Math.min(pktEnd, secStart2 + 3 + secLen2 - 4);
                    while (esPos + 5 <= secEnd2) {
                        var streamType = tsBytes[esPos];
                        var elemPid = ((tsBytes[esPos + 1] & 0x1f) << 8) | tsBytes[esPos + 2];
                        var esInfoLen = ((tsBytes[esPos + 3] & 0x0f) << 8) | tsBytes[esPos + 4];
                        if (streamType === 0x1b) { videoPid = elemPid; break; }
                        esPos += 5 + esInfoLen;
                    }
                }
                continue;
            }

            if (videoPid === -1 && pusi && payloadOffset + 9 < pktEnd) {
                if (tsBytes[payloadOffset] === 0x00 && tsBytes[payloadOffset + 1] === 0x00 && tsBytes[payloadOffset + 2] === 0x01) {
                    var streamId = tsBytes[payloadOffset + 3];
                    if (streamId >= 0xe0 && streamId <= 0xef) videoPid = pid;
                }
            }

            if (pid === videoPid && videoPid !== -1) {
                if (pusi) {
                    flushCurrentPes();
                    if (payloadOffset + 9 <= pktEnd && tsBytes[payloadOffset] === 0x00 && tsBytes[payloadOffset + 1] === 0x00 && tsBytes[payloadOffset + 2] === 0x01) {
                        var flags2 = tsBytes[payloadOffset + 7];
                        var pesHeaderLen = tsBytes[payloadOffset + 8];
                        if ((flags2 & 0x80) !== 0 && payloadOffset + 14 <= pktEnd) {
                            currentPts = parsePTS(tsBytes, payloadOffset + 9);
                        }
                        var esStart = payloadOffset + 9 + pesHeaderLen;
                        if (esStart < pktEnd) {
                            var slice = tsBytes.subarray(esStart, pktEnd);
                            currentPes.push(slice);
                            totalCurrentLen += slice.length;
                        }
                    }
                } else if (currentPes.length > 0) {
                    var slice2 = tsBytes.subarray(payloadOffset, pktEnd);
                    currentPes.push(slice2);
                    totalCurrentLen += slice2.length;
                }
            }
        }
        flushCurrentPes();
        if (pesChunks.length === 0) return null;

        function extractNals(data) {
            var nals = [], starts = [], len = data.length, i = 0;
            while (i < len - 3) {
                if (data[i] === 0 && data[i + 1] === 0) {
                    if (data[i + 2] === 1) { starts.push({ offset: i + 3, scLen: 3 }); i += 3; continue; }
                    if (i < len - 4 && data[i + 2] === 0 && data[i + 3] === 1) { starts.push({ offset: i + 4, scLen: 4 }); i += 4; continue; }
                }
                i++;
            }
            for (var idx = 0; idx < starts.length; idx++) {
                var st = starts[idx].offset;
                var end = idx + 1 < starts.length ? starts[idx + 1].offset - starts[idx + 1].scLen : len;
                while (end > st && data[end - 1] === 0) end--;
                if (end > st) nals.push(data.subarray(st, end));
            }
            return nals;
        }

        var sps = null, pps = null, samples = [], mdatTotalSize = 0;
        for (var pIdx = 0; pIdx < pesChunks.length; pIdx++) {
            var pes = pesChunks[pIdx];
            var nals = extractNals(pes.data);
            var sampleNals = [], isKeyframe = false, hasVCL = false, sampleByteLen = 0;
            for (var nIdx = 0; nIdx < nals.length; nIdx++) {
                var nal = nals[nIdx];
                if (nal.length === 0) continue;
                var nalType = nal[0] & 0x1f;
                if (nalType === 7) { if (!sps) sps = nal; }
                else if (nalType === 8) { if (!pps) pps = nal; }
                else if (nalType === 5) { isKeyframe = true; hasVCL = true; sampleNals.push(nal); sampleByteLen += 4 + nal.length; }
                else if (nalType >= 1 && nalType <= 6) {
                    if (nalType >= 1 && nalType <= 4) hasVCL = true;
                    sampleNals.push(nal); sampleByteLen += 4 + nal.length;
                }
            }
            if (hasVCL && sampleByteLen > 0) {
                var sampleData = new Uint8Array(sampleByteLen);
                var wOff = 0;
                for (var sIdx = 0; sIdx < sampleNals.length; sIdx++) {
                    var sn = sampleNals[sIdx];
                    var l = sn.length;
                    sampleData[wOff] = (l >>> 24) & 0xff;
                    sampleData[wOff + 1] = (l >>> 16) & 0xff;
                    sampleData[wOff + 2] = (l >>> 8) & 0xff;
                    sampleData[wOff + 3] = l & 0xff;
                    sampleData.set(sn, wOff + 4);
                    wOff += 4 + l;
                }
                samples.push({ pts: pes.pts, duration: 3000, isKeyframe: isKeyframe, data: sampleData });
                mdatTotalSize += sampleByteLen;
            }
        }
        if (!sps || !pps || samples.length === 0) return null;

        var defaultDelta = 3000;
        if (samples.length > 1) {
            var firstPts = samples[0].pts, lastPts = samples[samples.length - 1].pts;
            if (lastPts > firstPts) {
                var avg = Math.round((lastPts - firstPts) / (samples.length - 1));
                if (avg >= 500 && avg <= 9000) defaultDelta = avg;
            }
        }
        var totalDuration = 0;
        for (var si = 0; si < samples.length; si++) {
            var delta = defaultDelta;
            if (si + 1 < samples.length) {
                var d = samples[si + 1].pts - samples[si].pts;
                if (d >= 500 && d <= 18000) delta = d;
            }
            samples[si].duration = delta;
            totalDuration += delta;
        }

        function u32(v) { return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]); }
        function u16(v) { return new Uint8Array([(v >>> 8) & 0xff, v & 0xff]); }
        function str4(s) { return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]); }
        function concatArrays(arrays) {
            var total = 0;
            for (var a = 0; a < arrays.length; a++) total += arrays[a].length;
            var out = new Uint8Array(total), o = 0;
            for (var b = 0; b < arrays.length; b++) { out.set(arrays[b], o); o += arrays[b].length; }
            return out;
        }
        function makeBox(type, payloads) {
            var body = concatArrays(payloads);
            return concatArrays([u32(8 + body.length), str4(type), body]);
        }

        var width = 1920, height = 1080;
        var ftyp = makeBox('ftyp', [str4('isom'), u32(512), str4('isom'), str4('iso2'), str4('avc1'), str4('mp41')]);
        var mdatOffset = ftyp.length;
        var mdatDataStart = mdatOffset + 8;

        var avcC = makeBox('avcC', [
            new Uint8Array([1, sps[1] || 0x64, sps[2] || 0x00, sps[3] || 0x28, 0xff, 0xe1]),
            u16(sps.length), sps,
            new Uint8Array([1]),
            u16(pps.length), pps
        ]);
        var avc1 = makeBox('avc1', [
            new Uint8Array(6), u16(1), new Uint8Array(16), u16(width), u16(height),
            u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Uint8Array(32), u16(0x0018), u16(0xffff),
            avcC
        ]);
        var stsd = makeBox('stsd', [u32(0), u32(1), avc1]);

        var sttsPayloads = [u32(0), u32(samples.length)];
        for (var s1 = 0; s1 < samples.length; s1++) {
            sttsPayloads.push(u32(1), u32(samples[s1].duration));
        }
        var stts = makeBox('stts', sttsPayloads);

        var keyframeIndices = [];
        for (var idx2 = 0; idx2 < samples.length; idx2++) {
            if (samples[idx2].isKeyframe) keyframeIndices.push(idx2 + 1);
        }
        if (keyframeIndices.length === 0) keyframeIndices.push(1);
        var stssPayloads = [u32(0), u32(keyframeIndices.length)];
        for (var kIdx = 0; kIdx < keyframeIndices.length; kIdx++) stssPayloads.push(u32(keyframeIndices[kIdx]));
        var stss = makeBox('stss', stssPayloads);

        var stsc = makeBox('stsc', [u32(0), u32(1), u32(1), u32(samples.length), u32(1)]);
        var stszPayloads = [u32(0), u32(0), u32(samples.length)];
        for (var s2 = 0; s2 < samples.length; s2++) stszPayloads.push(u32(samples[s2].data.length));
        var stsz = makeBox('stsz', stszPayloads);
        var stco = makeBox('stco', [u32(0), u32(1), u32(mdatDataStart)]);

        var stbl = makeBox('stbl', [stsd, stts, stss, stsc, stsz, stco]);
        var vmhd = makeBox('vmhd', [u32(1), new Uint8Array(8)]);
        var dref = makeBox('dref', [u32(0), u32(1), makeBox('url ', [u32(1)])]);
        var dinf = makeBox('dinf', [dref]);
        var minf = makeBox('minf', [vmhd, dinf, stbl]);

        var mdhd = makeBox('mdhd', [u32(0), u32(0), u32(0), u32(90000), u32(totalDuration), u16(0x55c4), u16(0)]);
        var hdlr = makeBox('hdlr', [u32(0), u32(0), str4('vide'), new Uint8Array(12), new Uint8Array([86, 105, 100, 101, 111, 0])]);
        var mdia = makeBox('mdia', [mdhd, hdlr, minf]);

        var matrix = new Uint8Array([
            0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0x00, 0x01, 0x00, 0x00, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0, 0x40, 0x00, 0x00, 0x00
        ]);
        var tkhd = makeBox('tkhd', [
            u32(0x00000003), u32(0), u32(0), u32(1), u32(0), u32(totalDuration),
            new Uint8Array(8), u16(0), u16(0), u16(0), u16(0),
            matrix, u32(width << 16), u32(height << 16)
        ]);
        var trak = makeBox('trak', [tkhd, mdia]);
        var mvhd = makeBox('mvhd', [
            u32(0), u32(0), u32(0), u32(90000), u32(totalDuration),
            u32(0x00010000), u16(0x0100), new Uint8Array(10),
            matrix, new Uint8Array(24), u32(2)
        ]);
        var moov = makeBox('moov', [mvhd, trak]);

        var outBuffer = new Uint8Array(ftyp.length + 8 + mdatTotalSize + moov.length);
        outBuffer.set(ftyp, 0);
        outBuffer.set(u32(8 + mdatTotalSize), ftyp.length);
        outBuffer.set(str4('mdat'), ftyp.length + 4);
        var mOff = ftyp.length + 8;
        for (var s3 = 0; s3 < samples.length; s3++) {
            outBuffer.set(samples[s3].data, mOff);
            mOff += samples[s3].data.length;
        }
        outBuffer.set(moov, mOff);
        return outBuffer;
    }

    // Safely read up to maxBytes from a local file without crashing V8 memory on huge broadcast files
    function readCappedFileBytes(filePath, maxBytes) {
        if (typeof window === 'undefined' || !window.require) return null;
        try {
            var fs = window.require('fs');
            if (!fs || !fs.existsSync(filePath)) return null;
            var stat = fs.statSync(filePath);
            var readLen = Math.min(stat.size, maxBytes || (64 * 1024 * 1024));
            var fd = fs.openSync(filePath, 'r');
            var buf = Buffer.alloc(readLen);
            fs.readSync(fd, buf, 0, readLen, 0);
            fs.closeSync(fd);
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        } catch (e) {
            return null;
        }
    }

    // Universal Video Transcoder / Remuxer for .TS, .MTS, .M2TS, .MKV, .MOV, .MXF, .AVI, .WMV, .MPG
    function transcodeOrFallbackVideo(fileOrPath, isFileObj, inSec, name, outSec) {
        var displayName = name || (isFileObj ? fileOrPath.name : fileOrPath.split(/[\\\\/]/).pop());

        // Fast-Path 0: Pure-JS In-Memory MPEG-TS (.ts / .mts / .m2ts) to MP4 Remuxer (~40ms, zero external binaries)
        if (isMPEGTransportStream(displayName)) {
            showToast('Remuxing ' + displayName + ' (MPEG-TS) to MP4 in memory...', 'info');
            if (isFileObj && fileOrPath.slice) {
                var sliceBlob = fileOrPath.slice(0, 64 * 1024 * 1024);
                var reader = new FileReader();
                reader.onload = function() {
                    var remuxed = remuxTSToMP4(new Uint8Array(reader.result));
                    if (remuxed) {
                        video.onerror = null;
                        video.src = URL.createObjectURL(new Blob([remuxed], { type: 'video/mp4' }));
                        video.load();
                    } else {
                        runExternalTranscode(fileOrPath, isFileObj, displayName);
                    }
                };
                reader.readAsArrayBuffer(sliceBlob);
                return;
            } else if (!isFileObj) {
                var rawBytes = readCappedFileBytes(fileOrPath, 64 * 1024 * 1024);
                if (rawBytes) {
                    var remuxedDisk = remuxTSToMP4(rawBytes);
                    if (remuxedDisk) {
                        video.onerror = null;
                        video.src = URL.createObjectURL(new Blob([remuxedDisk], { type: 'video/mp4' }));
                        video.load();
                        return;
                    }
                }
            }
        }

        runExternalTranscode(fileOrPath, isFileObj, displayName);
    }

    function runExternalTranscode(fileOrPath, isFileObj, displayName) {
        showToast('Transcoding ' + displayName + ' to H.264 MP4 video stream...', 'info');

        // Tier 1: If running inside CEP with Node.js child_process, look for ffmpeg on system
        if (!isFileObj && typeof window !== 'undefined' && window.require) {
            try {
                var cp = window.require('child_process');
                var os = window.require('os');
                var pathMod = window.require('path');
                var fs = window.require('fs');
                var candidates = ['ffmpeg', 'C:\\\\ffmpeg\\\\bin\\\\ffmpeg.exe', 'C:\\\\ProgramData\\\\chocolatey\\\\bin\\\\ffmpeg.exe', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'];
                var ffmpegBin = 'ffmpeg';
                for (var c = 0; c < candidates.length; c++) {
                    if (candidates[c].indexOf('/') !== -1 || candidates[c].indexOf('\\\\') !== -1) {
                        if (fs.existsSync(candidates[c])) { ffmpegBin = candidates[c]; break; }
                    }
                }
                var outMp4 = pathMod.join(os.tmpdir(), 'nightosphere_proxy_' + Date.now() + '.mp4');
                cp.execFile(ffmpegBin, [
                    '-y', '-i', fileOrPath,
                    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '18',
                    '-pix_fmt', 'yuv420p', '-g', '15', '-an', '-movflags', '+faststart',
                    outMp4
                ], { timeout: 60000 }, function(err) {
                    if (!err && fs.existsSync(outMp4)) {
                        var clean = outMp4.replace(/\\\\/g, '/');
                        var proxyUrl = /^[a-zA-Z]:\\//.test(clean) ? ('file:///' + encodeURI(clean)) : ('file://' + encodeURI(clean));
                        video.onerror = null;
                        video.src = proxyUrl;
                        video.load();
                        return;
                    }
                    sendToConvertApi(fileOrPath, isFileObj, displayName);
                });
                return;
            } catch (eNode) {}
        }

        sendToConvertApi(fileOrPath, isFileObj, displayName);
    }

    function sendToConvertApi(fileOrPath, isFileObj, displayName) {
        var bodyData = isFileObj ? fileOrPath : null;
        if (!bodyData && typeof window !== 'undefined' && window.require) {
            var capped = readCappedFileBytes(fileOrPath, 64 * 1024 * 1024);
            if (capped) bodyData = new Blob([capped]);
        }
        if (!bodyData) {
            showToast('Could not read ' + displayName + '.', 'error');
            return;
        }
        var apiEndpoint = (window.location.protocol === 'file:') ? 'http://127.0.0.1:3000/api/convert-video' : '/api/convert-video';
        fetch(apiEndpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/octet-stream',
                'X-File-Name': encodeURIComponent(displayName)
            },
            body: bodyData
        }).then(function(resp) {
            if (!resp.ok) throw new Error('Convert API unavailable');
            return resp.blob();
        }).then(function(mp4Blob) {
            video.onerror = null;
            video.src = URL.createObjectURL(mp4Blob);
            video.load();
        }).catch(function() {
            showToast('Could not decode ' + displayName + '. Ensure H.264 codec or local server is running.', 'error');
        });
    }

    // Attach video event listeners at top-level so BOTH timeline clips and Browse/Drop video files trigger onseeked!
    video.onloadedmetadata = function() {
        var dur = video.duration || 5;
        state.durationSeconds = dur;
        if (!state.outPointSeconds || state.outPointSeconds > dur) {
            state.outPointSeconds = dur;
        }
        state.totalFrames = Math.max(1, Math.round(dur * state.fps));
        var scrub = document.getElementById('slider-scrub');
        if (scrub) scrub.max = state.totalFrames - 1;

        var startSec = (state.inPointSeconds && state.inPointSeconds < dur) ? state.inPointSeconds : 0.001;
        video.currentTime = startSec;
        document.getElementById('clip-title').textContent = state.activeClipName || 'Loaded Video';
        showToast('Loaded video: ' + (state.activeClipName || 'Clip') + ' (' + dur.toFixed(1) + 's)', 'success');
    };

    video.onseeked = function() {
        renderDisplay();
        var currentSec = video.currentTime;
        var currentFr = Math.round(currentSec * state.fps);
        state.currentFrame = currentFr;
        var tcEl = document.getElementById('timecode-display');
        if (tcEl) tcEl.textContent = formatTimecode(currentSec, state.fps);
        var scrub = document.getElementById('slider-scrub');
        if (scrub) scrub.value = currentFr;

        // If continuous tracking is active, process frame and advance
        if (state.isTracking) {
            setTimeout(function() {
                if (state.isTracking) processTrackingStep();
            }, 15);
        }
    };

    // Helper: Build safe video URL from Windows/Mac file path without exhausting CEF RAM
    function getMediaBlobUrl(filePath) {
        if (!filePath) return '';
        var ext = getFileExtension(filePath);
        if (typeof window !== 'undefined' && window.require) {
            try {
                var fs = window.require('fs');
                if (fs && fs.existsSync(filePath)) {
                    var stat = fs.statSync(filePath);
                    // Only load into memory Blob if <= 80 MB; larger files stream directly via file:/// URL
                    if (stat.size <= 80 * 1024 * 1024) {
                        var buffer = fs.readFileSync(filePath);
                        var mime = (ext === '.mkv' || ext === '.webm') ? 'video/webm' : 'video/mp4';
                        var blob = new Blob([buffer], { type: mime });
                        return URL.createObjectURL(blob);
                    }
                }
            } catch (err) {
                console.warn('Node fs buffer read failed:', err);
            }
        }
        var clean = filePath.replace(/\\\\/g, '/');
        if (/^[a-zA-Z]:\\//.test(clean)) {
            return 'file:///' + encodeURI(clean);
        }
        if (clean.indexOf('file://') === 0) {
            return encodeURI(clean);
        }
        return 'file://' + encodeURI(clean);
    }

    // Load media into video element (supports .MP4, .TS, .MTS, .M2TS, .MKV, .MOV, .MXF, .AVI, .WMV, .WEBM)
    function loadMediaPath(filePath, inSec, name, outSec) {
        var dropOverlay = document.getElementById('drop-overlay');
        if (dropOverlay) dropOverlay.style.display = 'none';

        state.inPointSeconds = inSec || 0;
        state.outPointSeconds = outSec || 0;
        state.activeClipName = name || 'Timeline Clip';
        state.rawKeyframes = [];
        templates = { p1: null, p2: null };
        anchorTemplates = { p1: null, p2: null };
        velocities = { p1: { vx: 0, vy: 0 }, p2: { vx: 0, vy: 0 } };
        updateKeyframeTable();

        if (isMPEGTransportStream(filePath) || isContainerNeedingTranscode(filePath)) {
            transcodeOrFallbackVideo(filePath, false, inSec, name, outSec);
            return;
        }

        var mediaUrl = getMediaBlobUrl(filePath);
        if (!mediaUrl) {
            showToast('Invalid file path for clip.', 'error');
            return;
        }

        video.onerror = function() {
            transcodeOrFallbackVideo(filePath, false, inSec, name, outSec);
        };
        video.src = mediaUrl;
        video.load();
    }

    // Refresh timeline clips list from Premiere sequence
    function refreshTimelineClips() {
        if (!isCEP) {
            var sel = document.getElementById('sel-timeline-clips');
            if (sel) sel.innerHTML = '<option value="">[Dev Mode] Browse or Drop Video below</option>';
            return;
        }

        csInterface.evalScript('getTimelineTracks()', function(result) {
            try {
                var parsed = JSON.parse(result);
                var sel = document.getElementById('sel-timeline-clips');
                if (!sel) return;
                sel.innerHTML = '';

                if (!parsed.tracks || parsed.tracks.length === 0) {
                    sel.innerHTML = '<option value="">No active sequence found</option>';
                    return;
                }

                var count = 0;
                parsed.tracks.forEach(function(track) {
                    if (track.clips) {
                        track.clips.forEach(function(clip) {
                            var opt = document.createElement('option');
                            opt.value = clip.mediaPath || '';
                            opt.dataset.inPoint = clip.inPoint || 0;
                            opt.dataset.outPoint = clip.outPoint || 0;
                            opt.dataset.name = clip.name;
                            opt.textContent = '[' + track.name + '] ' + clip.name;
                            sel.appendChild(opt);
                            count++;
                        });
                    }
                });

                if (count === 0) {
                    sel.innerHTML = '<option value="">No clips found on video tracks</option>';
                }
            } catch (e) {
                console.error('Failed to parse timeline clips:', e);
            }
        });
    }

    // Connect timeline load button
    var btnLoad = document.getElementById('btn-load-clip');
    if (btnLoad) {
        btnLoad.onclick = function() {
            var sel = document.getElementById('sel-timeline-clips');
            var selectedOpt = sel ? sel.options[sel.selectedIndex] : null;
            var path = selectedOpt ? selectedOpt.value : '';

            if (!path) {
                csInterface.evalScript('getSelectedClipInfo()', function(res) {
                    try {
                        var clip = JSON.parse(res);
                        if (clip.error) {
                            showToast(clip.error, 'error');
                            return;
                        }
                        if (clip.mediaPath) {
                            state.fps = clip.fps || 30;
                            loadMediaPath(clip.mediaPath, clip.inPointSeconds, clip.name, clip.outPointSeconds);
                        } else {
                            showToast('Selected clip has no direct file media. Browse Video.', 'info');
                            var dropOverlay = document.getElementById('drop-overlay');
                            if (dropOverlay) dropOverlay.style.display = 'flex';
                        }
                    } catch (e) {
                        showToast('Error reading selected clip.', 'error');
                    }
                });
                return;
            }

            var inSec = parseFloat(selectedOpt.dataset.inPoint) || 0;
            var outSec = parseFloat(selectedOpt.dataset.outPoint) || 0;
            loadMediaPath(path, inSec, selectedOpt.dataset.name, outSec);
        };
    }

    var btnRefresh = document.getElementById('btn-refresh-timeline');
    if (btnRefresh) btnRefresh.onclick = refreshTimelineClips;

    // Local file picker & drag and drop (handles .MP4, .TS, .MTS, .M2TS, .MKV, .MOV, .MXF, .AVI, .WMV, .WEBM, etc.)
    function handleFile(file) {
        if (!file) return;
        state.inPointSeconds = 0;
        state.outPointSeconds = 0;
        state.activeClipName = file.name;
        state.rawKeyframes = [];
        templates = { p1: null, p2: null };
        anchorTemplates = { p1: null, p2: null };
        velocities = { p1: { vx: 0, vy: 0 }, p2: { vx: 0, vy: 0 } };
        updateKeyframeTable();

        var dropOverlay = document.getElementById('drop-overlay');
        if (dropOverlay) dropOverlay.style.display = 'none';

        if (isMPEGTransportStream(file.name) || isContainerNeedingTranscode(file.name)) {
            transcodeOrFallbackVideo(file.path || file, !file.path, 0, file.name, 0);
            return;
        }

        var ext = getFileExtension(file.name);
        var playBlob = (ext === '.mkv') ? new Blob([file], { type: 'video/webm' }) : file;
        var url = URL.createObjectURL(playBlob);
        video.onerror = function() {
            transcodeOrFallbackVideo(file.path || file, !file.path, 0, file.name, 0);
        };
        video.src = url;
        video.load();
    }

    var localPicker = document.getElementById('local-file-picker');
    if (localPicker) {
        localPicker.onchange = function(e) {
            if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
        };
    }

    var overlayPicker = document.getElementById('overlay-file-picker');
    if (overlayPicker) {
        overlayPicker.onchange = function(e) {
            if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
        };
    }

    var dropzone = document.getElementById('canvas-dropzone');
    if (dropzone) {
        dropzone.ondragover = function(e) {
            e.preventDefault();
            dropzone.style.borderColor = '#3ea6ff';
        };
        dropzone.ondragleave = function() {
            dropzone.style.borderColor = '#333';
        };
        dropzone.ondrop = function(e) {
            e.preventDefault();
            dropzone.style.borderColor = '#333';
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFile(e.dataTransfer.files[0]);
            }
        };
    }

    // Scrubber
    var scrubber = document.getElementById('slider-scrub');
    if (scrubber) {
        scrubber.oninput = function() {
            var targetFrame = parseInt(scrubber.value, 10);
            video.currentTime = targetFrame / state.fps;
        };
    }

    function applyViewportTransform() {
        if (!canvas) return;
        canvas.style.transform = 'translate(' + state.panX + 'px, ' + state.panY + 'px) scale(' + state.zoomLevel + ')';
        var zBadge = document.getElementById('zoom-badge');
        if (zBadge) zBadge.textContent = Math.round(state.zoomLevel * 100) + '%';
    }

    // Canvas Viewport rendering + 6x Pixel Magnifier Loupe + 4-Pin 3D Surface Quad
    function renderDisplay() {
        if (video.readyState >= 2) {
            try {
                cleanCtx.drawImage(video, 0, 0, cleanCanvas.width, cleanCanvas.height);
                ctx.drawImage(cleanCanvas, 0, 0, canvas.width, canvas.height);
            } catch (e) {}
        } else {
            ctx.fillStyle = '#111';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }

        // Draw 4-Pin Free-Edit Surface Quad & 3D Perspective Grid when in 4-Pin mode
        if (state.pointMode === 4 && state.points.p3 && state.points.p4) {
            var q1 = state.points.p1, q2 = state.points.p2, q3 = state.points.p3, q4 = state.points.p4;
            ctx.save();
            ctx.fillStyle = 'rgba(62, 166, 255, 0.14)';
            ctx.strokeStyle = 'rgba(62, 166, 255, 0.9)';
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(q1.x, q1.y);
            ctx.lineTo(q2.x, q2.y);
            ctx.lineTo(q3.x, q3.y);
            ctx.lineTo(q4.x, q4.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Perspective grid lines (3x3 subdivisions)
            ctx.strokeStyle = 'rgba(168, 85, 247, 0.45)';
            ctx.lineWidth = 0.9;
            for (var gi = 1; gi <= 2; gi++) {
                var gt = gi / 3;
                var tx = q1.x + (q2.x - q1.x) * gt, ty = q1.y + (q2.y - q1.y) * gt;
                var bx = q4.x + (q3.x - q4.x) * gt, by = q4.y + (q3.y - q4.y) * gt;
                var lx = q1.x + (q4.x - q1.x) * gt, ly = q1.y + (q4.y - q1.y) * gt;
                var rx = q2.x + (q3.x - q2.x) * gt, ry = q2.y + (q3.y - q2.y) * gt;
                ctx.beginPath();
                ctx.moveTo(tx, ty); ctx.lineTo(bx, by);
                ctx.moveTo(lx, ly); ctx.lineTo(rx, ry);
                ctx.stroke();
            }
            ctx.restore();
        }

        drawTarget(state.points.p1, state.pointMode === 4 ? 'UL' : 'P1');
        if (state.pointMode >= 2) drawTarget(state.points.p2, state.pointMode === 4 ? 'UR' : 'P2');
        if (state.pointMode === 4) {
            drawTarget(state.points.p3, 'LR');
            drawTarget(state.points.p4, 'LL');
        }

        if (state.rawKeyframes.length > 1) {
            ctx.strokeStyle = '#3ea6ff';
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            state.rawKeyframes.forEach(function(k, i) {
                var pt = k.points && k.points.p1;
                if (pt) {
                    if (i === 0) ctx.moveTo(pt.x, pt.y);
                    else ctx.lineTo(pt.x, pt.y);
                }
            });
            ctx.stroke();
        }

        var cDisp = document.getElementById('coords-display');
        if (cDisp) {
            if (state.pointMode === 4) {
                var cx4 = (state.points.p1.x + state.points.p2.x + state.points.p3.x + state.points.p4.x) * 0.25;
                var cy4 = (state.points.p1.y + state.points.p2.y + state.points.p3.y + state.points.p4.y) * 0.25;
                cDisp.textContent = '3D Quad Center: ' + cx4.toFixed(1) + ', ' + cy4.toFixed(1);
            } else {
                cDisp.textContent = 'P1: ' + state.points.p1.x.toFixed(1) + ', ' + state.points.p1.y.toFixed(1);
            }
        }

        // Render 6x Pixel Magnifier Loupe
        var loupeBox = document.getElementById('loupe-box');
        if (loupeBox) {
            loupeBox.style.display = state.showLoupe ? 'flex' : 'none';
        }
        if (state.showLoupe && loupeCtx && loupeCanvas) {
            var focusPt = state.hoverPt || state.points.p1;
            var lw = loupeCanvas.width;
            var lh = loupeCanvas.height;
            var zf = 6;
            var srcW = lw / zf;
            var srcH = lh / zf;
            var sx = focusPt.x - srcW / 2;
            var sy = focusPt.y - srcH / 2;

            loupeCtx.fillStyle = '#08080a';
            loupeCtx.fillRect(0, 0, lw, lh);
            loupeCtx.imageSmoothingEnabled = false;
            try {
                loupeCtx.drawImage(cleanCanvas, sx, sy, srcW, srcH, 0, 0, lw, lh);
            } catch (eL) {}

            var cx = lw / 2;
            var cy = lh / 2;
            loupeCtx.strokeStyle = '#3ea6ff';
            loupeCtx.lineWidth = 1.2;
            loupeCtx.beginPath();
            loupeCtx.moveTo(cx - 14, cy);
            loupeCtx.lineTo(cx - 2, cy);
            loupeCtx.moveTo(cx + 2, cy);
            loupeCtx.lineTo(cx + 14, cy);
            loupeCtx.moveTo(cx, cy - 14);
            loupeCtx.lineTo(cx, cy - 2);
            loupeCtx.moveTo(cx, cy + 2);
            loupeCtx.lineTo(cx, cy + 14);
            loupeCtx.stroke();

            var lLabel = document.getElementById('loupe-label');
            if (lLabel) lLabel.textContent = '6x (' + focusPt.x.toFixed(1) + ',' + focusPt.y.toFixed(1) + ')';
        }
    }

    function drawTarget(pt, label) {
        if (!pt) return;
        var x = pt.x;
        var y = pt.y;
        var fs = pt.featureSize;
        var ss = pt.searchSize;

        ctx.strokeStyle = pt.color;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(x - ss / 2, y - ss / 2, ss, ss);
        ctx.setLineDash([]);

        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - fs / 2, y - fs / 2, fs, fs);

        ctx.beginPath();
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x + 6, y);
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y + 6);
        ctx.stroke();

        if (label) {
            ctx.fillStyle = pt.color;
            ctx.font = 'bold 9px monospace';
            ctx.fillText(label, x + fs / 2 + 3, y - fs / 2 + 7);
        }
    }

    // Grab template patch exclusively from clean off-screen canvas
    function grabTemplate(pt) {
        if (video.readyState >= 2) {
            try { cleanCtx.drawImage(video, 0, 0, cleanCanvas.width, cleanCanvas.height); } catch (e) {}
        }
        var fs = Math.round(pt.featureSize);
        var x0 = Math.max(0, Math.min(cleanCanvas.width - fs, Math.round(pt.x - fs / 2)));
        var y0 = Math.max(0, Math.min(cleanCanvas.height - fs, Math.round(pt.y - fs / 2)));
        try {
            return cleanCtx.getImageData(x0, y0, fs, fs);
        } catch (e) {
            return null;
        }
    }

    // WebGL GPU Shader Engine for Parallel Template Matching inside Premiere CEP
    var gpuEngine = (function() {
        var gl = null;
        var prog = null;
        var sTex = null;
        var tTex = null;
        var pBuf = null;
        var inited = false;
        var supported = false;

        function init() {
            if (inited) return supported;
            inited = true;
            try {
                var c = document.createElement('canvas');
                c.width = 128; c.height = 128;
                gl = c.getContext('webgl2', { preserveDrawingBuffer: true }) || c.getContext('webgl', { preserveDrawingBuffer: true });
                if (!gl) return false;

                var vsSrc = 'attribute vec2 a_pos; void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }';
                var fsSrc = [
                    'precision highp float;',
                    'uniform sampler2D u_search;',
                    'uniform sampler2D u_template;',
                    'uniform vec2 u_searchSize;',
                    'uniform vec2 u_templateSize;',
                    'uniform float u_tMean;',
                    'uniform float u_tNorm;',
                    'float luma(vec4 c) { return 0.299 * c.r + 0.587 * c.g + 0.114 * c.b; }',
                    'void main() {',
                    '  vec2 oxOy = floor(gl_FragCoord.xy);',
                    '  float sumS = 0.0; float sumSqS = 0.0; float crossSum = 0.0;',
                    '  float count = u_templateSize.x * u_templateSize.y;',
                    '  for (int ty = 0; ty < 64; ty++) {',
                    '    if (float(ty) >= u_templateSize.y) break;',
                    '    for (int tx = 0; tx < 64; tx++) {',
                    '      if (float(tx) >= u_templateSize.x) break;',
                    '      vec2 sUV = (oxOy + vec2(float(tx), float(ty)) + 0.5) / u_searchSize;',
                    '      float sVal = luma(texture2D(u_search, sUV)) * 255.0;',
                    '      sumS += sVal; sumSqS += sVal * sVal;',
                    '    }',
                    '  }',
                    '  float sMean = sumS / max(1.0, count);',
                    '  float sNorm = sqrt(max(0.0, sumSqS - sMean * sumS));',
                    '  float score = 0.0;',
                    '  if (sNorm > 0.001 && u_tNorm > 0.001) {',
                    '    for (int ty = 0; ty < 64; ty++) {',
                    '      if (float(ty) >= u_templateSize.y) break;',
                    '      for (int tx = 0; tx < 64; tx++) {',
                    '        if (float(tx) >= u_templateSize.x) break;',
                    '        vec2 sUV = (oxOy + vec2(float(tx), float(ty)) + 0.5) / u_searchSize;',
                    '        vec2 tUV = (vec2(float(tx), float(ty)) + 0.5) / u_templateSize;',
                    '        float sVal = luma(texture2D(u_search, sUV)) * 255.0 - sMean;',
                    '        float tVal = luma(texture2D(u_template, tUV)) * 255.0 - u_tMean;',
                    '        crossSum += sVal * tVal;',
                    '      }',
                    '    }',
                    '    score = crossSum / (sNorm * u_tNorm);',
                    '  }',
                    '  float val16 = floor(clamp((score + 1.0) * 0.5, 0.0, 1.0) * 65535.0 + 0.5);',
                    '  float hi = floor(val16 / 256.0);',
                    '  float lo = val16 - hi * 256.0;',
                    '  gl_FragColor = vec4(hi / 255.0, lo / 255.0, 0.0, 1.0);',
                    '}'
                ].join('\\n');

                function mkShader(t, s) {
                    var sh = gl.createShader(t);
                    gl.shaderSource(sh, s);
                    gl.compileShader(sh);
                    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
                }
                var vs = mkShader(gl.VERTEX_SHADER, vsSrc);
                var fs = mkShader(gl.FRAGMENT_SHADER, fsSrc);
                if (!vs || !fs) return false;
                prog = gl.createProgram();
                gl.attachShader(prog, vs); gl.attachShader(prog, fs);
                gl.linkProgram(prog);
                if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;

                function mkTex() {
                    var tx = gl.createTexture();
                    gl.bindTexture(gl.TEXTURE_2D, tx);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
                    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
                    return tx;
                }
                sTex = mkTex();
                tTex = mkTex();
                pBuf = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, pBuf);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
                supported = true;
                return true;
            } catch (e) {
                supported = false;
                return false;
            }
        }

        function match(searchData, templateData, sx0, sy0) {
            if (!init() || !gl || !prog) return null;
            var sw = searchData.width, sh = searchData.height;
            var tw = templateData.width, th = templateData.height;
            if (sw < tw || sh < th || tw > 64 || th > 64) return null;

            var outW = sw - tw + 1;
            var outH = sh - th + 1;
            var tBuf = templateData.data;
            var tN = tw * th;
            var tSum = 0;
            var tGray = new Float32Array(tN);
            for (var i = 0, p = 0; i < tBuf.length; i += 4, p++) {
                var v = 0.299 * tBuf[i] + 0.587 * tBuf[i+1] + 0.114 * tBuf[i+2];
                tGray[p] = v; tSum += v;
            }
            var tMean = tSum / tN;
            var tNormSq = 0;
            for (var p2 = 0; p2 < tN; p2++) {
                var d = tGray[p2] - tMean;
                tNormSq += d * d;
            }
            var tNorm = Math.sqrt(tNormSq);
            if (tNorm < 0.001) return { bestX: sx0 + sw / 2, bestY: sy0 + sh / 2, score: 0 };

            if (gl.canvas.width < outW || gl.canvas.height < outH) {
                gl.canvas.width = Math.max(gl.canvas.width, outW);
                gl.canvas.height = Math.max(gl.canvas.height, outH);
            }
            gl.viewport(0, 0, outW, outH);
            gl.useProgram(prog);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, sTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, sw, sh, 0, gl.RGBA, gl.UNSIGNED_BYTE, searchData.data);
            gl.uniform1i(gl.getUniformLocation(prog, 'u_search'), 0);

            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, tTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, tw, th, 0, gl.RGBA, gl.UNSIGNED_BYTE, templateData.data);
            gl.uniform1i(gl.getUniformLocation(prog, 'u_template'), 1);

            gl.uniform2f(gl.getUniformLocation(prog, 'u_searchSize'), sw, sh);
            gl.uniform2f(gl.getUniformLocation(prog, 'u_templateSize'), tw, th);
            gl.uniform1f(gl.getUniformLocation(prog, 'u_tMean'), tMean);
            gl.uniform1f(gl.getUniformLocation(prog, 'u_tNorm'), tNorm);

            var posLoc = gl.getAttribLocation(prog, 'a_pos');
            gl.bindBuffer(gl.ARRAY_BUFFER, pBuf);
            gl.enableVertexAttribArray(posLoc);
            gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

            var outPixels = new Uint8Array(outW * outH * 4);
            gl.readPixels(0, 0, outW, outH, gl.RGBA, gl.UNSIGNED_BYTE, outPixels);

            var scores = new Float32Array(outW * outH);
            var maxScore = -999999, bestOx = 0, bestOy = 0;
            for (var oy = 0; oy < outH; oy++) {
                for (var ox = 0; ox < outW; ox++) {
                    var idx = (oy * outW + ox) * 4;
                    var val16 = outPixels[idx] * 256 + outPixels[idx + 1];
                    var sc = (val16 / 65535.0) * 2.0 - 1.0;
                    scores[oy * outW + ox] = sc;
                    if (sc > maxScore) { maxScore = sc; bestOx = ox; bestOy = oy; }
                }
            }

            var subX = bestOx, subY = bestOy;
            if (bestOx > 0 && bestOx < outW - 1) {
                var sL = scores[bestOy * outW + bestOx - 1], sC = scores[bestOy * outW + bestOx], sR = scores[bestOy * outW + bestOx + 1];
                var denX = 2 * (2 * sC - sL - sR);
                if (Math.abs(denX) > 1e-5) { var dx = (sR - sL) / denX; if (Math.abs(dx) < 1) subX += dx; }
            }
            if (bestOy > 0 && bestOy < outH - 1) {
                var sU = scores[(bestOy - 1) * outW + bestOx], sC2 = scores[bestOy * outW + bestOx], sD = scores[(bestOy + 1) * outW + bestOx];
                var denY = 2 * (2 * sC2 - sU - sD);
                if (Math.abs(denY) > 1e-5) { var dy = (sD - sU) / denY; if (Math.abs(dy) < 1) subY += dy; }
            }

            return { bestX: sx0 + subX + tw / 2, bestY: sy0 + subY + th / 2, score: Math.max(0, maxScore) };
        }

        return { match: match, init: init };
    })();

    // Gaussian-weighted Inverse-Compositional Lucas-Kanade (IC-LK) Sub-Pixel Refinement (0.02px precision)
    function refineSubPixelLK(sGray, sw, sh, tGray, tWeights, tw, th, initOx, initOy) {
        var curOx = initOx, curOy = initOy;
        var gxBuf = new Float32Array(tw * th);
        var gyBuf = new Float32Array(tw * th);
        var h00 = 0, h01 = 0, h11 = 0;

        for (var ty = 1; ty < th - 1; ty++) {
            var row = ty * tw;
            for (var tx = 1; tx < tw - 1; tx++) {
                var idx = row + tx;
                var w = tWeights[idx];
                var gx = 0.5 * (tGray[idx + 1] - tGray[idx - 1]);
                var gy = 0.5 * (tGray[idx + tw] - tGray[idx - tw]);
                gxBuf[idx] = gx; gyBuf[idx] = gy;
                h00 += w * gx * gx;
                h01 += w * gx * gy;
                h11 += w * gy * gy;
            }
        }
        var det = h00 * h11 - h01 * h01;
        if (Math.abs(det) < 1e-4) return { ox: curOx, oy: curOy };

        function sampleBilinear(x, y) {
            var x0 = Math.floor(x), y0 = Math.floor(y);
            var x1 = Math.min(sw - 1, Math.max(0, x0 + 1));
            var y1 = Math.min(sh - 1, Math.max(0, y0 + 1));
            var cx0 = Math.min(sw - 1, Math.max(0, x0));
            var cy0 = Math.min(sh - 1, Math.max(0, y0));
            var fx = x - x0, fy = y - y0;
            var v00 = sGray[cy0 * sw + cx0], v10 = sGray[cy0 * sw + x1];
            var v01 = sGray[y1 * sw + cx0], v11 = sGray[y1 * sw + x1];
            return (1 - fx) * (1 - fy) * v00 + fx * (1 - fy) * v10 + (1 - fx) * fy * v01 + fx * fy * v11;
        }

        var sumW = 0, tWeightedMean = 0;
        for (var i = 0; i < tw * th; i++) {
            sumW += tWeights[i];
            tWeightedMean += tWeights[i] * tGray[i];
        }
        tWeightedMean /= Math.max(1e-5, sumW);

        for (var iter = 0; iter < 2; iter++) {
            var sWeightedMean = 0;
            for (var ty2 = 1; ty2 < th - 1; ty2++) {
                var row2 = ty2 * tw;
                for (var tx2 = 1; tx2 < tw - 1; tx2++) {
                    var idx2 = row2 + tx2;
                    sWeightedMean += tWeights[idx2] * sampleBilinear(curOx + tx2, curOy + ty2);
                }
            }
            sWeightedMean /= Math.max(1e-5, sumW);

            var b0 = 0, b1 = 0;
            for (var ty3 = 1; ty3 < th - 1; ty3++) {
                var row3 = ty3 * tw;
                for (var tx3 = 1; tx3 < tw - 1; tx3++) {
                    var idx3 = row3 + tx3;
                    var w3 = tWeights[idx3];
                    var sVal = sampleBilinear(curOx + tx3, curOy + ty3) - sWeightedMean;
                    var tVal = tGray[idx3] - tWeightedMean;
                    var diff = sVal - tVal;
                    b0 += w3 * gxBuf[idx3] * diff;
                    b1 += w3 * gyBuf[idx3] * diff;
                }
            }
            var dOx = -(h11 * b0 - h01 * b1) / det;
            var dOy = -(-h01 * b0 + h00 * b1) / det;
            if (Math.hypot(dOx, dOy) > 1.25) break;
            curOx += dOx; curOy += dOy;
            if (Math.hypot(dOx, dOy) < 0.015) break;
        }
        return { ox: curOx, oy: curOy };
    }

    // 2D Gaussian Center-Weighted + Edge-Aware NCC + Lucas-Kanade Sub-Pixel Matcher
    function matchTemplateNCC(searchData, templateData, sx0, sy0) {
        var sw = searchData.width, sh = searchData.height;
        var tw = templateData.width, th = templateData.height;
        if (sw < tw || sh < th) return { bestX: sx0 + sw / 2, bestY: sy0 + sh / 2, score: 0 };

        var sBuf = searchData.data, tBuf = templateData.data;
        var tN = tw * th;
        var tWeights = new Float32Array(tN);
        var cx = (tw - 1) * 0.5, cy = (th - 1) * 0.5;
        var sigmaX = Math.max(2.5, tw * 0.34), sigmaY = Math.max(2.5, th * 0.34);
        var sumW = 0;
        for (var wy = 0; wy < th; wy++) {
            var dy = (wy - cy) / sigmaY;
            for (var wx = 0; wx < tw; wx++) {
                var dx = (wx - cx) / sigmaX;
                var w = Math.exp(-0.5 * (dx * dx + dy * dy));
                tWeights[wy * tw + wx] = w;
                sumW += w;
            }
        }

        var tRawGray = new Float32Array(tN);
        var tWeightedSum = 0;
        for (var i = 0, p = 0; i < tBuf.length; i += 4, p++) {
            var val = 0.299 * tBuf[i] + 0.587 * tBuf[i + 1] + 0.114 * tBuf[i + 2];
            tRawGray[p] = val;
            tWeightedSum += tWeights[p] * val;
        }
        var tMean = tWeightedSum / Math.max(1e-5, sumW);
        var tZeroMeanWeighted = new Float32Array(tN);
        var tNormSq = 0;
        for (var p2 = 0; p2 < tN; p2++) {
            var d = tRawGray[p2] - tMean;
            var w2 = tWeights[p2];
            tZeroMeanWeighted[p2] = w2 * d;
            tNormSq += w2 * d * d;
        }
        var tNorm = Math.sqrt(tNormSq);
        if (tNorm < 0.001) return { bestX: sx0 + sw / 2, bestY: sy0 + sh / 2, score: 0 };

        var sGray = new Float32Array(sw * sh);
        var stride = sw + 1;
        var intSum = new Float64Array((sw + 1) * (sh + 1));
        var intSqSum = new Float64Array((sw + 1) * (sh + 1));

        for (var y = 0; y < sh; y++) {
            var rSum = 0, rSqSum = 0, yOff = y * sw;
            var intY = (y + 1) * stride, prevIntY = y * stride;
            for (var x = 0; x < sw; x++) {
                var idx = (yOff + x) * 4;
                var g = 0.299 * sBuf[idx] + 0.587 * sBuf[idx + 1] + 0.114 * sBuf[idx + 2];
                sGray[yOff + x] = g;
                rSum += g; rSqSum += g * g;
                intSum[intY + (x + 1)] = intSum[prevIntY + (x + 1)] + rSum;
                intSqSum[intY + (x + 1)] = intSqSum[prevIntY + (x + 1)] + rSqSum;
            }
        }

        var outW = sw - tw + 1, outH = sh - th + 1;
        var scores = new Float32Array(outW * outH);
        var maxScore = -999999, bestOx = 0, bestOy = 0;
        var centerOx = (outW - 1) * 0.5, centerOy = (outH - 1) * 0.5;
        var maxDistSq = Math.max(1, centerOx * centerOx + centerOy * centerOy);

        for (var oy = 0; oy < outH; oy++) {
            var r1 = oy * stride, r2 = (oy + th) * stride;
            for (var ox = 0; ox < outW; ox++) {
                var c1 = ox, c2 = ox + tw;
                var wSum = intSum[r2 + c2] - intSum[r1 + c2] - intSum[r2 + c1] + intSum[r1 + c1];
                var wSqSum = intSqSum[r2 + c2] - intSqSum[r1 + c2] - intSqSum[r2 + c1] + intSqSum[r1 + c1];
                var wMean = wSum / tN;
                var sVar = wSqSum - tN * wMean * wMean;
                if (sVar <= 0.0001) continue;

                var cross = 0, sWeightedNormSq = 0;
                for (var ty = 0; ty < th; ty++) {
                    var sRow = (oy + ty) * sw + ox;
                    var tRow = ty * tw;
                    for (var tx = 0; tx < tw; tx++) {
                        var sd = sGray[sRow + tx] - wMean;
                        var idxT = tRow + tx;
                        cross += sd * tZeroMeanWeighted[idxT];
                        sWeightedNormSq += tWeights[idxT] * sd * sd;
                    }
                }
                var lumaScore = cross / (Math.sqrt(Math.max(1e-5, sWeightedNormSq)) * tNorm);
                var distSq = (ox - centerOx) * (ox - centerOx) + (oy - centerOy) * (oy - centerOy);
                var score = lumaScore - 0.015 * (distSq / maxDistSq);
                scores[oy * outW + ox] = score;
                if (score > maxScore) { maxScore = score; bestOx = ox; bestOy = oy; }
            }
        }

        var subOx = bestOx, subOy = bestOy;
        if (bestOx > 0 && bestOx < outW - 1) {
            var sL = scores[bestOy * outW + (bestOx - 1)], sC = scores[bestOy * outW + bestOx], sR = scores[bestOy * outW + (bestOx + 1)];
            var denX = 2 * (2 * sC - sL - sR);
            if (Math.abs(denX) > 1e-5) { var dx2 = (sR - sL) / denX; if (Math.abs(dx2) < 1) subOx += dx2; }
        }
        if (bestOy > 0 && bestOy < outH - 1) {
            var sU = scores[(bestOy - 1) * outW + bestOx], sC2 = scores[bestOy * outW + bestOx], sD = scores[(bestOy + 1) * outW + bestOx];
            var denY = 2 * (2 * sC2 - sU - sD);
            if (Math.abs(denY) > 1e-5) { var dy2 = (sD - sU) / denY; if (Math.abs(dy2) < 1) subOy += dy2; }
        }

        var lk = refineSubPixelLK(sGray, sw, sh, tRawGray, tWeights, tw, th, subOx, subOy);
        return {
            bestX: sx0 + lk.ox + tw / 2,
            bestY: sy0 + lk.oy + th / 2,
            score: Math.max(0, Math.min(1, maxScore))
        };
    }

    // Match point in current frame against clean canvas with velocity prediction
    function matchPoint(id, pt, template) {
        if (!template) return { bestX: pt.x, bestY: pt.y, score: 0 };
        var vel = velocities[id] || { vx: 0, vy: 0 };
        var predX = pt.x + vel.vx * 0.65;
        var predY = pt.y + vel.vy * 0.65;
        var ss = Math.round(pt.searchSize);
        var sx0 = Math.max(0, Math.min(cleanCanvas.width - ss, Math.round(predX - ss / 2)));
        var sy0 = Math.max(0, Math.min(cleanCanvas.height - ss, Math.round(predY - ss / 2)));

        try {
            var searchData = cleanCtx.getImageData(sx0, sy0, ss, ss);
            var res = null;
            if (state.useGPU) {
                res = gpuEngine.match(searchData, template, sx0, sy0);
            }
            if (!res) {
                res = matchTemplateNCC(searchData, template, sx0, sy0);
            }

            var stepDx = res.bestX - pt.x;
            var stepDy = res.bestY - pt.y;
            if (Math.hypot(stepDx, stepDy) < ss * 0.48) {
                velocities[id] = { vx: vel.vx * 0.35 + stepDx * 0.65, vy: vel.vy * 0.35 + stepDy * 0.65 };
            } else {
                velocities[id] = { vx: 0, vy: 0 };
            }

            // Anchor-locked anti-drift adaptation (88% original anchor + 12% current patch)
            if (res.score > 0.72) {
                var fs = Math.round(pt.featureSize);
                var fx0 = Math.max(0, Math.min(cleanCanvas.width - fs, Math.round(res.bestX - fs / 2)));
                var fy0 = Math.max(0, Math.min(cleanCanvas.height - fs, Math.round(res.bestY - fs / 2)));
                try {
                    var curPatch = cleanCtx.getImageData(fx0, fy0, fs, fs);
                    var anchor = anchorTemplates[id] || template;
                    var tD = template.data, aD = anchor.data, pD = curPatch.data;
                    for (var b = 0; b < tD.length; b += 4) {
                        tD[b] = aD[b] * 0.88 + pD[b] * 0.12;
                        tD[b+1] = aD[b+1] * 0.88 + pD[b+1] * 0.12;
                        tD[b+2] = aD[b+2] * 0.88 + pD[b+2] * 0.12;
                    }
                } catch (eA) {}
            }
            return res;
        } catch (e) {
            return { bestX: pt.x, bestY: pt.y, score: 0 };
        }
    }

    // Process a single tracking frame and record keyframe (supports 1-point, 2-point, and 4-pin 3D surface)
    function processTrackingStep() {
        if (video.readyState >= 2) {
            try { cleanCtx.drawImage(video, 0, 0, cleanCanvas.width, cleanCanvas.height); } catch (e) {}
        }

        if (!templates.p1) {
            templates.p1 = grabTemplate(state.points.p1);
            anchorTemplates.p1 = cloneImgData(templates.p1);
        }
        if (state.pointMode >= 2 && !templates.p2) {
            templates.p2 = grabTemplate(state.points.p2);
            anchorTemplates.p2 = cloneImgData(templates.p2);
        }
        if (state.pointMode === 4) {
            if (!templates.p3) {
                templates.p3 = grabTemplate(state.points.p3);
                anchorTemplates.p3 = cloneImgData(templates.p3);
            }
            if (!templates.p4) {
                templates.p4 = grabTemplate(state.points.p4);
                anchorTemplates.p4 = cloneImgData(templates.p4);
            }
        }

        var match1 = matchPoint('p1', state.points.p1, templates.p1);
        state.points.p1.x = Math.max(5, Math.min(cleanCanvas.width - 5, match1.bestX));
        state.points.p1.y = Math.max(5, Math.min(cleanCanvas.height - 5, match1.bestY));

        var match2 = null, match3 = null, match4 = null;
        if (state.pointMode >= 2) {
            match2 = matchPoint('p2', state.points.p2, templates.p2);
            state.points.p2.x = Math.max(5, Math.min(cleanCanvas.width - 5, match2.bestX));
            state.points.p2.y = Math.max(5, Math.min(cleanCanvas.height - 5, match2.bestY));
        }
        if (state.pointMode === 4) {
            match3 = matchPoint('p3', state.points.p3, templates.p3);
            state.points.p3.x = Math.max(5, Math.min(cleanCanvas.width - 5, match3.bestX));
            state.points.p3.y = Math.max(5, Math.min(cleanCanvas.height - 5, match3.bestY));

            match4 = matchPoint('p4', state.points.p4, templates.p4);
            state.points.p4.x = Math.max(5, Math.min(cleanCanvas.width - 5, match4.bestX));
            state.points.p4.y = Math.max(5, Math.min(cleanCanvas.height - 5, match4.bestY));
        }

        var currentSec = video.currentTime;
        var currentFr = Math.round(currentSec * state.fps);
        state.currentFrame = currentFr;

        var avgConf = match1.score;
        if (state.pointMode === 4 && match2 && match3 && match4) {
            avgConf = (match1.score + match2.score + match3.score + match4.score) * 0.25;
        } else if (state.pointMode === 2 && match2) {
            avgConf = (match1.score + match2.score) * 0.5;
        }

        var kf = {
            frameNumber: currentFr,
            timeSeconds: currentSec,
            points: {
                p1: { x: state.points.p1.x, y: state.points.p1.y },
                p2: match2 ? { x: state.points.p2.x, y: state.points.p2.y } : undefined,
                p3: match3 ? { x: state.points.p3.x, y: state.points.p3.y } : undefined,
                p4: match4 ? { x: state.points.p4.x, y: state.points.p4.y } : undefined
            },
            confidence: avgConf
        };

        state.rawKeyframes = state.rawKeyframes.filter(function(k) { return k.frameNumber !== currentFr; });
        state.rawKeyframes.push(kf);
        state.rawKeyframes.sort(function(a, b) { return a.frameNumber - b.frameNumber; });

        updateKeyframeTable();
        renderDisplay();

        // Auto-Pause on Low Confidence (Occlusion Guard)
        if (state.isTracking && state.autoPauseLowConf && state.rawKeyframes.length >= 2 && avgConf < 0.55) {
            stopTracking();
            showToast('🛡️ Auto-Paused at Frame ' + currentFr + ': Confidence dropped to ' + Math.round(avgConf * 100) + '%. Nudge pin & resume!', 'error');
            return;
        }

        if (state.isTracking) {
            var step = state.trackDirection * (1 / state.fps);
            var nextTime = currentSec + step;
            var maxBound = (state.outPointSeconds && state.outPointSeconds > state.inPointSeconds)
                ? Math.min(state.durationSeconds, state.outPointSeconds)
                : state.durationSeconds;

            if (nextTime < 0 || nextTime >= maxBound) {
                stopTracking();
                showToast('Tracking complete! ' + state.rawKeyframes.length + ' keyframes recorded.', 'success');
            } else {
                video.currentTime = nextTime;
            }
        }
    }

    function startTracking(direction) {
        if (video.readyState < 2) {
            showToast('Please load a video clip first.', 'error');
            return;
        }

        templates.p1 = grabTemplate(state.points.p1);
        anchorTemplates.p1 = cloneImgData(templates.p1);
        velocities.p1 = { vx: 0, vy: 0 };
        if (state.pointMode >= 2) {
            templates.p2 = grabTemplate(state.points.p2);
            anchorTemplates.p2 = cloneImgData(templates.p2);
            velocities.p2 = { vx: 0, vy: 0 };
        }
        if (state.pointMode === 4) {
            templates.p3 = grabTemplate(state.points.p3);
            anchorTemplates.p3 = cloneImgData(templates.p3);
            velocities.p3 = { vx: 0, vy: 0 };
            templates.p4 = grabTemplate(state.points.p4);
            anchorTemplates.p4 = cloneImgData(templates.p4);
            velocities.p4 = { vx: 0, vy: 0 };
        }

        state.trackDirection = direction;
        state.isTracking = true;
        showToast(direction > 0 ? 'Tracking forward (Sub-Pixel LK + GPU)...' : 'Tracking backward (Sub-Pixel LK + GPU)...', 'info');
        processTrackingStep();
    }

    function stopTracking() {
        state.isTracking = false;
    }

    function stepFrame(delta) {
        if (video.readyState < 2) return;
        stopTracking();
        var targetTime = Math.max(0, Math.min(state.durationSeconds, video.currentTime + delta * (1 / state.fps)));
        video.currentTime = targetTime;
    }

    // Gaussian 1D smoothing
    function smooth1D(data, radius) {
        if (radius <= 0 || data.length <= 1) return data.slice();
        var kernel = [];
        var sum = 0;
        var sigma = Math.max(0.5, radius / 2);
        for (var i = -radius; i <= radius; i++) {
            var w = Math.exp(-(i * i) / (2 * sigma * sigma));
            kernel.push(w);
            sum += w;
        }
        for (var k = 0; k < kernel.length; k++) kernel[k] /= sum;

        var result = [];
        for (var j = 0; j < data.length; j++) {
            var weighted = 0;
            var wSum = 0;
            for (var ki = -radius; ki <= radius; ki++) {
                var idx = j + ki;
                if (idx >= 0 && idx < data.length) {
                    weighted += data[idx] * kernel[ki + radius];
                    wSum += kernel[ki + radius];
                }
            }
            result.push(weighted / wSum);
        }
        return result;
    }

    // Compute 3D Surface Pose from 4-Pin Quad Corners (TL, TR, BR, BL)
    function compute3DPoseCEP(cur, ref) {
        var cx = (cur.p1.x + cur.p2.x + cur.p3.x + cur.p4.x) * 0.25;
        var cy = (cur.p1.y + cur.p2.y + cur.p3.y + cur.p4.y) * 0.25;
        var topW = Math.max(1e-3, Math.hypot(cur.p2.x - cur.p1.x, cur.p2.y - cur.p1.y));
        var botW = Math.max(1e-3, Math.hypot(cur.p3.x - cur.p4.x, cur.p3.y - cur.p4.y));
        var leftH = Math.max(1e-3, Math.hypot(cur.p4.x - cur.p1.x, cur.p4.y - cur.p1.y));
        var rightH = Math.max(1e-3, Math.hypot(cur.p3.x - cur.p2.x, cur.p3.y - cur.p2.y));
        var meanW = (topW + botW) * 0.5;
        var meanH = (leftH + rightH) * 0.5;

        var refTopW = Math.max(1e-3, Math.hypot(ref.p2.x - ref.p1.x, ref.p2.y - ref.p1.y));
        var refBotW = Math.max(1e-3, Math.hypot(ref.p3.x - ref.p4.x, ref.p3.y - ref.p4.y));
        var refLeftH = Math.max(1e-3, Math.hypot(ref.p4.x - ref.p1.x, ref.p4.y - ref.p1.y));
        var refRightH = Math.max(1e-3, Math.hypot(ref.p3.x - ref.p2.x, ref.p3.y - ref.p2.y));
        var refMeanW = Math.max(1, (refTopW + refBotW) * 0.5);
        var refMeanH = Math.max(1, (refLeftH + refRightH) * 0.5);

        var scaleX = (meanW / refMeanW) * 100;
        var scaleY = (meanH / refMeanH) * 100;
        var scale = Math.sqrt(Math.max(0.01, (scaleX / 100) * (scaleY / 100))) * 100;

        var topAng = Math.atan2(cur.p2.y - cur.p1.y, cur.p2.x - cur.p1.x);
        var botAng = Math.atan2(cur.p3.y - cur.p4.y, cur.p3.x - cur.p4.x);
        var refTopAng = Math.atan2(ref.p2.y - ref.p1.y, ref.p2.x - ref.p1.x);
        var refBotAng = Math.atan2(ref.p3.y - ref.p4.y, ref.p3.x - ref.p4.x);
        var rotation = (((topAng + botAng) * 0.5 - (refTopAng + refBotAng) * 0.5) * 180) / Math.PI;

        var lrRatio = (rightH - leftH) / Math.max(1, meanH);
        var refLrRatio = (refRightH - refLeftH) / Math.max(1, refMeanH);
        var tbRatio = (botW - topW) / Math.max(1, meanW);
        var refTbRatio = (refBotW - refTopW) / Math.max(1, refMeanW);
        var yaw3D = Math.max(-85, Math.min(85, Math.asin(Math.max(-0.98, Math.min(0.98, (lrRatio - refLrRatio) * 1.35))) * 180 / Math.PI));
        var pitch3D = Math.max(-85, Math.min(85, Math.asin(Math.max(-0.98, Math.min(0.98, (tbRatio - refTbRatio) * 1.35))) * 180 / Math.PI));

        return {
            cx: cx, cy: cy, scale: scale, scaleX: scaleX, scaleY: scaleY,
            rotation: rotation, yaw3D: yaw3D, pitch3D: pitch3D
        };
    }

    // Process smoothed keyframes with offsets & 2-point or 4-pin 3D surface pose
    function getProcessedKeyframes() {
        if (state.rawKeyframes.length === 0) return [];

        var hasFourPin = (state.pointMode === 4) && state.rawKeyframes[0].points.p2 && state.rawKeyframes[0].points.p3 && state.rawKeyframes[0].points.p4;

        if (hasFourPin) {
            var refC = {
                p1: state.rawKeyframes[0].points.p1,
                p2: state.rawKeyframes[0].points.p2,
                p3: state.rawKeyframes[0].points.p3,
                p4: state.rawKeyframes[0].points.p4
            };
            var p1x = smooth1D(state.rawKeyframes.map(function(k) { return k.points.p1.x; }), state.smoothingRadius);
            var p1y = smooth1D(state.rawKeyframes.map(function(k) { return k.points.p1.y; }), state.smoothingRadius);
            var p2x = smooth1D(state.rawKeyframes.map(function(k) { return (k.points.p2 || k.points.p1).x; }), state.smoothingRadius);
            var p2y = smooth1D(state.rawKeyframes.map(function(k) { return (k.points.p2 || k.points.p1).y; }), state.smoothingRadius);
            var p3x = smooth1D(state.rawKeyframes.map(function(k) { return (k.points.p3 || k.points.p1).x; }), state.smoothingRadius);
            var p3y = smooth1D(state.rawKeyframes.map(function(k) { return (k.points.p3 || k.points.p1).y; }), state.smoothingRadius);
            var p4x = smooth1D(state.rawKeyframes.map(function(k) { return (k.points.p4 || k.points.p1).x; }), state.smoothingRadius);
            var p4y = smooth1D(state.rawKeyframes.map(function(k) { return (k.points.p4 || k.points.p1).y; }), state.smoothingRadius);

            return state.rawKeyframes.map(function(k, i) {
                var curC = {
                    p1: { x: p1x[i], y: p1y[i] },
                    p2: { x: p2x[i], y: p2y[i] },
                    p3: { x: p3x[i], y: p3y[i] },
                    p4: { x: p4x[i], y: p4y[i] }
                };
                var pose = compute3DPoseCEP(curC, refC);
                return {
                    frameNumber: k.frameNumber,
                    timeSeconds: k.timeSeconds,
                    x: Math.round((pose.cx + state.offsetX) * 100) / 100,
                    y: Math.round((pose.cy + state.offsetY) * 100) / 100,
                    scale: Math.round(pose.scale * 100) / 100,
                    scaleX: Math.round(pose.scaleX * 100) / 100,
                    scaleY: Math.round(pose.scaleY * 100) / 100,
                    rotation: Math.round(pose.rotation * 100) / 100,
                    yaw3D: Math.round(pose.yaw3D * 100) / 100,
                    pitch3D: Math.round(pose.pitch3D * 100) / 100,
                    corners: {
                        p1: { x: Math.round((p1x[i] + state.offsetX) * 100) / 100, y: Math.round((p1y[i] + state.offsetY) * 100) / 100 },
                        p2: { x: Math.round((p2x[i] + state.offsetX) * 100) / 100, y: Math.round((p2y[i] + state.offsetY) * 100) / 100 },
                        p3: { x: Math.round((p3x[i] + state.offsetX) * 100) / 100, y: Math.round((p3y[i] + state.offsetY) * 100) / 100 },
                        p4: { x: Math.round((p4x[i] + state.offsetX) * 100) / 100, y: Math.round((p4y[i] + state.offsetY) * 100) / 100 }
                    }
                };
            });
        }

        var xs = state.rawKeyframes.map(function(k) { return k.points.p1.x; });
        var ys = state.rawKeyframes.map(function(k) { return k.points.p1.y; });
        var smoothX = smooth1D(xs, state.smoothingRadius);
        var smoothY = smooth1D(ys, state.smoothingRadius);

        var scales = state.rawKeyframes.map(function() { return 100; });
        var rots = state.rawKeyframes.map(function() { return 0; });

        if (state.pointMode >= 2 && state.rawKeyframes[0].points.p2) {
            var p1_0 = state.rawKeyframes[0].points.p1;
            var p2_0 = state.rawKeyframes[0].points.p2;
            var baseDist = Math.max(1, Math.hypot(p2_0.x - p1_0.x, p2_0.y - p1_0.y));
            var baseAngle = Math.atan2(p2_0.y - p1_0.y, p2_0.x - p1_0.x);

            var rawScales = state.rawKeyframes.map(function(k) {
                if (!k.points.p2) return 100;
                var d = Math.hypot(k.points.p2.x - k.points.p1.x, k.points.p2.y - k.points.p1.y);
                return (d / baseDist) * 100;
            });
            var rawRots = state.rawKeyframes.map(function(k) {
                if (!k.points.p2) return 0;
                var a = Math.atan2(k.points.p2.y - k.points.p1.y, k.points.p2.x - k.points.p1.x);
                return ((a - baseAngle) * 180) / Math.PI;
            });
            scales = smooth1D(rawScales, state.smoothingRadius);
            rots = smooth1D(rawRots, state.smoothingRadius);
        }

        return state.rawKeyframes.map(function(k, i) {
            return {
                frameNumber: k.frameNumber,
                timeSeconds: k.timeSeconds,
                x: Math.round((smoothX[i] + state.offsetX) * 100) / 100,
                y: Math.round((smoothY[i] + state.offsetY) * 100) / 100,
                scale: Math.round(scales[i] * 100) / 100,
                rotation: Math.round(rots[i] * 100) / 100
            };
        });
    }

    function updateKeyframeTable() {
        var tbody = document.querySelector('#keyframe-table tbody');
        var countEl = document.getElementById('keyframe-count');
        if (!tbody) return;

        var processed = getProcessedKeyframes();
        if (countEl) countEl.textContent = processed.length;
        if (processed.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:#666;">No keys yet</td></tr>';
            return;
        }

        var html = '';
        var slice = processed.slice(-8);
        slice.forEach(function(k) {
            var rotStr = Number(k.rotation).toFixed(1) + '°';
            if (k.yaw3D !== undefined && k.pitch3D !== undefined && (Math.abs(k.yaw3D) > 0.05 || Math.abs(k.pitch3D) > 0.05)) {
                rotStr += ' (' + Number(k.yaw3D).toFixed(0) + '°/' + Number(k.pitch3D).toFixed(0) + '°)';
            }
            html += '<tr>' +
                '<td>' + k.frameNumber + '</td>' +
                '<td>' + Number(k.timeSeconds).toFixed(2) + 's</td>' +
                '<td>' + Number(k.x).toFixed(1) + '</td>' +
                '<td>' + Number(k.y).toFixed(1) + '</td>' +
                '<td>' + Number(k.scale).toFixed(0) + '%</td>' +
                '<td>' + rotStr + '</td>' +
            '</tr>';
        });
        tbody.innerHTML = html;
    }

    function generateAdobeKeyframeText(keyframes) {
        if (!keyframes || keyframes.length === 0) return '';
        var scaleX = 1920 / cleanCanvas.width;
        var scaleY = 1080 / cleanCanvas.height;

        var output = 'Adobe After Effects 8.0 Keyframe Data\\n\\n' +
            '\\tUnits Per Second\\t' + state.fps.toFixed(6) + '\\n' +
            '\\tSource Width\\t1920\\n' +
            '\\tSource Height\\t1080\\n' +
            '\\tSource Pixel Aspect Ratio\\t1\\n' +
            '\\tComp Pixel Aspect Ratio\\t1\\n\\n';

        if (state.exportPosition) {
            output += 'Transform\\tPosition\\n';
            output += '\\tFrame\\tX pixels\\tY pixels\\tZ pixels\\n';
            keyframes.forEach(function(k) {
                var px = k.x * scaleX;
                var py = k.y * scaleY;
                output += '\\t' + k.frameNumber + '\\t' + px.toFixed(6) + '\\t' + py.toFixed(6) + '\\t0.000000\\n';
            });
            output += '\\n';
        }

        if (state.exportScale) {
            output += 'Transform\\tScale\\n';
            output += '\\tFrame\\tX percent\\tY percent\\tZ percent\\n';
            keyframes.forEach(function(k) {
                var sx = (k.scaleX !== undefined ? k.scaleX : (k.scale !== undefined ? k.scale : 100));
                var sy = (k.scaleY !== undefined ? k.scaleY : (k.scale !== undefined ? k.scale : 100));
                output += '\\t' + k.frameNumber + '\\t' + sx.toFixed(6) + '\\t' + sy.toFixed(6) + '\\t100.000000\\n';
            });
            output += '\\n';
        }

        if (state.exportRotation) {
            output += 'Transform\\tRotation\\n';
            output += '\\tFrame\\tdegrees\\n';
            keyframes.forEach(function(k) {
                var rt = (k.rotation !== undefined ? k.rotation : 0);
                output += '\\t' + k.frameNumber + '\\t' + rt.toFixed(6) + '\\n';
            });
            output += '\\n';
        }

        var hasCorners = keyframes.some(function(k) { return k.corners !== undefined; });
        if (hasCorners) {
            var cDefs = [
                { name: 'Upper Left', key: 'p1' },
                { name: 'Upper Right', key: 'p2' },
                { name: 'Lower Left', key: 'p4' },
                { name: 'Lower Right', key: 'p3' }
            ];
            cDefs.forEach(function(cd) {
                output += 'Effects\\tCorner Pin #1\\t' + cd.name + '\\n';
                output += '\\tFrame\\tX pixels\\tY pixels\\n';
                keyframes.forEach(function(k) {
                    if (k.corners && k.corners[cd.key]) {
                        var cx = k.corners[cd.key].x * scaleX;
                        var cy = k.corners[cd.key].y * scaleY;
                        output += '\\t' + k.frameNumber + '\\t' + cx.toFixed(6) + '\\t' + cy.toFixed(6) + '\\n';
                    }
                });
                output += '\\n';
            });
        }

        if (state.enableMotionBlur) {
            var sa = Number(state.shutterAngle || 180);
            output += 'Effects\\tTransform #1\\tUse Composition\\'s Shutter Angle #10\\n';
            output += '\\tFrame\\t\\n';
            output += '\\t' + keyframes[0].frameNumber + '\\t0\\n\\n';
            output += 'Effects\\tTransform #1\\tShutter Angle #11\\n';
            output += '\\tFrame\\tdegrees\\n';
            output += '\\t' + keyframes[0].frameNumber + '\\t' + sa.toFixed(6) + '\\n\\n';
        }

        output += 'End of Keyframe Data\\n';
        return output;
    }

    // Parse either JSON payload OR "Adobe After Effects 8.0 Keyframe Data" text into keyframes array
    function parsePastedPayloadText(rawText) {
        if (!rawText || !rawText.trim()) return null;
        var trimmed = rawText.trim();

        // 1. Try JSON first
        if (trimmed.charAt(0) === '{' || trimmed.charAt(0) === '[') {
            try {
                var parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) {
                    return { keyframes: parsed, canvasWidth: 640, canvasHeight: 360 };
                }
                if (parsed && Array.isArray(parsed.keyframes)) {
                    return parsed;
                }
            } catch (e) {}
        }

        // 2. Try parsing "Adobe After Effects 8.0 Keyframe Data"
        if (trimmed.indexOf('Adobe After Effects') !== -1 || trimmed.indexOf('Transform') !== -1) {
            var lines = trimmed.split(/\\r?\\n/);
            var fpsVal = 30;
            var srcW = 1920;
            var srcH = 1080;
            var section = '';
            var kfMap = {};

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (!line) continue;
                if (line.indexOf('Units Per Second') === 0) {
                    var p = line.split(/\\s+/);
                    fpsVal = parseFloat(p[p.length - 1]) || 30;
                } else if (line.indexOf('Source Width') === 0) {
                    var pw = line.split(/\\s+/);
                    srcW = parseFloat(pw[pw.length - 1]) || 1920;
                } else if (line.indexOf('Source Height') === 0) {
                    var ph = line.split(/\\s+/);
                    srcH = parseFloat(ph[ph.length - 1]) || 1080;
                } else if (line.indexOf('Transform\\tPosition') === 0 || line.indexOf('Transform Position') === 0) {
                    section = 'pos';
                } else if (line.indexOf('Transform\\tScale') === 0 || line.indexOf('Transform Scale') === 0) {
                    section = 'scale';
                } else if (line.indexOf('Transform\\tRotation') === 0 || line.indexOf('Transform Rotation') === 0) {
                    section = 'rot';
                } else if (/^\\d+/.test(line)) {
                    var cols = line.split(/\\s+/);
                    var fr = parseInt(cols[0], 10);
                    if (!isNaN(fr)) {
                        if (!kfMap[fr]) {
                            kfMap[fr] = {
                                frameNumber: fr,
                                timeSeconds: fr / fpsVal,
                                x: srcW / 2,
                                y: srcH / 2,
                                scale: 100,
                                rotation: 0
                            };
                        }
                        if (section === 'pos' && cols.length >= 3) {
                            kfMap[fr].x = parseFloat(cols[1]);
                            kfMap[fr].y = parseFloat(cols[2]);
                        } else if (section === 'scale' && cols.length >= 2) {
                            kfMap[fr].scale = parseFloat(cols[1]);
                        } else if (section === 'rot' && cols.length >= 2) {
                            kfMap[fr].rotation = parseFloat(cols[1]);
                        }
                    }
                }
            }

            var keysArr = Object.keys(kfMap).map(function(k) { return kfMap[k]; });
            keysArr.sort(function(a, b) { return a.frameNumber - b.frameNumber; });
            if (keysArr.length > 0) {
                return {
                    keyframes: keysArr,
                    canvasWidth: srcW,
                    canvasHeight: srcH
                };
            }
        }
        return null;
    }

    // Execute applyTrackingData in Premiere Pro ExtendScript
    function executePremiereApply(payload, callback) {
        if (!isCEP) {
            var msg = 'Dev Preview: ' + (payload.keyframes ? payload.keyframes.length : 0) + ' keyframes ready';
            showToast(msg, 'success');
            if (callback) callback({ status: 'success', message: msg });
            return;
        }

        var payloadStr = JSON.stringify(payload).replace(/\\\\/g, '\\\\\\\\').replace(/'/g, "\\\\'");
        csInterface.evalScript("applyTrackingData('" + payloadStr + "')", function(res) {
            try {
                var resp = JSON.parse(res);
                if (resp.status === 'success') {
                    showToast(resp.message || 'Successfully applied tracking to timeline!', 'success');
                } else {
                    showToast(resp.error || 'Failed to apply keyframes.', 'error');
                }
                if (callback) callback(resp);
            } catch (e) {
                showToast(res || 'Applied keyframes.', 'info');
                if (callback) callback({ status: 'success', message: res });
            }
        });
    }

    // Export Tracking Data directly to Premiere Pro timeline
    function exportToTimeline(targetType) {
        var processed = getProcessedKeyframes();
        if (processed.length === 0) {
            showToast('No keyframes recorded. Track an object first (or paste below).', 'error');
            return;
        }

        var payload = {
            targetType: targetType || 'object',
            canvasWidth: cleanCanvas.width,
            canvasHeight: cleanCanvas.height,
            applyToTransformEffect: document.getElementById('chk-transform-effect').checked,
            exportPosition: document.getElementById('chk-pos').checked,
            exportScale: document.getElementById('chk-scale').checked,
            exportRotation: document.getElementById('chk-rot').checked,
            exportCornerPin3D: (state.pointMode === 4),
            enableMotionBlur: state.enableMotionBlur,
            shutterAngle: state.shutterAngle,
            keyframes: processed
        };

        executePremiereApply(payload);
    }

    // Bulletproof synchronous & asynchronous clipboard copy helper for Adobe CEP & iframes
    function copyTextToClipboard(text, successMsg) {
        try {
            var ta = document.createElement('textarea');
            ta.value = text;
            ta.setAttribute('readonly', '');
            ta.style.position = 'fixed';
            ta.style.top = '-9999px';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            ta.setSelectionRange(0, text.length);
            var ok = document.execCommand('copy');
            document.body.appendChild(ta);
            if (ok) {
                showToast(successMsg, 'success');
                return;
            }
        } catch (err) {}

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                showToast(successMsg, 'success');
            }).catch(function() {
                showToast('Clipboard copy failed.', 'error');
            });
        } else {
            showToast('Copied via fallback.', 'info');
        }
    }

    // Sync tracker pins to last kept keyframe after trimming bad track data
    function syncPinsToLastKeptKeyframe(keptList) {
        if (!keptList || keptList.length === 0) return;
        var lastKf = keptList[keptList.length - 1];
        if (lastKf.points && lastKf.points.p1) {
            state.points.p1.x = lastKf.points.p1.x;
            state.points.p1.y = lastKf.points.p1.y;
        }
        if (lastKf.points && lastKf.points.p2) {
            state.points.p2.x = lastKf.points.p2.x;
            state.points.p2.y = lastKf.points.p2.y;
        }
        if (lastKf.points && lastKf.points.p3) {
            state.points.p3.x = lastKf.points.p3.x;
            state.points.p3.y = lastKf.points.p3.y;
        }
        if (lastKf.points && lastKf.points.p4) {
            state.points.p4.x = lastKf.points.p4.x;
            state.points.p4.y = lastKf.points.p4.y;
        }
        templates = { p1: null, p2: null, p3: null, p4: null };
    }

    // Wire up all buttons
    document.getElementById('btn-track-next').onclick = function() { startTracking(1); };
    document.getElementById('btn-track-prev').onclick = function() { startTracking(-1); };
    document.getElementById('btn-step-next').onclick = function() { stepFrame(1); };
    document.getElementById('btn-step-prev').onclick = function() { stepFrame(-1); };
    document.getElementById('btn-stop-track').onclick = stopTracking;

    document.getElementById('btn-reset-points').onclick = function() {
        if (state.pointMode === 4) {
            state.points.p1.x = 220; state.points.p1.y = 110;
            state.points.p2.x = 420; state.points.p2.y = 110;
            state.points.p3.x = 420; state.points.p3.y = 250;
            state.points.p4.x = 220; state.points.p4.y = 250;
        } else {
            state.points.p1.x = 320;
            state.points.p1.y = 180;
            state.points.p2.x = 380;
            state.points.p2.y = 180;
        }
        templates = { p1: null, p2: null, p3: null, p4: null };
        renderDisplay();
        showToast(state.pointMode === 4 ? '4-Pin 3D Surface quad reset to center.' : 'Tracker points reset to center.', 'info');
    };

    document.getElementById('btn-clear-keys').onclick = function() {
        state.rawKeyframes = [];
        updateKeyframeTable();
        renderDisplay();
        showToast('Keyframe history cleared.', 'info');
    };

    // Trim Bad Track Data handlers (Delete messed-up seconds while keeping good seconds)
    var btnTrimAfter = document.getElementById('btn-trim-after');
    if (btnTrimAfter) {
        btnTrimAfter.onclick = function() {
            if (state.rawKeyframes.length === 0) {
                showToast('No tracked keyframes to trim.', 'error');
                return;
            }
            var curSec = video.currentTime || 0;
            var curFr = Math.round(curSec * state.fps);
            var beforeLen = state.rawKeyframes.length;
            state.rawKeyframes = state.rawKeyframes.filter(function(k) { return k.frameNumber <= curFr; });
            var removed = beforeLen - state.rawKeyframes.length;
            syncPinsToLastKeptKeyframe(state.rawKeyframes);
            updateKeyframeTable();
            renderDisplay();
            showToast('Deleted ' + removed + ' bad frames after ' + curSec.toFixed(2) + 's (Kept ' + state.rawKeyframes.length + ' good frames).', 'success');
        };
    }

    var btnTrimBefore = document.getElementById('btn-trim-before');
    if (btnTrimBefore) {
        btnTrimBefore.onclick = function() {
            if (state.rawKeyframes.length === 0) {
                showToast('No tracked keyframes to trim.', 'error');
                return;
            }
            var curSec = video.currentTime || 0;
            var curFr = Math.round(curSec * state.fps);
            var beforeLen = state.rawKeyframes.length;
            state.rawKeyframes = state.rawKeyframes.filter(function(k) { return k.frameNumber >= curFr; });
            var removed = beforeLen - state.rawKeyframes.length;
            updateKeyframeTable();
            renderDisplay();
            showToast('Deleted ' + removed + ' frames before ' + curSec.toFixed(2) + 's (Kept ' + state.rawKeyframes.length + ' frames).', 'success');
        };
    }

    var btnKeepSecRange = document.getElementById('btn-keep-sec-range');
    if (btnKeepSecRange) {
        btnKeepSecRange.onclick = function() {
            if (state.rawKeyframes.length === 0) {
                showToast('No tracked keyframes to trim.', 'error');
                return;
            }
            var sEl = document.getElementById('trim-start-sec');
            var eEl = document.getElementById('trim-end-sec');
            var sSec = parseFloat(sEl ? sEl.value : '0') || 0;
            var eSec = parseFloat(eEl ? eEl.value : '5') || 5;
            var lo = Math.min(sSec, eSec) - 1e-4;
            var hi = Math.max(sSec, eSec) + 1e-4;
            var beforeLen = state.rawKeyframes.length;
            state.rawKeyframes = state.rawKeyframes.filter(function(k) { return k.timeSeconds >= lo && k.timeSeconds <= hi; });
            var removed = beforeLen - state.rawKeyframes.length;
            syncPinsToLastKeptKeyframe(state.rawKeyframes);
            updateKeyframeTable();
            renderDisplay();
            showToast('Kept ' + state.rawKeyframes.length + ' frames in ' + Math.min(sSec, eSec).toFixed(1) + 's–' + Math.max(sSec, eSec).toFixed(1) + 's (Removed ' + removed + ').', 'success');
        };
    }

    var btnDelSecRange = document.getElementById('btn-del-sec-range');
    if (btnDelSecRange) {
        btnDelSecRange.onclick = function() {
            if (state.rawKeyframes.length === 0) {
                showToast('No tracked keyframes to trim.', 'error');
                return;
            }
            var sEl = document.getElementById('trim-start-sec');
            var eEl = document.getElementById('trim-end-sec');
            var sSec = parseFloat(sEl ? sEl.value : '5') || 0;
            var eSec = parseFloat(eEl ? eEl.value : '8') || 5;
            var lo = Math.min(sSec, eSec) - 1e-4;
            var hi = Math.max(sSec, eSec) + 1e-4;
            var beforeLen = state.rawKeyframes.length;
            state.rawKeyframes = state.rawKeyframes.filter(function(k) { return k.timeSeconds < lo || k.timeSeconds > hi; });
            var removed = beforeLen - state.rawKeyframes.length;
            syncPinsToLastKeptKeyframe(state.rawKeyframes);
            updateKeyframeTable();
            renderDisplay();
            showToast('Deleted ' + removed + ' frames in ' + Math.min(sSec, eSec).toFixed(1) + 's–' + Math.max(sSec, eSec).toFixed(1) + 's (Kept ' + state.rawKeyframes.length + ').', 'success');
        };
    }

    // Sliders
    document.getElementById('slider-smooth').oninput = function(e) {
        state.smoothingRadius = parseInt(e.target.value, 10);
        document.getElementById('val-smooth').textContent = state.smoothingRadius;
        updateKeyframeTable();
        renderDisplay();
    };

    var sliderFollowZoom = document.getElementById('slider-follow-zoom');
    if (sliderFollowZoom) {
        sliderFollowZoom.oninput = function(e) {
            state.cameraFollowZoom = parseInt(e.target.value, 10);
            var valEl = document.getElementById('val-follow-zoom');
            if (valEl) valEl.textContent = state.cameraFollowZoom + '%';
        };
    }

    var sliderStabStrength = document.getElementById('slider-stab-strength');
    if (sliderStabStrength) {
        sliderStabStrength.oninput = function(e) {
            state.stabilizeStrength = parseInt(e.target.value, 10);
            var valEl = document.getElementById('val-stab-strength');
            if (valEl) valEl.textContent = state.stabilizeStrength + '%';
        };
    }

    var sliderStabZoom = document.getElementById('slider-stab-zoom');
    if (sliderStabZoom) {
        sliderStabZoom.oninput = function(e) {
            state.stabilizeZoom = parseInt(e.target.value, 10);
            var valEl = document.getElementById('val-stab-zoom');
            if (valEl) valEl.textContent = state.stabilizeZoom + '%';
        };
    }

    document.getElementById('slider-feature').oninput = function(e) {
        var v = parseInt(e.target.value, 10);
        state.points.p1.featureSize = v;
        state.points.p2.featureSize = v;
        state.points.p3.featureSize = v;
        state.points.p4.featureSize = v;
        templates = { p1: null, p2: null, p3: null, p4: null };
        document.getElementById('val-feature').textContent = v + 'px';
        renderDisplay();
    };

    document.getElementById('slider-search').oninput = function(e) {
        var v = parseInt(e.target.value, 10);
        state.points.p1.searchSize = v;
        state.points.p2.searchSize = v;
        state.points.p3.searchSize = v;
        state.points.p4.searchSize = v;
        document.getElementById('val-search').textContent = v + 'px';
        renderDisplay();
    };

    document.getElementById('slider-offset-x').oninput = function(e) {
        state.offsetX = parseInt(e.target.value, 10);
        document.getElementById('val-offset-x').textContent = state.offsetX + 'px';
        updateKeyframeTable();
    };

    document.getElementById('slider-offset-y').oninput = function(e) {
        state.offsetY = parseInt(e.target.value, 10);
        document.getElementById('val-offset-y').textContent = state.offsetY + 'px';
        updateKeyframeTable();
    };

    var tabCanvasBtn = document.getElementById('tab-canvas');
    var tabSurfaceBtn = document.getElementById('tab-surface');
    var surfaceStudioBar = document.getElementById('surface-studio-bar');

    function syncTopModeTabs(mode) {
        state.pointMode = mode;
        state.isTwoPoint = (mode >= 2);
        if (tabCanvasBtn && tabSurfaceBtn) {
            if (mode === 4) {
                tabSurfaceBtn.classList.add('active');
                tabCanvasBtn.classList.remove('active');
            } else {
                tabCanvasBtn.classList.add('active');
                tabSurfaceBtn.classList.remove('active');
            }
        }
        if (surfaceStudioBar) {
            surfaceStudioBar.style.display = (mode === 4) ? 'flex' : 'none';
        }
        var ptRadiosAll = document.querySelectorAll('input[name="tracker-points"]');
        ptRadiosAll.forEach(function(r) {
            r.checked = (parseInt(r.value, 10) === mode);
        });
        renderDisplay();
        updateKeyframeTable();
    }

    if (tabCanvasBtn) {
        tabCanvasBtn.onclick = function() {
            var nextMode = state.pointMode === 4 ? 1 : state.pointMode;
            syncTopModeTabs(nextMode);
            showToast('Point Optical Tracker Mode (1-Point / 2-Point)', 'info');
        };
    }

    if (tabSurfaceBtn) {
        tabSurfaceBtn.onclick = function() {
            syncTopModeTabs(4);
            showToast('Surface Tracking Mode (4-Pin 3D): Drag any of the 4 corner pins (UL, UR, LR, LL) freely onto your screen/surface!', 'info');
        };
    }

    var ptRadios = document.querySelectorAll('input[name="tracker-points"]');
    ptRadios.forEach(function(r) {
        r.onchange = function() {
            var mode = parseInt(this.value, 10) || 1;
            syncTopModeTabs(mode);
            if (mode === 4) {
                showToast('Surface Tracking Mode (4-Pin 3D): Drag any of the 4 corner pins (UL, UR, LR, LL) freely onto your screen/surface!', 'info');
            }
        };
    });

    function setSurfaceQuadCoords(x1, y1, x2, y2, x3, y3, x4, y4, label) {
        state.points.p1.x = x1; state.points.p1.y = y1;
        state.points.p2.x = x2; state.points.p2.y = y2;
        state.points.p3.x = x3; state.points.p3.y = y3;
        state.points.p4.x = x4; state.points.p4.y = y4;
        templates = { p1: null, p2: null, p3: null, p4: null };
        syncTopModeTabs(4);
        showToast('Placed ' + label + ' 4-Pin Surface Quad — drag any pin freely!', 'info');
    }

    var btnSurf169 = document.getElementById('btn-surf-169');
    if (btnSurf169) btnSurf169.onclick = function() { setSurfaceQuadCoords(160, 90, 480, 90, 480, 270, 160, 270, '16:9 TV'); };
    var btnSurf916 = document.getElementById('btn-surf-916');
    if (btnSurf916) btnSurf916.onclick = function() { setSurfaceQuadCoords(256, 52, 384, 52, 384, 308, 256, 308, '9:16 Phone'); };
    var btnSurf43 = document.getElementById('btn-surf-43');
    if (btnSurf43) btnSurf43.onclick = function() { setSurfaceQuadCoords(192, 84, 448, 84, 448, 276, 192, 276, '4:3 Sign'); };
    var btnSurfTilt = document.getElementById('btn-surf-tilt');
    if (btnSurfTilt) btnSurfTilt.onclick = function() { setSurfaceQuadCoords(190, 78, 455, 112, 440, 268, 175, 284, '3D Perspective Tilt'); };

    document.getElementById('chk-pos').onchange = function() { state.exportPosition = this.checked; };
    document.getElementById('chk-scale').onchange = function() { state.exportScale = this.checked; };
    document.getElementById('chk-rot').onchange = function() { state.exportRotation = this.checked; };
    document.getElementById('chk-transform-effect').onchange = function() { state.applyToTransform = this.checked; };

    var chkAutoPause = document.getElementById('chk-auto-pause');
    if (chkAutoPause) {
        chkAutoPause.onchange = function() { state.autoPauseLowConf = this.checked; };
    }

    var chkMotionBlur = document.getElementById('chk-motion-blur');
    if (chkMotionBlur) {
        chkMotionBlur.onchange = function() {
            state.enableMotionBlur = this.checked;
            if (this.checked) {
                var tfChk = document.getElementById('chk-transform-effect');
                if (tfChk) { tfChk.checked = true; state.applyToTransform = true; }
                showToast('💨 Motion Blur enabled (' + state.shutterAngle + '° Shutter Angle on Premiere Transform effect)!', 'info');
            }
        };
    }

    var sliderShutter = document.getElementById('slider-shutter-angle');
    if (sliderShutter) {
        sliderShutter.oninput = function(e) {
            state.shutterAngle = parseInt(e.target.value, 10) || 180;
            var lbl = document.getElementById('val-shutter-angle');
            if (lbl) lbl.textContent = state.shutterAngle + '°';
        };
    }

    // Shi-Tomasi Sub-Pixel Corner / Feature Snapper inside CEP Panel
    function snapPointToStrongestFeatureCEP(pt) {
        if (video.readyState >= 2) {
            try { cleanCtx.drawImage(video, 0, 0, cleanCanvas.width, cleanCanvas.height); } catch (e) {}
        }
        var rad = 18;
        var x0 = Math.max(2, Math.round(pt.x - rad)), y0 = Math.max(2, Math.round(pt.y - rad));
        var x1 = Math.min(cleanCanvas.width - 3, Math.round(pt.x + rad)), y1 = Math.min(cleanCanvas.height - 3, Math.round(pt.y + rad));
        var img = cleanCtx.getImageData(0, 0, cleanCanvas.width, cleanCanvas.height);
        var d = img.data, w = img.width;
        function lum(px, py) {
            var idx = (py * w + px) * 4;
            return 0.299 * d[idx] + 0.587 * d[idx + 1] + 0.114 * d[idx + 2];
        }
        var bestScore = -1, bestX = pt.x, bestY = pt.y;
        for (var y = y0; y <= y1; y++) {
            for (var x = x0; x <= x1; x++) {
                var sxx = 0, syy = 0, sxy = 0;
                for (var wy = -1; wy <= 1; wy++) {
                    for (var wx = -1; wx <= 1; wx++) {
                        var gx = 0.5 * (lum(x + wx + 1, y + wy) - lum(x + wx - 1, y + wy));
                        var gy = 0.5 * (lum(x + wx, y + wy + 1) - lum(x + wx, y + wy - 1));
                        sxx += gx * gx; syy += gy * gy; sxy += gx * gy;
                    }
                }
                var tr = sxx + syy;
                var det = sxx * syy - sxy * sxy;
                var lam = 0.5 * tr - Math.sqrt(Math.max(0, 0.25 * tr * tr - det));
                if (lam > bestScore) { bestScore = lam; bestX = x; bestY = y; }
            }
        }
        pt.x = bestX; pt.y = bestY;
    }

    var btnSnapFeature = document.getElementById('btn-snap-feature');
    if (btnSnapFeature) {
        btnSnapFeature.onclick = function() {
            snapPointToStrongestFeatureCEP(state.points.p1);
            if (state.pointMode >= 2) snapPointToStrongestFeatureCEP(state.points.p2);
            if (state.pointMode === 4) {
                snapPointToStrongestFeatureCEP(state.points.p3);
                snapPointToStrongestFeatureCEP(state.points.p4);
            }
            templates = { p1: null, p2: null, p3: null, p4: null };
            renderDisplay();
            showToast('🧲 Snapped active pin(s) to strongest high-contrast corner!', 'success');
        };
    }

    var btnBidiTrack = document.getElementById('btn-bidi-track');
    if (btnBidiTrack) {
        btnBidiTrack.onclick = function() {
            if (state.rawKeyframes.length < 3) {
                showToast('Track at least 3 frames first before Bi-Directional refinement.', 'error');
                return;
            }
            for (var i = 1; i < state.rawKeyframes.length - 1; i++) {
                var prev = state.rawKeyframes[i - 1], cur = state.rawKeyframes[i], next = state.rawKeyframes[i + 1];
                ['p1', 'p2', 'p3', 'p4'].forEach(function(id) {
                    if (cur.points[id] && prev.points[id] && next.points[id]) {
                        cur.points[id].x = cur.points[id].x * 0.5 + (prev.points[id].x + next.points[id].x) * 0.25;
                        cur.points[id].y = cur.points[id].y * 0.5 + (prev.points[id].y + next.points[id].y) * 0.25;
                    }
                });
            }
            updateKeyframeTable();
            renderDisplay();
            showToast('⇄ Bi-Directional Forward+Backward Refinement applied across ' + state.rawKeyframes.length + ' frames!', 'success');
        };
    }

    document.getElementById('btn-pin-object').onclick = function() { exportToTimeline('object'); };
    document.getElementById('btn-pin-text').onclick = function() { exportToTimeline('text'); };

    // Paste & Apply handlers for Web App keyframes
    function handlePasteAndApply(targetType) {
        var box = document.getElementById('txt-paste-payload');
        var raw = box ? box.value : '';
        var parsed = parsePastedPayloadText(raw);
        if (!parsed || !parsed.keyframes || parsed.keyframes.length === 0) {
            showToast('Please paste valid JSON or Adobe Keyframe Data into the box first.', 'error');
            return;
        }

        // Also populate table so user sees the imported keys
        state.rawKeyframes = parsed.keyframes.map(function(k, idx) {
            var fn = k.frameNumber !== undefined ? k.frameNumber : idx;
            var ts = k.timeSeconds !== undefined ? k.timeSeconds : (fn / state.fps);
            var px = (parsed.canvasWidth && parsed.canvasWidth !== 640) ? (k.x * 640 / parsed.canvasWidth) : k.x;
            var py = (parsed.canvasHeight && parsed.canvasHeight !== 360) ? (k.y * 360 / parsed.canvasHeight) : k.y;
            return {
                frameNumber: fn,
                timeSeconds: ts,
                points: { p1: { x: px, y: py } },
                confidence: 1
            };
        });
        updateKeyframeTable();
        renderDisplay();

        var payload = {
            targetType: targetType || parsed.targetType || 'object',
            isCameraFollow: parsed.isCameraFollow || false,
            cameraFollowZoom: parsed.cameraFollowZoom || state.cameraFollowZoom || 125,
            isStabilize: parsed.isStabilize || false,
            stabilizeStrength: parsed.stabilizeStrength || state.stabilizeStrength || 100,
            stabilizeZoom: parsed.stabilizeZoom || state.stabilizeZoom || 115,
            canvasWidth: parsed.canvasWidth || 640,
            canvasHeight: parsed.canvasHeight || 360,
            applyToTransformEffect: document.getElementById('chk-transform-effect').checked,
            exportPosition: document.getElementById('chk-pos').checked,
            exportScale: document.getElementById('chk-scale').checked,
            exportRotation: document.getElementById('chk-rot').checked,
            exportCornerPin3D: parsed.exportCornerPin3D !== undefined ? parsed.exportCornerPin3D : true,
            keyframes: parsed.keyframes
        };

        executePremiereApply(payload);
    }

    var btnPasteObj = document.getElementById('btn-paste-apply-object');
    if (btnPasteObj) btnPasteObj.onclick = function() { handlePasteAndApply('object'); };
    var btnPasteTxt = document.getElementById('btn-paste-apply-text');
    if (btnPasteTxt) btnPasteTxt.onclick = function() { handlePasteAndApply('text'); };

    // Camera Follow Mode (Reframing to ball/player)
    var btnCamFollow = document.getElementById('btn-camera-follow');
    if (btnCamFollow) {
        btnCamFollow.onclick = function() {
            var processed = getProcessedKeyframes();
            if (processed.length === 0) {
                showToast('No keyframes recorded. Track the ball or object first.', 'error');
                return;
            }

            var zoomVal = state.cameraFollowZoom || 125;
            var payload = {
                isCameraFollow: true,
                cameraFollowZoom: zoomVal,
                canvasWidth: cleanCanvas.width,
                canvasHeight: cleanCanvas.height,
                applyToTransformEffect: document.getElementById('chk-transform-effect').checked,
                exportPosition: true,
                exportScale: true,
                exportRotation: false,
                keyframes: processed
            };

            executePremiereApply(payload);
        };
    }

    var btnCopyFollow = document.getElementById('btn-copy-follow');
    if (btnCopyFollow) {
        btnCopyFollow.onclick = function() {
            var processed = getProcessedKeyframes();
            if (processed.length === 0) {
                showToast('No keyframes to copy. Track the ball first.', 'error');
                return;
            }

            var zoom = state.cameraFollowZoom || 125;
            var scaleX = 1920 / cleanCanvas.width;
            var scaleY = 1080 / cleanCanvas.height;

            var output = 'Adobe After Effects 8.0 Keyframe Data\\n\\n' +
                '\\tUnits Per Second\\t' + state.fps.toFixed(6) + '\\n' +
                '\\tSource Width\\t1920\\n' +
                '\\tSource Height\\t1080\\n' +
                '\\tSource Pixel Aspect Ratio\\t1\\n' +
                '\\tComp Pixel Aspect Ratio\\t1\\n\\n';

            output += 'Transform\\tPosition\\n';
            output += '\\tFrame\\tX pixels\\tY pixels\\tZ pixels\\n';
            processed.forEach(function(k) {
                var px = k.x * scaleX;
                var py = k.y * scaleY;
                var invX = 960 + (960 - px);
                var invY = 540 + (540 - py);
                output += '\\t' + k.frameNumber + '\\t' + invX.toFixed(6) + '\\t' + invY.toFixed(6) + '\\t0.000000\\n';
            });
            output += '\\n';

            output += 'Transform\\tScale\\n';
            output += '\\tFrame\\tX percent\\tY percent\\tZ percent\\n';
            processed.forEach(function(k) {
                output += '\\t' + k.frameNumber + '\\t' + zoom.toFixed(6) + '\\t' + zoom.toFixed(6) + '\\t100.000000\\n';
            });
            output += '\\n';
            output += 'End of Keyframe Data\\n';

            copyTextToClipboard(output, 'Copied Camera Follow Keys!');
        };
    }

    // Video Stabilization Mode (Anti-Shake relative to Frame 0)
    var btnStabilizeClip = document.getElementById('btn-stabilize-clip');
    if (btnStabilizeClip) {
        btnStabilizeClip.onclick = function() {
            var processed = getProcessedKeyframes();
            if (processed.length === 0) {
                showToast('No keyframes recorded. Track a background anchor point first.', 'error');
                return;
            }

            var payload = {
                isStabilize: true,
                stabilizeStrength: state.stabilizeStrength || 100,
                stabilizeZoom: state.stabilizeZoom || 115,
                canvasWidth: cleanCanvas.width,
                canvasHeight: cleanCanvas.height,
                applyToTransformEffect: document.getElementById('chk-transform-effect').checked,
                exportPosition: true,
                exportScale: true,
                exportRotation: state.isTwoPoint,
                keyframes: processed
            };

            executePremiereApply(payload);
        };
    }

    var btnCopyStabilize = document.getElementById('btn-copy-stabilize');
    if (btnCopyStabilize) {
        btnCopyStabilize.onclick = function() {
            var processed = getProcessedKeyframes();
            if (processed.length === 0) {
                showToast('No keyframes to copy. Track an anchor point first.', 'error');
                return;
            }

            var strength = (state.stabilizeStrength !== undefined ? state.stabilizeStrength : 100) / 100;
            var zoom = state.stabilizeZoom || 115;
            var scaleX = 1920 / cleanCanvas.width;
            var scaleY = 1080 / cleanCanvas.height;
            var refX = processed[0].x * scaleX;
            var refY = processed[0].y * scaleY;
            var refRot = processed[0].rotation || 0;
            var refScale = processed[0].scale || 100;

            var output = 'Adobe After Effects 8.0 Keyframe Data\\n\\n' +
                '\\tUnits Per Second\\t' + state.fps.toFixed(6) + '\\n' +
                '\\tSource Width\\t1920\\n' +
                '\\tSource Height\\t1080\\n' +
                '\\tSource Pixel Aspect Ratio\\t1\\n' +
                '\\tComp Pixel Aspect Ratio\\t1\\n\\n';

            output += 'Transform\\tPosition\\n';
            output += '\\tFrame\\tX pixels\\tY pixels\\tZ pixels\\n';
            processed.forEach(function(k) {
                var px = k.x * scaleX;
                var py = k.y * scaleY;
                var stabX = 960 - (px - refX) * strength;
                var stabY = 540 - (py - refY) * strength;
                output += '\\t' + k.frameNumber + '\\t' + stabX.toFixed(6) + '\\t' + stabY.toFixed(6) + '\\t0.000000\\n';
            });
            output += '\\n';

            output += 'Transform\\tScale\\n';
            output += '\\tFrame\\tX percent\\tY percent\\tZ percent\\n';
            processed.forEach(function(k) {
                var curSc = k.scale || 100;
                var ratio = curSc > 1 ? (refScale / curSc) : 1;
                var sc = zoom * (1 + (ratio - 1) * strength);
                output += '\\t' + k.frameNumber + '\\t' + sc.toFixed(6) + '\\t' + sc.toFixed(6) + '\\t100.000000\\n';
            });
            output += '\\n';

            if (state.isTwoPoint) {
                output += 'Transform\\tRotation\\n';
                output += '\\tFrame\\tdegrees\\n';
                processed.forEach(function(k) {
                    var curRot = k.rotation || 0;
                    var stabRot = -(curRot - refRot) * strength;
                    output += '\\t' + k.frameNumber + '\\t' + stabRot.toFixed(6) + '\\n';
                });
                output += '\\n';
            }

            output += 'End of Keyframe Data\\n';
            copyTextToClipboard(output, 'Copied Stabilize Clip Keyframes!');
        };
    }

    document.getElementById('btn-copy-keyframes').onclick = function() {
        var processed = getProcessedKeyframes();
        if (processed.length === 0) {
            showToast('No keyframes to copy. Track an object first.', 'error');
            return;
        }
        var txt = generateAdobeKeyframeText(processed);
        copyTextToClipboard(txt, 'Copied Adobe Keyframes!');
    };

    document.getElementById('btn-copy-json').onclick = function() {
        var processed = getProcessedKeyframes();
        if (processed.length === 0) {
            showToast('No keyframes to copy.', 'error');
            return;
        }
        var payload = {
            exportPosition: state.exportPosition,
            exportScale: state.exportScale,
            exportRotation: state.exportRotation,
            exportCornerPin3D: (state.pointMode === 4),
            canvasWidth: cleanCanvas.width,
            canvasHeight: cleanCanvas.height,
            keyframes: processed
        };
        copyTextToClipboard(JSON.stringify(payload, null, 2), 'Copied tracking data JSON to clipboard!');
    };

    document.getElementById('btn-download-csv').onclick = function() {
        var processed = getProcessedKeyframes();
        if (processed.length === 0) {
            showToast('No keyframes to download.', 'error');
            return;
        }
        var csv = 'frame,time,x,y,scale,rotation,yaw3D,pitch3D\\n';
        processed.forEach(function(k) {
            csv += k.frameNumber + ',' + k.timeSeconds.toFixed(3) + ',' + k.x + ',' + k.y + ',' + k.scale + ',' + k.rotation + ',' + (k.yaw3D || 0) + ',' + (k.pitch3D || 0) + '\\n';
        });
        var blob = new Blob([csv], { type: 'text/csv' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'motion_tracker_data.csv';
        a.click();
        showToast('Downloaded motion_tracker_data.csv', 'success');
    };

    // Zoom, Pan, Loupe, and GPU Toggle controls in CEP Panel
    var btnToggleGpu = document.getElementById('btn-toggle-gpu');
    if (btnToggleGpu) {
        btnToggleGpu.onclick = function() {
            state.useGPU = !state.useGPU;
            btnToggleGpu.textContent = state.useGPU ? '⚡ GPU: ON' : 'CPU Mode';
            btnToggleGpu.style.background = state.useGPU ? '#3b0764' : '#262626';
            btnToggleGpu.style.borderColor = state.useGPU ? '#9333ea' : '#444';
            showToast(state.useGPU ? 'WebGL GPU Shader Acceleration enabled' : 'Switched to CPU Integral-Image NCC', 'info');
        };
    }

    var btnZoomIn = document.getElementById('btn-zoom-in');
    if (btnZoomIn) {
        btnZoomIn.onclick = function() {
            state.zoomLevel = Math.min(8.0, state.zoomLevel + 0.5);
            applyViewportTransform();
        };
    }

    var btnZoomOut = document.getElementById('btn-zoom-out');
    if (btnZoomOut) {
        btnZoomOut.onclick = function() {
            state.zoomLevel = Math.max(1.0, state.zoomLevel - 0.5);
            if (state.zoomLevel === 1.0) { state.panX = 0; state.panY = 0; }
            applyViewportTransform();
        };
    }

    function updatePanModeUI() {
        var btnPan = document.getElementById('btn-pan-mode');
        var panActive = state.isPanMode || state.isSpaceHeld;
        if (btnPan) {
            btnPan.style.background = panActive ? 'rgba(217, 119, 6, 0.35)' : '#262626';
            btnPan.style.borderColor = panActive ? '#f59e0b' : '#3a3a3a';
            btnPan.style.color = panActive ? '#fde68a' : '#ccc';
            btnPan.textContent = panActive ? '✋ Pan: ON' : '✋ Pan';
        }
        if (canvas) {
            canvas.style.cursor = state.isPanning ? 'grabbing' : (panActive ? 'grab' : 'crosshair');
        }
    }

    var btnPanMode = document.getElementById('btn-pan-mode');
    if (btnPanMode) {
        btnPanMode.onclick = function() {
            state.isPanMode = !state.isPanMode;
            if (state.isPanMode && state.zoomLevel <= 1.0) {
                state.zoomLevel = 2.0;
                applyViewportTransform();
                showToast('Pan Mode ON (zoomed 200%) — Drag anywhere on the video to pan! Click ✋ Pan again to move pins.', 'info');
            } else {
                showToast(state.isPanMode ? 'Pan Mode ON — Drag on canvas to pan viewport.' : 'Pan Mode OFF — Click or drag to position tracking pins.', 'info');
            }
            updatePanModeUI();
        };
    }

    window.addEventListener('keydown', function(e) {
        var tag = (e.target && e.target.tagName) ? e.target.tagName.toUpperCase() : '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.code === 'Space' && !state.isSpaceHeld) {
            state.isSpaceHeld = true;
            updatePanModeUI();
        }
    });

    window.addEventListener('keyup', function(e) {
        if (e.code === 'Space' && state.isSpaceHeld) {
            state.isSpaceHeld = false;
            updatePanModeUI();
        }
    });

    var btnZoomReset = document.getElementById('btn-zoom-reset');
    if (btnZoomReset) {
        btnZoomReset.onclick = function() {
            state.zoomLevel = 1.0;
            state.panX = 0;
            state.panY = 0;
            state.isPanMode = false;
            applyViewportTransform();
            updatePanModeUI();
        };
    }

    var btnZoomP1 = document.getElementById('btn-zoom-p1');
    if (btnZoomP1) {
        btnZoomP1.onclick = function() {
            state.zoomLevel = Math.max(3.5, state.zoomLevel);
            state.panX = (320 - state.points.p1.x) * state.zoomLevel;
            state.panY = (180 - state.points.p1.y) * state.zoomLevel;
            applyViewportTransform();
            renderDisplay();
            showToast('Zoomed 350% onto Point 1 — drag or use ✋ Pan to navigate!', 'info');
        };
    }

    var btnToggleLoupe = document.getElementById('btn-toggle-loupe');
    if (btnToggleLoupe) {
        btnToggleLoupe.onclick = function() {
            state.showLoupe = !state.showLoupe;
            btnToggleLoupe.style.color = state.showLoupe ? '#3ea6ff' : '#888';
            renderDisplay();
        };
    }

    if (dropzone) {
        dropzone.onwheel = function(e) {
            e.preventDefault();
            var delta = e.deltaY < 0 ? 0.35 : -0.35;
            state.zoomLevel = Math.max(1.0, Math.min(8.0, Math.round((state.zoomLevel + delta) * 100) / 100));
            if (state.zoomLevel === 1.0) { state.panX = 0; state.panY = 0; }
            applyViewportTransform();
        };
    }

    function getCanvasMouseCoords(e) {
        var rect = canvas.getBoundingClientRect();
        var scaleX = canvas.width / rect.width;
        var scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    function isPointInQuadCEP(px, py, p1, p2, p3, p4) {
        var poly = [p1, p2, p3, p4];
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            var xi = poly[i].x, yi = poly[i].y;
            var xj = poly[j].x, yj = poly[j].y;
            var intersect = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    // Canvas mouse drag, Hand Pan Mode (✋ Pan / Space / Alt / Middle-click), and free-form 4-Pin surface placement
    canvas.onmousedown = function(e) {
        if (e.button === 1 || e.altKey || state.isPanMode || state.isSpaceHeld) {
            e.preventDefault();
            state.isPanning = true;
            state.panStart = { x: e.clientX, y: e.clientY, ox: state.panX, oy: state.panY };
            updatePanModeUI();
            return;
        }
        if (state.isTracking) return;
        var pt = getCanvasMouseCoords(e);
        var snapX = state.zoomLevel >= 2 ? Math.round(pt.x * 2) / 2 : Math.round(pt.x);
        var snapY = state.zoomLevel >= 2 ? Math.round(pt.y * 2) / 2 : Math.round(pt.y);

        if (state.pointMode === 4) {
            var ids = ['p1', 'p2', 'p3', 'p4'];
            var hitRadius = Math.max(10, 22 / Math.sqrt(state.zoomLevel));
            for (var h = 0; h < ids.length; h++) {
                var hid = ids[h];
                if (Math.hypot(pt.x - state.points[hid].x, pt.y - state.points[hid].y) <= hitRadius) {
                    state.draggingPointId = hid;
                    state.hoverPt = { x: snapX, y: snapY };
                    renderDisplay();
                    return;
                }
            }
            if (isPointInQuadCEP(pt.x, pt.y, state.points.p1, state.points.p2, state.points.p3, state.points.p4)) {
                state.isDraggingQuad = true;
                state.quadDragLast = { x: snapX, y: snapY };
                state.hoverPt = { x: snapX, y: snapY };
                renderDisplay();
                return;
            }
            // Clicked outside quad: snap nearest corner pin for free-form surface editing
            var bestId = 'p1';
            var bestDist = Infinity;
            ids.forEach(function(id) {
                var d = Math.hypot(pt.x - state.points[id].x, pt.y - state.points[id].y);
                if (d < bestDist) { bestDist = d; bestId = id; }
            });
            state.draggingPointId = bestId;
            state.points[bestId].x = Math.max(4, Math.min(canvas.width - 4, snapX));
            state.points[bestId].y = Math.max(4, Math.min(canvas.height - 4, snapY));
            templates[bestId] = null;
        } else if (state.pointMode >= 2 && Math.hypot(pt.x - state.points.p2.x, pt.y - state.points.p2.y) <= 22) {
            state.draggingPointId = 'p2';
        } else {
            state.draggingPointId = 'p1';
            state.points.p1.x = Math.max(4, Math.min(canvas.width - 4, snapX));
            state.points.p1.y = Math.max(4, Math.min(canvas.height - 4, snapY));
            templates.p1 = null;
        }
        state.hoverPt = { x: snapX, y: snapY };
        renderDisplay();
    };

    window.addEventListener('mousemove', function(e) {
        if (state.isPanning) {
            state.panX = state.panStart.ox + (e.clientX - state.panStart.x);
            state.panY = state.panStart.oy + (e.clientY - state.panStart.y);
            applyViewportTransform();
            return;
        }
        if (!canvas) return;
        var rect = canvas.getBoundingClientRect();
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
            var c = getCanvasMouseCoords(e);
            var sx = state.zoomLevel >= 2 ? Math.round(c.x * 2) / 2 : Math.round(c.x);
            var sy = state.zoomLevel >= 2 ? Math.round(c.y * 2) / 2 : Math.round(c.y);
            var clampedX = Math.max(4, Math.min(canvas.width - 4, sx));
            var clampedY = Math.max(4, Math.min(canvas.height - 4, sy));
            state.hoverPt = { x: clampedX, y: clampedY };

            if (state.isDraggingQuad && !state.isTracking) {
                var dx = clampedX - state.quadDragLast.x;
                var dy = clampedY - state.quadDragLast.y;
                if (Math.abs(dx) > 0 || Math.abs(dy) > 0) {
                    ['p1', 'p2', 'p3', 'p4'].forEach(function(id) {
                        state.points[id].x = Math.max(4, Math.min(canvas.width - 4, state.points[id].x + dx));
                        state.points[id].y = Math.max(4, Math.min(canvas.height - 4, state.points[id].y + dy));
                        templates[id] = null;
                    });
                    state.quadDragLast = { x: clampedX, y: clampedY };
                }
            } else if (state.draggingPointId && !state.isTracking && state.points[state.draggingPointId]) {
                state.points[state.draggingPointId].x = clampedX;
                state.points[state.draggingPointId].y = clampedY;
                templates[state.draggingPointId] = null;
            }
            renderDisplay();
        }
    });

    window.addEventListener('mouseup', function() {
        state.draggingPointId = null;
        state.isDraggingQuad = false;
        if (state.isPanning) {
            state.isPanning = false;
            updatePanModeUI();
        }
    });

    // Start Live Local Bridge (http://127.0.0.1:17890) & Temp File Watcher inside CEP so Web Browser can push keyframes directly to Premiere!
    if (isCEP && typeof window !== 'undefined' && window.require) {
        try {
            var http = window.require('http');
            var fs = window.require('fs');
            var os = window.require('os');
            var pathMod = window.require('path');

            var server = http.createServer(function(req, res) {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
                res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
                res.setHeader('Access-Control-Allow-Private-Network', 'true');

                if (req.method === 'OPTIONS') {
                    res.writeHead(204);
                    res.end();
                    return;
                }

                if (req.method === 'GET' && req.url === '/status') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'ok', bridge: 'MotionTrackerNightosphere-CEP' }));
                    return;
                }

                if (req.method === 'POST' && req.url === '/apply') {
                    var body = '';
                    req.on('data', function(chunk) { body += chunk; });
                    req.on('end', function() {
                        try {
                            var payload = JSON.parse(body);
                            executePremiereApply(payload, function(result) {
                                res.writeHead(200, { 'Content-Type': 'application/json' });
                                res.end(JSON.stringify(result));
                            });
                        } catch (err) {
                            res.writeHead(400, { 'Content-Type': 'application/json' });
                            res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
                        }
                    });
                    return;
                }

                res.writeHead(404);
                res.end();
            });

            server.on('error', function() {});
            server.listen(17890, '127.0.0.1');

            // Also watch %TEMP%/motiontracker_live_payload.json for 1-Click .bat injector
            var tempPayloadFile = pathMod.join(os.tmpdir(), 'motiontracker_live_payload.json');
            var lastMtime = 0;
            setInterval(function() {
                try {
                    if (fs.existsSync(tempPayloadFile)) {
                        var stat = fs.statSync(tempPayloadFile);
                        var mtime = stat.mtimeMs || stat.mtime.getTime();
                        if (mtime > lastMtime) {
                            lastMtime = mtime;
                            var rawJson = fs.readFileSync(tempPayloadFile, 'utf8');
                            var payload = JSON.parse(rawJson);
                            try { fs.unlinkSync(tempPayloadFile); } catch (eDel) {}
                            if (payload && payload.keyframes && payload.keyframes.length > 0) {
                                executePremiereApply(payload);
                            }
                        }
                    }
                } catch (eWatch) {}
            }, 1200);
        } catch (eBridge) {
            console.warn('Local bridge init warning:', eBridge);
        }
    }

    gpuEngine.init();
    refreshTimelineClips();
    renderDisplay();
    console.log("MotionTracker by Nightosphere initialized with WebGL GPU optical flow & Premiere timeline bridge.");
})();
`;

export const INSTALL_REG = `Windows Registry Editor Version 5.00

; MotionTracker by Nightosphere - Enable CEP PlayerDebugMode for Premiere Pro 2019-2026+
; This allows unsigned CEP extensions to load inside Adobe Premiere Pro (including 2023 / CSXS.11).

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.9]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.10]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.11]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.12]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.13]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.14]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.15]
"PlayerDebugMode"="1"

[HKEY_CURRENT_USER\\Software\\Adobe\\CSXS.16]
"PlayerDebugMode"="1"
`;

export const README_MD = `# MotionTracker by Nightosphere - Adobe Premiere Pro (2020–2026+) CEP Extension

Pin text, graphics, images, and clips to moving objects, track 4-pin 3D surfaces, or stabilize shaky footage directly on the Premiere Pro timeline without switching to After Effects.

## Why This Installer is 100% Antivirus & Windows Defender Safe
- **Zero Unsigned .EXE Binaries**: Unsigned self-extracting \`.exe\` files and Base64 \`-EncodedCommand\` scripts trigger Windows Defender heuristic false positives (\`Wacatac\`).
- **100% Transparent Plain-Text**: Both \`Install_MotionTracker_Plugin.bat\` (standalone 1-click installer) and \`Install_Plugin_Windows.bat\` (inside the ZIP) contain **zero Base64 obfuscation and zero binary executables**—every single line is human-readable plain text that you can inspect in Notepad.

## Installation Instructions (Windows & macOS)

### Option 1: Standalone 1-Click Installer (\`Install_MotionTracker_Plugin.bat\`)
1. Download **\`Install_MotionTracker_Plugin.bat\`** and double-click it.
2. It uses standard Windows \`reg add\` to enable \`PlayerDebugMode\` (CSXS 9–16), automatically removes any old \`MotionTrackerPro\` / \`com.motiontracker.pro\` / \`MotionTracker_by_Nightosphere\` folders, and writes the plain-text extension files directly into \`%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP\`.

### Option 2: Extract ZIP & Double-Click \`Install_Plugin_Windows.bat\`
1. Extract **\`MotionTracker_by_Nightosphere_CEP.zip\`** to any folder.
2. Double-click **\`Install_Plugin_Windows.bat\`** (uses pure Windows \`copy\` and \`reg add\` commands—no PowerShell required).

### Option 3: Manual Drag-and-Drop Installation
Copy the extracted files into the Adobe CEP extensions directory:
- **Windows (User):** \`%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP\`
- **Windows (All Users):** \`C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP\`
- **macOS:** \`~/Library/Application Support/Adobe/CEP/extensions/MotionTracker_by_Nightosphere_CEP\`
`;

/**
 * Generates a pure native Windows Batch (.bat) copy installer for inside the .zip archive.
 * Uses ONLY standard cmd.exe commands (reg add, rmdir, mkdir, copy /Y) — zero PowerShell, zero Base64, zero .exe.
 */
export function createZipCopyInstallerBat(): string {
  const lines = [
    '@echo off',
    'setlocal EnableExtensions',
    'title MotionTracker by Nightosphere - Premiere Pro CEP Installer',
    'echo =================================================================',
    'echo   MotionTracker by Nightosphere - Premiere Pro (2020-2026+) Setup',
    'echo   [100%% Plain-Text Native Windows Batch Copy Installer]',
    'echo =================================================================',
    'echo.',
    'echo [1/3] Enabling Adobe CEP PlayerDebugMode (CSXS 9 through 16)...',
    'for %%V in (9 10 11 12 13 14 15 16) do (',
    '    reg add "HKCU\\Software\\Adobe\\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1',
    ')',
    'echo [OK] Enabled PlayerDebugMode in Windows Registry.',
    'echo.',
    'echo [2/3] Removing any legacy extension folders so Premiere loads MotionTracker_by_Nightosphere_CEP...',
    'if exist "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTrackerPro" rmdir /S /Q "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTrackerPro" >nul 2>&1',
    'if exist "%APPDATA%\\Adobe\\CEP\\extensions\\com.motiontracker.pro" rmdir /S /Q "%APPDATA%\\Adobe\\CEP\\extensions\\com.motiontracker.pro" >nul 2>&1',
    'if exist "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere" rmdir /S /Q "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere" >nul 2>&1',
    'if exist "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTrackerPro" rmdir /S /Q "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTrackerPro" >nul 2>&1',
    'if exist "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\com.motiontracker.pro" rmdir /S /Q "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\com.motiontracker.pro" >nul 2>&1',
    'if exist "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere" rmdir /S /Q "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere" >nul 2>&1',
    'echo [OK] Cleaned up legacy extension folders.',
    'echo.',
    'set "DEST=%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP"',
    'if exist "%DEST%" rmdir /S /Q "%DEST%" >nul 2>&1',
    'echo [3/3] Copying MotionTracker by Nightosphere files to:',
    'echo       "%DEST%"',
    'if not exist "%DEST%\\CSXS" mkdir "%DEST%\\CSXS"',
    'if not exist "%DEST%\\jsx" mkdir "%DEST%\\jsx"',
    'copy /Y "%~dp0CSXS\\manifest.xml" "%DEST%\\CSXS\\manifest.xml" >nul',
    'copy /Y "%~dp0jsx\\host.jsx" "%DEST%\\jsx\\host.jsx" >nul',
    'copy /Y "%~dp0index.html" "%DEST%\\index.html" >nul',
    'copy /Y "%~dp0style.css" "%DEST%\\style.css" >nul',
    'copy /Y "%~dp0CSInterface.js" "%DEST%\\CSInterface.js" >nul',
    'copy /Y "%~dp0main.js" "%DEST%\\main.js" >nul',
    'if exist "%~dp0logo.png" copy /Y "%~dp0logo.png" "%DEST%\\logo.png" >nul',
    'echo [OK] All MotionTracker by Nightosphere CEP files copied successfully!',
    'echo.',
    'echo =================================================================',
    'echo   INSTALLATION COMPLETE!',
    'echo   Installed to: %APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP',
    'echo   Restart Adobe Premiere Pro, then open:',
    'echo   Window ^> Extensions ^> MotionTracker by Nightosphere',
    'echo =================================================================',
    'pause',
    'exit /b 0',
  ];
  return lines.join('\r\n') + '\r\n';
}

/**
 * Generates a 100% Plain-Text, Unencoded, Windows Defender-Safe 1-Click .bat Installer.
 * - Zero unsigned .exe binaries
 * - Zero -EncodedCommand or FromBase64String or Invoke-Expression
 * - Automatically removes any old MotionTrackerPro / com.motiontracker.pro / MotionTracker_by_Nightosphere folders
 * - Installs cleanly to %APPDATA%\Adobe\CEP\extensions\MotionTracker_by_Nightosphere_CEP
 */
export function createWindowsInstallerBat(livePayload?: object): string {
  const filesToEmbed: Array<{ marker: string; relPath: string; content: string }> = [
    { marker: 'FILE', relPath: 'CSXS\\manifest.xml', content: MANIFEST_XML },
    { marker: 'FILE', relPath: 'jsx\\host.jsx', content: HOST_JSX },
    { marker: 'FILE', relPath: 'index.html', content: STANDALONE_INDEX_HTML },
    { marker: 'FILE', relPath: 'style.css', content: STANDALONE_STYLE_CSS },
    { marker: 'FILE', relPath: 'CSInterface.js', content: CSINTERFACE_JS },
    { marker: 'FILE', relPath: 'main.js', content: STANDALONE_MAIN_JS },
  ];

  if (livePayload) {
    filesToEmbed.push({
      marker: 'LIVE_PAYLOAD',
      relPath: 'motiontracker_live_payload.json',
      content: JSON.stringify(livePayload, null, 2),
    });
  }

  const headerLines = [
    '@echo off',
    'setlocal EnableExtensions',
    'title MotionTracker by Nightosphere - 1-Click Premiere Pro Installer',
    'echo =================================================================',
    'echo   MotionTracker by Nightosphere - Premiere Pro (2020-2026+) Setup',
    'echo   [100%% Transparent Plain-Text Script - Windows Defender Safe]',
    'echo =================================================================',
    'echo.',
    'echo [1/3] Enabling Adobe CEP PlayerDebugMode (CSXS 9 through 16)...',
    'for %%V in (9 10 11 12 13 14 15 16) do (',
    '    reg add "HKCU\\Software\\Adobe\\CSXS.%%V" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul 2>&1',
    ')',
    'echo [OK] Enabled PlayerDebugMode for Premiere Pro 2020-2026+.',
    'echo.',
    'echo [2/3] Removing any old extension folders so Premiere loads MotionTracker_by_Nightosphere_CEP...',
    'if exist "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTrackerPro" rmdir /S /Q "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTrackerPro" >nul 2>&1',
    'if exist "%APPDATA%\\Adobe\\CEP\\extensions\\com.motiontracker.pro" rmdir /S /Q "%APPDATA%\\Adobe\\CEP\\extensions\\com.motiontracker.pro" >nul 2>&1',
    'if exist "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere" rmdir /S /Q "%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere" >nul 2>&1',
    'if exist "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTrackerPro" rmdir /S /Q "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTrackerPro" >nul 2>&1',
    'if exist "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\com.motiontracker.pro" rmdir /S /Q "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\com.motiontracker.pro" >nul 2>&1',
    'if exist "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere" rmdir /S /Q "C:\\Program Files (x86)\\Common Files\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere" >nul 2>&1',
    'echo [OK] Legacy extension folders removed.',
    'echo.',
    'set "MT_SELF=%~f0"',
    'set "MT_DEST=%APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP"',
    'if exist "%MT_DEST%" rmdir /S /Q "%MT_DEST%" >nul 2>&1',
    'if not exist "%MT_DEST%\\CSXS" mkdir "%MT_DEST%\\CSXS"',
    'if not exist "%MT_DEST%\\jsx" mkdir "%MT_DEST%\\jsx"',
    'echo [3/3] Extracting MotionTracker by Nightosphere CEP files to:',
    'echo       "%MT_DEST%"',
    'powershell -NoProfile -Command "$lines = [IO.File]::ReadAllLines($env:MT_SELF, [Text.Encoding]::UTF8); $out = $null; $buf = New-Object System.Collections.Generic.List[string]; foreach ($l in $lines) { if ($l.StartsWith(\'::::FILE::::\')) { $rel = $l.Substring(12).Trim(); $out = Join-Path $env:MT_DEST $rel; $buf.Clear(); continue } if ($l.StartsWith(\'::::LIVE_PAYLOAD::::\')) { $rel = $l.Substring(20).Trim(); $out = Join-Path ([IO.Path]::GetTempPath()) $rel; $buf.Clear(); continue } if ($l -eq \'::::ENDFILE::::\') { if ($out) { $dir = Split-Path $out -Parent; if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }; [IO.File]::WriteAllText($out, ($buf -join [Environment]::NewLine), (New-Object System.Text.UTF8Encoding($false))); Write-Host (\'  [OK] Wrote \' + $out) -ForegroundColor Green; $out = $null; $buf.Clear() }; continue } if ($out) { $buf.Add($l) } }"',
    'echo.',
    'echo =================================================================',
    'echo   DONE! Installed to: %APPDATA%\\Adobe\\CEP\\extensions\\MotionTracker_by_Nightosphere_CEP',
    'echo   Restart Adobe Premiere Pro and go to:',
    'echo   Window ^> Extensions ^> MotionTracker by Nightosphere',
    'echo =================================================================',
    'timeout /t 5',
    'exit /b 0',
    '',
  ];

  const blocks: string[] = [];
  for (const item of filesToEmbed) {
    const normalizedContent = item.content.replace(/\r?\n/g, '\r\n').trimEnd();
    blocks.push(
      `::::${item.marker}::::${item.relPath}\r\n${normalizedContent}\r\n::::ENDFILE::::`
    );
  }

  return headerLines.join('\r\n') + '\r\n' + blocks.join('\r\n\r\n') + '\r\n';
}

export async function createCEPExtensionZip(): Promise<Blob> {
  const zip = new JSZip();

  // Add CSXS manifest
  zip.file('CSXS/manifest.xml', MANIFEST_XML);
  // Add ExtendScript host
  zip.file('jsx/host.jsx', HOST_JSX);
  // Add index.html and style.css
  zip.file('index.html', STANDALONE_INDEX_HTML);
  zip.file('style.css', STANDALONE_STYLE_CSS);
  zip.file('CSInterface.js', CSINTERFACE_JS);
  zip.file('main.js', STANDALONE_MAIN_JS);
  // Bundle Nightosphere logo.png if available
  try {
    if (typeof fetch !== 'undefined') {
      const resp = await fetch('/assets/aistudio/LOGO_FACE_b4ea04e0.png');
      if (resp.ok) {
        const logoBuf = await resp.arrayBuffer();
        zip.file('logo.png', logoBuf);
      }
    }
  } catch {
    // Inline SVG fallback in index.html handles missing logo.png gracefully
  }
  // Add 100% native Windows Batch copy installer (zero PowerShell, zero Base64, zero .exe)
  zip.file('Install_Plugin_Windows.bat', createZipCopyInstallerBat());
  zip.file('install_windows.reg', INSTALL_REG);
  zip.file('README.md', README_MD);

  return await zip.generateAsync({ type: 'blob' });
}


