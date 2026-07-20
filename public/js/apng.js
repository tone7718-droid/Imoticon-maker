/**
 * APNG 조립기 — 같은 크기의 PNG 프레임들(Uint8Array)을 움직이는 PNG로 합친다.
 * 브라우저 <img>가 그대로 재생하며, 알파(투명 배경)를 완벽 지원한다.
 * makeApng(frames, delayMs, plays) => Uint8Array
 */
(function () {
  "use strict";

  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  /** PNG 바이트를 청크 목록으로 파싱 */
  function parseChunks(bytes) {
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== PNG_SIG[i]) throw new Error("PNG 파일이 아니에요.");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const chunks = [];
    let pos = 8;
    while (pos < bytes.length) {
      const len = view.getUint32(pos);
      const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      chunks.push({ type, data: bytes.slice(pos + 8, pos + 8 + len) });
      pos += 12 + len;
    }
    return chunks;
  }

  function concatIdat(chunks) {
    const idats = chunks.filter((c) => c.type === "IDAT");
    const total = idats.reduce((s, c) => s + c.data.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of idats) { out.set(c.data, off); off += c.data.length; }
    return out;
  }

  function writeChunk(parts, type, data) {
    const head = new Uint8Array(8);
    new DataView(head.buffer).setUint32(0, data.length);
    for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
    const crcInput = new Uint8Array(4 + data.length);
    crcInput.set(head.slice(4), 0);
    crcInput.set(data, 4);
    const crc = new Uint8Array(4);
    new DataView(crc.buffer).setUint32(0, window.crc32(crcInput));
    parts.push(head, data, crc);
  }

  function u32be(...nums) {
    const out = new Uint8Array(nums.length * 4);
    const view = new DataView(out.buffer);
    nums.forEach((n, i) => view.setUint32(i * 4, n));
    return out;
  }

  /**
   * @param {Uint8Array[]} frames  같은 크기/포맷의 PNG 프레임들
   * @param {number} delayMs       프레임당 지연 (ms)
   */
  function makeApng(frames, delayMs = 300, plays = 0) {
    if (frames.length === 0) throw new Error("프레임이 없어요.");
    const first = parseChunks(frames[0]);
    const ihdr = first.find((c) => c.type === "IHDR");
    if (!ihdr) throw new Error("IHDR 청크가 없어요.");
    const width = new DataView(ihdr.data.buffer, ihdr.data.byteOffset).getUint32(0);
    const height = new DataView(ihdr.data.buffer, ihdr.data.byteOffset).getUint32(4);

    const delayNum = Math.max(1, Math.round(delayMs / 10)); // 1/100초 단위
    const parts = [new Uint8Array(PNG_SIG)];
    writeChunk(parts, "IHDR", ihdr.data);
    writeChunk(parts, "acTL", u32be(frames.length, Math.max(0, plays | 0)));

    let seq = 0;
    const fcTL = (w, h) => {
      const data = new Uint8Array(26);
      const view = new DataView(data.buffer);
      view.setUint32(0, seq++);
      view.setUint32(4, w);
      view.setUint32(8, h);
      view.setUint32(12, 0); // x
      view.setUint32(16, 0); // y
      view.setUint16(20, delayNum);
      view.setUint16(22, 100); // delay_den
      data[24] = 0; // dispose: none (모든 프레임이 전체를 덮음)
      data[25] = 0; // blend: source
      return data;
    };

    // 프레임 1 = 기본 이미지
    writeChunk(parts, "fcTL", fcTL(width, height));
    writeChunk(parts, "IDAT", concatIdat(first));

    // 프레임 2~N = fdAT
    for (let f = 1; f < frames.length; f++) {
      const chunks = parseChunks(frames[f]);
      writeChunk(parts, "fcTL", fcTL(width, height));
      const idat = concatIdat(chunks);
      const fdat = new Uint8Array(4 + idat.length);
      new DataView(fdat.buffer).setUint32(0, seq++);
      fdat.set(idat, 4);
      writeChunk(parts, "fdAT", fdat);
    }

    writeChunk(parts, "IEND", new Uint8Array(0));

    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const p of parts) { out.set(p, off); off += p.length; }
    return out;
  }

  window.makeApng = makeApng;
})();
