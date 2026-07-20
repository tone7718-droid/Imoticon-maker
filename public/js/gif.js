/**
 * GIF 인코더 — ImageData 프레임들을 움직이는 GIF로 인코딩한다 (의존성 없음).
 * 미디언컷 팔레트(255색 + 투명 1색) + 표준 LZW 압축.
 * makeGif(frames: ImageData[], delayMs) => Uint8Array
 */
(function () {
  "use strict";

  const TRANSPARENT_INDEX = 255;
  const ALPHA_CUTOFF = 128;

  /* ---------- 팔레트 (미디언 컷) ---------- */

  function buildPalette(frames) {
    // 모든 프레임에서 픽셀 샘플링 (최대 ~10만개)
    const colors = [];
    const totalPixels = frames.reduce((s, f) => s + f.width * f.height, 0);
    const step = Math.max(1, Math.floor(totalPixels / 100000));
    for (const frame of frames) {
      const d = frame.data;
      for (let i = 0; i < d.length; i += 4 * step) {
        if (d[i + 3] >= ALPHA_CUTOFF) colors.push([d[i], d[i + 1], d[i + 2]]);
      }
    }
    if (colors.length === 0) colors.push([0, 0, 0]);

    // 박스를 가장 넓은 채널 기준으로 반복 분할
    let boxes = [colors];
    while (boxes.length < 255) {
      let widest = -1, widestRange = -1, widestChannel = 0;
      boxes.forEach((box, bi) => {
        if (box.length < 2) return;
        for (let ch = 0; ch < 3; ch++) {
          let min = 255, max = 0;
          for (const c of box) { if (c[ch] < min) min = c[ch]; if (c[ch] > max) max = c[ch]; }
          if (max - min > widestRange) { widestRange = max - min; widest = bi; widestChannel = ch; }
        }
      });
      if (widest < 0 || widestRange === 0) break;
      const box = boxes[widest];
      box.sort((a, b) => a[widestChannel] - b[widestChannel]);
      const mid = box.length >> 1;
      boxes.splice(widest, 1, box.slice(0, mid), box.slice(mid));
    }

    const palette = boxes.map((box) => {
      let r = 0, g = 0, b = 0;
      for (const c of box) { r += c[0]; g += c[1]; b += c[2]; }
      return [Math.round(r / box.length), Math.round(g / box.length), Math.round(b / box.length)];
    });
    while (palette.length < 256) palette.push([0, 0, 0]);
    return palette;
  }

  function makeIndexer(palette) {
    const cache = new Map();
    return (r, g, b) => {
      const key = (r << 16) | (g << 8) | b;
      let idx = cache.get(key);
      if (idx !== undefined) return idx;
      let best = 0, bestDist = Infinity;
      for (let i = 0; i < 255; i++) { // 255번은 투명 전용
        const p = palette[i];
        const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
        const dist = dr * dr + dg * dg + db * db;
        if (dist < bestDist) { bestDist = dist; best = i; }
      }
      cache.set(key, best);
      return best;
    };
  }

  /* ---------- LZW ---------- */

  function lzwEncode(indices, minCodeSize, out) {
    const clearCode = 1 << minCodeSize;
    const eoiCode = clearCode + 1;
    let codeSize = minCodeSize + 1;
    let dict = new Map();
    let nextCode = eoiCode + 1;

    // 비트 스트림 (LSB first) → 255바이트 서브블록
    let bitBuffer = 0, bitCount = 0;
    const block = [];
    const flushBlock = () => {
      out.push(block.length, ...block);
      block.length = 0;
    };
    const emit = (code) => {
      bitBuffer |= code << bitCount;
      bitCount += codeSize;
      while (bitCount >= 8) {
        block.push(bitBuffer & 0xff);
        bitBuffer >>= 8;
        bitCount -= 8;
        if (block.length === 255) flushBlock();
      }
    };

    emit(clearCode);
    let cur = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const px = indices[i];
      const key = (cur << 8) | px;
      const found = dict.get(key);
      if (found !== undefined) {
        cur = found;
        continue;
      }
      emit(cur);
      dict.set(key, nextCode);
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize++;
      nextCode++;
      if (nextCode === 4096) {
        emit(clearCode);
        dict = new Map();
        nextCode = eoiCode + 1;
        codeSize = minCodeSize + 1;
      }
      cur = px;
    }
    emit(cur);
    emit(eoiCode);
    if (bitCount > 0) {
      block.push(bitBuffer & 0xff);
      if (block.length === 255) flushBlock();
    }
    if (block.length > 0) flushBlock();
    out.push(0); // 블록 종료
  }

  /* ---------- GIF 조립 ---------- */

  function makeGif(frames, delayMs = 300) {
    if (frames.length === 0) throw new Error("프레임이 없어요.");
    const { width, height } = frames[0];
    const palette = buildPalette(frames);
    const indexOf = makeIndexer(palette);
    const delay = Math.max(2, Math.round(delayMs / 10)); // 1/100초 단위

    const out = [];
    const pushStr = (s) => { for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); };
    const pushU16 = (n) => out.push(n & 0xff, (n >> 8) & 0xff);

    pushStr("GIF89a");
    pushU16(width);
    pushU16(height);
    out.push(0xf7); // 전역 팔레트 있음, 256색
    out.push(TRANSPARENT_INDEX); // 배경색 인덱스
    out.push(0); // 픽셀 종횡비
    for (let i = 0; i < 256; i++) out.push(palette[i][0], palette[i][1], palette[i][2]);

    // 무한 반복 (Netscape 확장)
    out.push(0x21, 0xff, 0x0b);
    pushStr("NETSCAPE2.0");
    out.push(0x03, 0x01, 0x00, 0x00, 0x00);

    for (const frame of frames) {
      // 그래픽 제어 확장: 투명 인덱스 + 프레임마다 배경 복원(disposal 2)
      out.push(
        0x21, 0xf9, 0x04,
        (2 << 2) | 1, // disposal=2, 투명색 사용
        delay & 0xff, (delay >> 8) & 0xff,
        TRANSPARENT_INDEX,
        0 // 확장 종료
      );

      out.push(0x2c); // 이미지 디스크립터
      pushU16(0); pushU16(0);
      pushU16(frame.width); pushU16(frame.height);
      out.push(0); // 로컬 팔레트 없음

      const d = frame.data;
      const indices = new Uint8Array(frame.width * frame.height);
      for (let p = 0; p < indices.length; p++) {
        const i = p * 4;
        indices[p] = d[i + 3] < ALPHA_CUTOFF
          ? TRANSPARENT_INDEX
          : indexOf(d[i], d[i + 1], d[i + 2]);
      }

      out.push(8); // LZW 최소 코드 크기
      lzwEncode(indices, 8, out);
    }

    out.push(0x3b); // 트레일러
    return new Uint8Array(out);
  }

  window.makeGif = makeGif;
})();
