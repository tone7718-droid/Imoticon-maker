/** 이미지 로드, 규격 리사이즈, 문구 합성, 로컬 애니메이션, 배경 투명화. */
(function () {
  "use strict";

  function loadImage(source) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("이미지 디코딩에 실패했어요."));
      img.src = source;
    });
  }

  function dimensions(img, sizeOrOptions) {
    if (typeof sizeOrOptions === "number") {
      return sizeOrOptions > 0
        ? { width: sizeOrOptions, height: sizeOrOptions, fit: "stretch" }
        : { width: img.naturalWidth, height: img.naturalHeight, fit: "stretch" };
    }
    const opts = sizeOrOptions || {};
    return {
      width: Number(opts.width) || img.naturalWidth,
      height: Number(opts.height) || img.naturalHeight,
      fit: opts.fit || "contain",
    };
  }

  async function toCanvas(source, sizeOrOptions = 0) {
    const img = await loadImage(source);
    const { width, height, fit } = dimensions(img, sizeOrOptions);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (fit === "contain") {
      const scale = Math.min(width / img.naturalWidth, height / img.naturalHeight);
      const drawWidth = Math.round(img.naturalWidth * scale);
      const drawHeight = Math.round(img.naturalHeight * scale);
      const x = Math.round((width - drawWidth) / 2);
      const y = Math.round((height - drawHeight) / 2);
      ctx.drawImage(img, x, y, drawWidth, drawHeight);
    } else {
      ctx.drawImage(img, 0, 0, width, height);
    }
    return canvas;
  }

  async function canvasToBlob(canvas, type = "image/png", quality) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    if (!blob) throw new Error("이미지 변환에 실패했어요.");
    return blob;
  }

  async function blobToDataUrl(blob) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("이미지를 읽을 수 없어요."));
      reader.readAsDataURL(blob);
    });
  }

  async function toPngBytes(source, sizeOrOptions = 0) {
    const canvas = await toCanvas(source, sizeOrOptions);
    return new Uint8Array(await (await canvasToBlob(canvas, "image/png")).arrayBuffer());
  }

  async function toImageData(source, sizeOrOptions = 0) {
    const canvas = await toCanvas(source, sizeOrOptions);
    return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
  }

  function dataUrlToParts(dataUrl) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (!match) throw new Error("올바른 data URL이 아니에요.");
    return { mimeType: match[1], base64: match[2] };
  }

  function dataUrlToBlob(dataUrl) {
    const { mimeType, base64 } = dataUrlToParts(dataUrl);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  async function dataUrlToObjectUrl(dataUrl) {
    return URL.createObjectURL(dataUrlToBlob(dataUrl));
  }

  async function normalizeUpload(file, maxSize = 511) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      throw new Error("PNG, JPEG, WebP 이미지만 사용할 수 있어요.");
    }
    if (file.size > 10 * 1024 * 1024) throw new Error("업로드 이미지는 10MB 이하여야 해요.");
    const source = await blobToDataUrl(file);
    return await normalizeReference(source, maxSize);
  }

  async function normalizeReference(source, maxSize = 511) {
    const img = await loadImage(source);
    const scale = Math.min(1, maxSize / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  }

  async function applyCaption(source, caption) {
    const text = String(caption || "").trim();
    if (!text) return source;
    const canvas = await toCanvas(source, 0);
    const ctx = canvas.getContext("2d");
    const maxWidth = canvas.width * 0.78;
    let fontSize = Math.round(canvas.width * 0.11);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    do {
      ctx.font = `900 ${fontSize}px "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) break;
      fontSize -= 2;
    } while (fontSize > 24);

    const x = canvas.width / 2;
    const y = canvas.height * 0.86;
    ctx.lineWidth = Math.max(5, fontSize * 0.16);
    ctx.strokeStyle = "rgba(255,255,255,0.98)";
    ctx.strokeText(text, x, y, maxWidth);
    ctx.fillStyle = "#27231f";
    ctx.fillText(text, x, y, maxWidth);
    return canvas.toDataURL("image/png");
  }

  async function makeTransformFrames(source, count = 6) {
    const img = await loadImage(source);
    const motions = [
      { dy: 0, rotate: 0, scale: 0.96 },
      { dy: -0.025, rotate: -0.012, scale: 0.975 },
      { dy: -0.045, rotate: 0.012, scale: 0.99 },
      { dy: -0.02, rotate: 0.018, scale: 0.98 },
      { dy: 0.005, rotate: -0.01, scale: 0.965 },
      { dy: 0, rotate: 0, scale: 0.96 },
    ];
    const frames = [];
    for (let index = 0; index < count; index++) {
      const motion = motions[index % motions.length];
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.translate(canvas.width / 2, canvas.height / 2 + canvas.height * motion.dy);
      ctx.rotate(motion.rotate);
      ctx.scale(motion.scale, motion.scale);
      ctx.drawImage(img, -canvas.width / 2, -canvas.height / 2, canvas.width, canvas.height);
      const blob = await canvasToBlob(canvas, "image/png");
      frames.push(URL.createObjectURL(blob));
    }
    return frames;
  }

  /** 가장자리와 연결된 단색 배경만 flood-fill로 투명화한다. */
  async function removeWhiteBackground(source, tolerance = 60) {
    const img = await loadImage(source);
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const corners = [
      0,
      (width - 1) * 4,
      (height - 1) * width * 4,
      ((height - 1) * width + width - 1) * 4,
    ];
    if (corners.every((index) => data[index + 3] < 10)) return source;

    let backgroundR = 0;
    let backgroundG = 0;
    let backgroundB = 0;
    for (const index of corners) {
      backgroundR += data[index];
      backgroundG += data[index + 1];
      backgroundB += data[index + 2];
    }
    backgroundR /= 4;
    backgroundG /= 4;
    backgroundB /= 4;
    const distance = (index) => Math.hypot(
      data[index] - backgroundR,
      data[index + 1] - backgroundG,
      data[index + 2] - backgroundB
    );

    const visited = new Uint8Array(width * height);
    const queue = [];
    for (let x = 0; x < width; x++) queue.push(x, (height - 1) * width + x);
    for (let y = 0; y < height; y++) queue.push(y * width, y * width + width - 1);

    while (queue.length > 0) {
      const pixel = queue.pop();
      if (visited[pixel]) continue;
      visited[pixel] = 1;
      if (distance(pixel * 4) > tolerance) continue;
      data[pixel * 4 + 3] = 0;
      const x = pixel % width;
      const y = (pixel / width) | 0;
      if (x > 0 && !visited[pixel - 1]) queue.push(pixel - 1);
      if (x < width - 1 && !visited[pixel + 1]) queue.push(pixel + 1);
      if (y > 0 && !visited[pixel - width]) queue.push(pixel - width);
      if (y < height - 1 && !visited[pixel + width]) queue.push(pixel + width);
    }

    const alpha = (pixel) => data[pixel * 4 + 3];
    for (let pixel = 0; pixel < width * height; pixel++) {
      if (alpha(pixel) === 0) continue;
      const x = pixel % width;
      const y = (pixel / width) | 0;
      const nearRemoved =
        (x > 0 && alpha(pixel - 1) === 0) ||
        (x < width - 1 && alpha(pixel + 1) === 0) ||
        (y > 0 && alpha(pixel - width) === 0) ||
        (y < height - 1 && alpha(pixel + width) === 0);
      if (!nearRemoved) continue;
      const factor = Math.min(1, distance(pixel * 4) / (tolerance * 2));
      data[pixel * 4 + 3] = Math.round(data[pixel * 4 + 3] * factor);
    }

    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
  }

  window.ImageProc = {
    applyCaption,
    blobToDataUrl,
    canvasToBlob,
    dataUrlToBlob,
    dataUrlToObjectUrl,
    dataUrlToParts,
    loadImage,
    makeTransformFrames,
    normalizeReference,
    normalizeUpload,
    removeWhiteBackground,
    toCanvas,
    toImageData,
    toPngBytes,
  };
})();
