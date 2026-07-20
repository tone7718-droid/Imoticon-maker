/**
 * 이미지 처리 유틸 — 로드/리사이즈/PNG 변환/배경 투명화
 */
(function () {
  "use strict";

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지 디코딩 실패"));
      img.src = dataUrl;
    });
  }

  /** dataURL → 지정 크기로 그린 canvas (size=0이면 원본 크기) */
  async function toCanvas(dataUrl, size) {
    const img = await loadImage(dataUrl);
    const w = size > 0 ? size : img.naturalWidth;
    const h = size > 0 ? size : img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  }

  async function toPngBytes(dataUrl, size) {
    const canvas = await toCanvas(dataUrl, size);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG 변환 실패");
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function toImageData(dataUrl, size) {
    const canvas = await toCanvas(dataUrl, size);
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  }

  /** dataURL → { mimeType, base64 } (API 전송용) */
  function dataUrlToParts(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!m) throw new Error("dataURL 형식이 아니에요.");
    return { mimeType: m[1], base64: m[2] };
  }

  function dataUrlToBlob(dataUrl) {
    const { mimeType, base64 } = dataUrlToParts(dataUrl);
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  /** 업로드 파일을 최대 maxSize로 축소한 PNG dataURL로 정규화 (API 페이로드 축소) */
  async function normalizeUpload(file, maxSize = 1024) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("파일을 읽을 수 없어요."));
      reader.readAsDataURL(file);
    });
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/png");
  }

  /**
   * 흰(단색) 배경 투명화: 가장자리에서부터 배경색과 비슷한 픽셀을 flood-fill로 지운다.
   * 캐릭터 내부의 흰 부분(눈 흰자 등)은 가장자리와 연결되지 않으므로 보존된다.
   * 이미 투명한 이미지(API가 투명 배경을 준 경우)는 그대로 반환.
   */
  async function removeWhiteBackground(dataUrl, tolerance = 60) {
    const img = await loadImage(dataUrl);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const d = imageData.data;

    // 네 모서리가 이미 투명하면 처리 불필요
    const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4];
    if (corners.every((i) => d[i + 3] < 10)) return dataUrl;

    // 배경색 = 모서리 평균
    let br = 0, bg = 0, bb = 0;
    for (const i of corners) { br += d[i]; bg += d[i + 1]; bb += d[i + 2]; }
    br /= 4; bg /= 4; bb /= 4;

    const dist = (i) => Math.hypot(d[i] - br, d[i + 1] - bg, d[i + 2] - bb);
    const visited = new Uint8Array(w * h);
    const queue = [];

    for (let x = 0; x < w; x++) { queue.push(x); queue.push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { queue.push(y * w); queue.push(y * w + w - 1); }

    while (queue.length > 0) {
      const p = queue.pop();
      if (visited[p]) continue;
      visited[p] = 1;
      if (dist(p * 4) > tolerance) continue;
      d[p * 4 + 3] = 0;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0 && !visited[p - 1]) queue.push(p - 1);
      if (x < w - 1 && !visited[p + 1]) queue.push(p + 1);
      if (y > 0 && !visited[p - w]) queue.push(p - w);
      if (y < h - 1 && !visited[p + w]) queue.push(p + w);
    }

    // 경계 부드럽게: 지워진 픽셀과 맞닿은 픽셀은 배경색과의 거리 비례로 알파 축소
    const alphaOf = (p) => d[p * 4 + 3];
    for (let p = 0; p < w * h; p++) {
      if (alphaOf(p) === 0) continue;
      const x = p % w;
      const y = (p / w) | 0;
      const nearRemoved =
        (x > 0 && alphaOf(p - 1) === 0) ||
        (x < w - 1 && alphaOf(p + 1) === 0) ||
        (y > 0 && alphaOf(p - w) === 0) ||
        (y < h - 1 && alphaOf(p + w) === 0);
      if (!nearRemoved) continue;
      const t = Math.min(1, dist(p * 4) / (tolerance * 2));
      d[p * 4 + 3] = Math.round(d[p * 4 + 3] * t);
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  window.ImageProc = {
    loadImage,
    toCanvas,
    toPngBytes,
    toImageData,
    dataUrlToParts,
    dataUrlToBlob,
    normalizeUpload,
    removeWhiteBackground,
  };
})();
