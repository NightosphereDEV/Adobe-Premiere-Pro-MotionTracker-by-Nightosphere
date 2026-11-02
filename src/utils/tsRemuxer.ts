/**
 * Pure-JavaScript MPEG-2 Transport Stream (.ts / .mts / .m2ts) to ISO-BMFF (.mp4) Remuxer
 *
 * Allows HTML5 <video> in both Web Browsers and Adobe Premiere Pro CEP (Chromium)
 * to natively play and scrub H.264 .ts / .mts / .m2ts footage in memory without
 * any PNG sequences or external codecs.
 */

interface H264FrameSample {
  pts: number;
  isKeyframe: boolean;
  avccData: Uint8Array;
}

export function isMPEGTransportStream(nameOrPath: string): boolean {
  if (!nameOrPath) return false;
  const lower = nameOrPath.toLowerCase();
  return lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.m2ts');
}


/**
 * Parse H.264 SPS (Sequence Parameter Set) Exp-Golomb bitstream to extract frame dimensions.
 */
function parseSPSDimensions(sps: Uint8Array): { width: number; height: number } {
  // Remove emulation prevention bytes (0x00 0x00 0x03 -> 0x00 0x00)
  const rbsp: number[] = [];
  for (let i = 0; i < sps.length; i++) {
    if (i >= 2 && sps[i] === 0x03 && sps[i - 1] === 0x00 && sps[i - 2] === 0x00) {
      continue;
    }
    rbsp.push(sps[i]);
  }

  let bitOffset = 32; // Skip forbidden_zero_bit + nal_ref_idc + nal_unit_type (1B) + profile_idc (1B) + constraints (1B) + level_idc (1B)

  const readBit = (): number => {
    const byteIdx = bitOffset >> 3;
    if (byteIdx >= rbsp.length) return 0;
    const bitIdx = 7 - (bitOffset & 7);
    bitOffset++;
    return (rbsp[byteIdx] >> bitIdx) & 1;
  };

  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      val = (val << 1) | readBit();
    }
    return val;
  };

  const readUEG = (): number => {
    let zeros = 0;
    while (bitOffset < rbsp.length * 8 && readBit() === 0 && zeros < 31) {
      zeros++;
    }
    return (1 << zeros) - 1 + readBits(zeros);
  };

  const readSEG = (): number => {
    const ueg = readUEG();
    return ueg & 1 ? (ueg + 1) >> 1 : -(ueg >> 1);
  };

  try {
    const profileIdc = rbsp[1] || 66;
    readUEG(); // seq_parameter_set_id

    let chromaFormatIdc = 1;
    if (
      profileIdc === 100 ||
      profileIdc === 110 ||
      profileIdc === 122 ||
      profileIdc === 244 ||
      profileIdc === 44 ||
      profileIdc === 83 ||
      profileIdc === 86 ||
      profileIdc === 118 ||
      profileIdc === 128 ||
      profileIdc === 138 ||
      profileIdc === 139 ||
      profileIdc === 134
    ) {
      chromaFormatIdc = readUEG();
      if (chromaFormatIdc === 3) {
        readBit(); // separate_colour_plane_flag
      }
      readUEG(); // bit_depth_luma_minus8
      readUEG(); // bit_depth_chroma_minus8
      readBit(); // qpprime_y_zero_transform_bypass_flag
      const seqScalingMatrixPresentFlag = readBit();
      if (seqScalingMatrixPresentFlag) {
        const count = chromaFormatIdc !== 3 ? 8 : 12;
        for (let i = 0; i < count; i++) {
          if (readBit()) {
            const sizeOfScalingList = i < 6 ? 16 : 64;
            let lastScale = 8;
            let nextScale = 8;
            for (let j = 0; j < sizeOfScalingList; j++) {
              if (nextScale !== 0) {
                const deltaScale = readSEG();
                nextScale = (lastScale + deltaScale + 256) % 256;
              }
              lastScale = nextScale === 0 ? lastScale : nextScale;
            }
          }
        }
      }
    }

    readUEG(); // log2_max_frame_num_minus4
    const picOrderCntType = readUEG();
    if (picOrderCntType === 0) {
      readUEG(); // log2_max_pic_order_cnt_lsb_minus4
    } else if (picOrderCntType === 1) {
      readBit(); // delta_pic_order_always_zero_flag
      readSEG(); // offset_for_non_ref_pic
      readSEG(); // offset_for_top_to_bottom_field
      const numRefFramesInPicOrderCntCycle = readUEG();
      for (let i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        readSEG();
      }
    }

    readUEG(); // max_num_ref_frames
    readBit(); // gaps_in_frame_num_value_allowed_flag
    const picWidthInMbsMinus1 = readUEG();
    const picHeightInMapUnitsMinus1 = readUEG();
    const frameMbsOnlyFlag = readBit();
    if (!frameMbsOnlyFlag) {
      readBit(); // mb_adaptive_frame_field_flag
    }
    readBit(); // direct_8x8_inference_flag
    const frameCroppingFlag = readBit();
    let cropLeft = 0;
    let cropRight = 0;
    let cropTop = 0;
    let cropBottom = 0;
    if (frameCroppingFlag) {
      cropLeft = readUEG();
      cropRight = readUEG();
      cropTop = readUEG();
      cropBottom = readUEG();
    }

    const cropUnitX = chromaFormatIdc === 0 ? 1 : 2;
    const cropUnitY = (chromaFormatIdc === 0 ? 1 : 2) * (2 - frameMbsOnlyFlag);

    const width = (picWidthInMbsMinus1 + 1) * 16 - (cropLeft + cropRight) * cropUnitX;
    const height =
      (2 - frameMbsOnlyFlag) * (picHeightInMapUnitsMinus1 + 1) * 16 -
      (cropTop + cropBottom) * cropUnitY;

    if (width >= 64 && width <= 7680 && height >= 64 && height <= 4320) {
      return { width, height };
    }
  } catch {
    // Fallback to 1920x1080 if SPS parsing hits unexpected bitstream
  }
  return { width: 1920, height: 1080 };
}

/**
 * Split an Annex-B byte array (with 00 00 01 or 00 00 00 01 start codes) into raw NAL units.
 */
function splitAnnexBNals(buffer: Uint8Array): Uint8Array[] {
  const nals: Uint8Array[] = [];
  const starts: number[] = [];
  const nextOffsets: number[] = [];

  let i = 0;
  const len = buffer.length;
  while (i < len - 3) {
    if (buffer[i] === 0 && buffer[i + 1] === 0) {
      if (buffer[i + 2] === 1) {
        starts.push(i);
        nextOffsets.push(i + 3);
        i += 3;
        continue;
      } else if (i < len - 4 && buffer[i + 2] === 0 && buffer[i + 3] === 1) {
        starts.push(i);
        nextOffsets.push(i + 4);
        i += 4;
        continue;
      }
    }
    i++;
  }

  for (let k = 0; k < starts.length; k++) {
    const dataStart = nextOffsets[k];
    const dataEnd = k + 1 < starts.length ? starts[k + 1] : len;
    if (dataEnd > dataStart) {
      nals.push(buffer.subarray(dataStart, dataEnd));
    }
  }
  return nals;
}

function makeBox(type: string, ...payloads: Uint8Array[]): Uint8Array {
  let size = 8;
  for (const p of payloads) size += p.length;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, size);
  for (let i = 0; i < 4; i++) {
    out[4 + i] = type.charCodeAt(i);
  }
  let offset = 8;
  for (const p of payloads) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/**
 * Remuxes an MPEG-2 Transport Stream (.ts, .mts, .m2ts) containing H.264 video
 * into a standard ISO-BMFF (.mp4) byte array that HTML5 <video> can play natively.
 * Returns null if the stream does not contain H.264/AVC video (so caller can fall back to FFmpeg).
 */
export function remuxTSToMP4(tsBytes: Uint8Array): Uint8Array | null {
  if (!tsBytes || tsBytes.length < 188 * 3) return null;

  // Detect packet stride (188 for .ts, 192 for .m2ts / .mts)
  let stride = 188;
  let syncOffset = -1;

  for (const candStride of [188, 192]) {
    const searchLimit = Math.min(Math.max(0, tsBytes.length - candStride * 2), 4096);
    for (let start = 0; start < searchLimit; start++) {
      if (
        tsBytes[start] === 0x47 &&
        tsBytes[start + candStride] === 0x47 &&
        tsBytes[start + candStride * 2] === 0x47
      ) {
        stride = candStride;
        syncOffset = start;
        break;
      }
    }
    if (syncOffset !== -1) break;
  }

  if (syncOffset === -1) return null;

  let pmtPid = -1;
  let videoPid = -1;
  const pesChunks: Uint8Array[] = [];
  let currentPts = -1;

  let sps = null as Uint8Array | null;
  let pps = null as Uint8Array | null;
  const samples: H264FrameSample[] = [];

  const flushPES = () => {
    if (pesChunks.length === 0) return;
    let totalLen = 0;
    for (const c of pesChunks) totalLen += c.length;
    const pes = new Uint8Array(totalLen);
    let pos = 0;
    for (const c of pesChunks) {
      pes.set(c, pos);
      pos += c.length;
    }
    pesChunks.length = 0;

    // Verify PES start code prefix 0x000001
    if (pes.length < 9 || pes[0] !== 0x00 || pes[1] !== 0x00 || pes[2] !== 0x01) return;
    const streamId = pes[3];
    // Video stream IDs in MPEG-TS are 0xE0..0xEF
    if (streamId < 0xe0 || streamId > 0xef) return;

    const flags2 = pes[7];
    const headerDataLen = pes[8];
    const payloadStart = 9 + headerDataLen;
    if (payloadStart >= pes.length) return;

    let pts = currentPts;
    if ((flags2 & 0x80) !== 0 && pes.length >= 14) {
      // 33-bit PTS in 90kHz clock
      const b0 = pes[9];
      const b1 = pes[10];
      const b2 = pes[11];
      const b3 = pes[12];
      const b4 = pes[13];
      pts =
        ((b0 & 0x0e) * 536870912) + // << 29
        ((b1 & 0xff) << 22) +
        ((b2 & 0xfe) << 14) +
        ((b3 & 0xff) << 7) +
        ((b4 & 0xfe) >> 1);
      currentPts = pts;
    }

    const esPayload = pes.subarray(payloadStart);
    const nals = splitAnnexBNals(esPayload);
    if (nals.length === 0) return;

    const frameNals: Uint8Array[] = [];
    let isKeyframe = false;

    for (const nal of nals) {
      if (nal.length === 0) continue;
      const nalType = nal[0] & 0x1f;
      if (nalType === 7) {
        if (!sps) sps = nal;
      } else if (nalType === 8) {
        if (!pps) pps = nal;
      } else if (nalType === 5) {
        isKeyframe = true;
        frameNals.push(nal);
      } else if (nalType === 1 || nalType === 6) {
        frameNals.push(nal);
      }
    }

    if (frameNals.length === 0) return;

    let avccLen = 0;
    for (const fn of frameNals) avccLen += 4 + fn.length;
    const avccData = new Uint8Array(avccLen);
    const avccView = new DataView(avccData.buffer);
    let writeOff = 0;
    for (const fn of frameNals) {
      avccView.setUint32(writeOff, fn.length);
      avccData.set(fn, writeOff + 4);
      writeOff += 4 + fn.length;
    }

    const samplePts = pts >= 0 ? pts : samples.length * 3000;
    samples.push({
      pts: samplePts,
      isKeyframe,
      avccData,
    });
  };

  for (let p = syncOffset; p + 188 <= tsBytes.length; p += stride) {
    if (tsBytes[p] !== 0x47) continue;

    const pusi = (tsBytes[p + 1] & 0x40) !== 0;
    const pid = ((tsBytes[p + 1] & 0x1f) << 8) | tsBytes[p + 2];
    const afc = (tsBytes[p + 3] >> 4) & 0x03;

    let payloadOffset = p + 4;
    if (afc === 2 || afc === 0) continue; // Adaptation field only or reserved
    if (afc === 3) {
      const afLen = tsBytes[p + 4];
      payloadOffset += 1 + afLen;
    }
    if (payloadOffset >= p + 188) continue;

    const payload = tsBytes.subarray(payloadOffset, p + 188);

    // 1. PAT (PID 0)
    if (pid === 0 && pmtPid === -1) {
      const ptr = pusi ? payload[0] + 1 : 0;
      if (ptr + 12 <= payload.length && payload[ptr] === 0x00) {
        const secLen = ((payload[ptr + 1] & 0x0f) << 8) | payload[ptr + 2];
        const end = Math.min(payload.length, ptr + 3 + secLen - 4);
        for (let idx = ptr + 8; idx + 4 <= end; idx += 4) {
          const progNum = (payload[idx] << 8) | payload[idx + 1];
          const progPid = ((payload[idx + 2] & 0x1f) << 8) | payload[idx + 3];
          if (progNum !== 0) {
            pmtPid = progPid;
            break;
          }
        }
      }
      continue;
    }

    // 2. PMT
    if (pid === pmtPid && videoPid === -1) {
      const ptr = pusi ? payload[0] + 1 : 0;
      if (ptr + 12 <= payload.length && payload[ptr] === 0x02) {
        const secLen = ((payload[ptr + 1] & 0x0f) << 8) | payload[ptr + 2];
        const progInfoLen = ((payload[ptr + 10] & 0x0f) << 8) | payload[ptr + 11];
        let idx = ptr + 12 + progInfoLen;
        const end = Math.min(payload.length, ptr + 3 + secLen - 4);
        while (idx + 5 <= end) {
          const streamType = payload[idx];
          const elemPid = ((payload[idx + 1] & 0x1f) << 8) | payload[idx + 2];
          const esInfoLen = ((payload[idx + 3] & 0x0f) << 8) | payload[idx + 4];
          // 0x1B = H.264 / AVC
          if (streamType === 0x1b) {
            videoPid = elemPid;
            break;
          }
          idx += 5 + esInfoLen;
        }
      }
      continue;
    }

    // Fallback: auto-detect video PID if PES starts with 00 00 01 E0..EF
    if (
      videoPid === -1 &&
      pusi &&
      payload.length >= 9 &&
      payload[0] === 0x00 &&
      payload[1] === 0x00 &&
      payload[2] === 0x01 &&
      payload[3] >= 0xe0 &&
      payload[3] <= 0xef
    ) {
      videoPid = pid;
    }

    if (pid === videoPid && videoPid !== -1) {
      if (pusi) {
        flushPES();
      }
      pesChunks.push(payload);
    }
  }

  flushPES();

  if (!sps || !pps || samples.length === 0) {
    return null;
  }

  // Sort or normalize PTS deltas in 90kHz timescale
  const defaultDelta = 3000; // 30fps in 90kHz timescale
  const sampleDeltas: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (i < samples.length - 1) {
      const d = samples[i + 1].pts - samples[i].pts;
      sampleDeltas.push(d > 100 && d < 90000 ? d : defaultDelta);
    } else {
      sampleDeltas.push(sampleDeltas.length > 0 ? sampleDeltas[sampleDeltas.length - 1] : defaultDelta);
    }
  }

  let totalDuration = 0;
  for (const d of sampleDeltas) totalDuration += d;

  const { width, height } = parseSPSDimensions(sps);

  // Build ftyp box
  const ftypPayload = new Uint8Array([
    0x69, 0x73, 0x6f, 0x6d, // isom
    0x00, 0x00, 0x02, 0x00, // minor_version
    0x69, 0x73, 0x6f, 0x6d, // isom
    0x69, 0x73, 0x6f, 0x32, // iso2
    0x61, 0x76, 0x63, 0x31, // avc1
    0x6d, 0x70, 0x34, 0x31, // mp41
  ]);
  const ftypBox = makeBox('ftyp', ftypPayload);

  // Calculate mdat size and chunk offsets
  let mdatDataSize = 0;
  for (const s of samples) mdatDataSize += s.avccData.length;
  const mdatHeaderSize = 8;
  const mdatStartOffset = ftypBox.length + mdatHeaderSize;

  const chunkOffsets: number[] = [];
  const sampleSizes: number[] = [];
  const syncSamples: number[] = [];
  let runningOffset = mdatStartOffset;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    chunkOffsets.push(runningOffset);
    sampleSizes.push(s.avccData.length);
    if (s.isKeyframe) syncSamples.push(i + 1);
    runningOffset += s.avccData.length;
  }
  if (syncSamples.length === 0) syncSamples.push(1);

  const mdatBox = new Uint8Array(mdatHeaderSize + mdatDataSize);
  new DataView(mdatBox.buffer).setUint32(0, mdatBox.length);
  mdatBox[4] = 0x6d; // m
  mdatBox[5] = 0x64; // d
  mdatBox[6] = 0x61; // a
  mdatBox[7] = 0x74; // t
  let mdatWrite = 8;
  for (const s of samples) {
    mdatBox.set(s.avccData, mdatWrite);
    mdatWrite += s.avccData.length;
  }

  // Build avcC box
  const avcCPayload = new Uint8Array(11 + sps.length + pps.length);
  avcCPayload[0] = 1; // configurationVersion
  avcCPayload[1] = sps[1] || 0x64; // AVCProfileIndication
  avcCPayload[2] = sps[2] || 0x00; // profile_compatibility
  avcCPayload[3] = sps[3] || 0x1f; // AVCLevelIndication
  avcCPayload[4] = 0xff; // lengthSizeMinusOne = 3 (4 bytes)
  avcCPayload[5] = 0xe1; // numOfSequenceParameterSets = 1
  avcCPayload[6] = (sps.length >> 8) & 0xff;
  avcCPayload[7] = sps.length & 0xff;
  avcCPayload.set(sps, 8);
  const ppsOff = 8 + sps.length;
  avcCPayload[ppsOff] = 1; // numOfPictureParameterSets = 1
  avcCPayload[ppsOff + 1] = (pps.length >> 8) & 0xff;
  avcCPayload[ppsOff + 2] = pps.length & 0xff;
  avcCPayload.set(pps, ppsOff + 3);
  const avcCBox = makeBox('avcC', avcCPayload);

  // Build avc1 box inside stsd
  const avc1Header = new Uint8Array(78);
  const avc1View = new DataView(avc1Header.buffer);
  avc1View.setUint16(6, 1); // data_reference_index = 1
  avc1View.setUint16(24, width);
  avc1View.setUint16(26, height);
  avc1View.setUint32(28, 0x00480000); // horizresolution 72 dpi
  avc1View.setUint32(32, 0x00480000); // vertresolution 72 dpi
  avc1View.setUint16(40, 1); // frame_count = 1
  avc1View.setUint16(74, 0x0018); // depth = 24
  avc1View.setInt16(76, -1); // pre_defined = -1
  const avc1Box = makeBox('avc1', avc1Header, avcCBox);

  const stsdHeader = new Uint8Array(8);
  new DataView(stsdHeader.buffer).setUint32(4, 1); // entry_count = 1
  const stsdBox = makeBox('stsd', stsdHeader, avc1Box);

  // stts (Time-to-Sample)
  const sttsPayload = new Uint8Array(8 + samples.length * 8);
  const sttsView = new DataView(sttsPayload.buffer);
  sttsView.setUint32(4, samples.length);
  for (let i = 0; i < samples.length; i++) {
    sttsView.setUint32(8 + i * 8, 1);
    sttsView.setUint32(12 + i * 8, sampleDeltas[i]);
  }
  const sttsBox = makeBox('stts', sttsPayload);

  // stss (Sync Sample)
  const stssPayload = new Uint8Array(8 + syncSamples.length * 4);
  const stssView = new DataView(stssPayload.buffer);
  stssView.setUint32(4, syncSamples.length);
  for (let i = 0; i < syncSamples.length; i++) {
    stssView.setUint32(8 + i * 4, syncSamples[i]);
  }
  const stssBox = makeBox('stss', stssPayload);

  // stsc (Sample-to-Chunk: 1 sample per chunk)
  const stscPayload = new Uint8Array(20);
  const stscView = new DataView(stscPayload.buffer);
  stscView.setUint32(4, 1); // entry_count = 1
  stscView.setUint32(8, 1); // first_chunk = 1
  stscView.setUint32(12, 1); // samples_per_chunk = 1
  stscView.setUint32(16, 1); // sample_description_index = 1
  const stscBox = makeBox('stsc', stscPayload);

  // stsz (Sample Sizes)
  const stszPayload = new Uint8Array(12 + sampleSizes.length * 4);
  const stszView = new DataView(stszPayload.buffer);
  stszView.setUint32(4, 0); // sample_size = 0 (variable)
  stszView.setUint32(8, sampleSizes.length);
  for (let i = 0; i < sampleSizes.length; i++) {
    stszView.setUint32(12 + i * 4, sampleSizes[i]);
  }
  const stszBox = makeBox('stsz', stszPayload);

  // stco (Chunk Offsets)
  const stcoPayload = new Uint8Array(8 + chunkOffsets.length * 4);
  const stcoView = new DataView(stcoPayload.buffer);
  stcoView.setUint32(4, chunkOffsets.length);
  for (let i = 0; i < chunkOffsets.length; i++) {
    stcoView.setUint32(8 + i * 4, chunkOffsets[i]);
  }
  const stcoBox = makeBox('stco', stcoPayload);

  const stblBox = makeBox('stbl', stsdBox, sttsBox, stssBox, stscBox, stszBox, stcoBox);

  const vmhdPayload = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  const vmhdBox = makeBox('vmhd', vmhdPayload);

  const urlBox = makeBox('url ', new Uint8Array([0, 0, 0, 1]));
  const drefHeader = new Uint8Array(8);
  new DataView(drefHeader.buffer).setUint32(4, 1);
  const drefBox = makeBox('dref', drefHeader, urlBox);
  const dinfBox = makeBox('dinf', drefBox);

  const minfBox = makeBox('minf', vmhdBox, dinfBox, stblBox);

  // mdhd
  const mdhdPayload = new Uint8Array(24);
  const mdhdView = new DataView(mdhdPayload.buffer);
  mdhdView.setUint32(12, 90000); // timescale = 90000
  mdhdView.setUint32(16, totalDuration);
  mdhdView.setUint16(20, 0x55c4); // language = und
  const mdhdBox = makeBox('mdhd', mdhdPayload);

  // hdlr
  const hdlrPayload = new Uint8Array([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0x76, 0x69, 0x64, 0x65, // 'vide'
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0x56, 0x69, 0x64, 0x65, 0x6f, 0x48, 0x61, 0x6e, 0x64, 0x6c, 0x65, 0x72, 0x00,
  ]);
  const hdlrBox = makeBox('hdlr', hdlrPayload);

  const mdiaBox = makeBox('mdia', mdhdBox, hdlrBox, minfBox);

  // tkhd
  const tkhdPayload = new Uint8Array(84);
  const tkhdView = new DataView(tkhdPayload.buffer);
  tkhdPayload[3] = 0x03; // track_enabled | track_in_movie
  tkhdView.setUint32(12, 1); // track_ID = 1
  tkhdView.setUint32(20, totalDuration);
  tkhdView.setUint32(40, 0x00010000); // identity matrix [0]
  tkhdView.setUint32(56, 0x00010000); // identity matrix [4]
  tkhdView.setUint32(72, 0x40000000); // identity matrix [8]
  tkhdView.setUint32(76, width << 16);
  tkhdView.setUint32(80, height << 16);
  const tkhdBox = makeBox('tkhd', tkhdPayload);

  const trakBox = makeBox('trak', tkhdBox, mdiaBox);

  // mvhd
  const mvhdPayload = new Uint8Array(100);
  const mvhdView = new DataView(mvhdPayload.buffer);
  mvhdView.setUint32(12, 90000); // timescale = 90000
  mvhdView.setUint32(16, totalDuration);
  mvhdView.setUint32(20, 0x00010000); // rate = 1.0
  mvhdView.setUint16(24, 0x0100); // volume = 1.0
  mvhdView.setUint32(36, 0x00010000); // matrix [0]
  mvhdView.setUint32(52, 0x00010000); // matrix [4]
  mvhdView.setUint32(68, 0x40000000); // matrix [8]
  mvhdView.setUint32(96, 2); // next_track_ID = 2
  const mvhdBox = makeBox('mvhd', mvhdPayload);

  const moovBox = makeBox('moov', mvhdBox, trakBox);

  // Final MP4 file: ftyp + mdat + moov
  const mp4 = new Uint8Array(ftypBox.length + mdatBox.length + moovBox.length);
  mp4.set(ftypBox, 0);
  mp4.set(mdatBox, ftypBox.length);
  mp4.set(moovBox, ftypBox.length + mdatBox.length);

  return mp4;
}
