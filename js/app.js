/**
 * 이모티콘 메이커 — 메인 앱 로직
 * 흐름: 설명(+참조 이미지) 입력 → AI가 세트 기획(캐릭터 시트 + 장면 목록)
 *       → 장면별 이미지 생성 (움직이는 이모티콘은 프레임 4장씩)
 *       → 배경 투명화 → PNG/APNG/GIF/ZIP 다운로드
 */
(function () {
  "use strict";

  const $ = (sel) => document.querySelector(sel);

  const els = {
    provider: $("#provider"),
    apiKey: $("#api-key"),
    toggleKey: $("#toggle-key"),
    saveKey: $("#save-key"),
    keyHint: $("#key-hint"),
    providerNote: $("#provider-note"),
    description: $("#description"),
    refFile: $("#ref-file"),
    refPick: $("#ref-pick"),
    refPreview: $("#ref-preview"),
    refImg: $("#ref-img"),
    refRemove: $("#ref-remove"),
    count: $("#count"),
    style: $("#style"),
    captionMode: $("#caption-mode"),
    format: $("#format"),
    transparentBg: $("#transparent-bg"),
    animatedHint: $("#animated-hint"),
    generateBtn: $("#generate-btn"),
    sectionProgress: $("#section-progress"),
    progressFill: $("#progress-fill"),
    progressText: $("#progress-text"),
    cancelBtn: $("#cancel-btn"),
    sectionResults: $("#section-results"),
    characterSummary: $("#character-summary"),
    resultsGrid: $("#results-grid"),
    exportSize: $("#export-size"),
    downloadAllBtn: $("#download-all-btn"),
  };

  const CONCURRENCY = 2;
  const FRAME_COUNT = 4;
  const FRAME_DELAY_MS = 300;
  const PREVIEW_SIZE = 360;

  let abortController = null;
  // 현재 세트 상태:
  // { character, styleKey, animated, transparent, reference,
  //   items: [{ idea, status, dataUrl, frames, error, card }] }
  let session = null;
  let referenceImage = null; // { mimeType, base64, dataUrl }

  /* ---------- API 키 저장/불러오기 ---------- */

  function keyStorageName(provider) {
    return `emoticon-maker.key.${provider}`;
  }

  function loadSavedKey() {
    const saved = localStorage.getItem(keyStorageName(els.provider.value));
    els.apiKey.value = saved || "";
    els.saveKey.checked = !!saved;
  }

  function persistKey() {
    const name = keyStorageName(els.provider.value);
    if (els.saveKey.checked && els.apiKey.value.trim()) {
      localStorage.setItem(name, els.apiKey.value.trim());
    } else {
      localStorage.removeItem(name);
    }
  }

  function updateKeyHint() {
    els.keyHint.querySelectorAll("a[data-provider]").forEach((a) => {
      a.hidden = a.dataset.provider !== els.provider.value;
    });
    els.providerNote.hidden =
      window.Providers[els.provider.value]?.supportsReference !== false;
  }

  /* ---------- UI 이벤트 ---------- */

  els.provider.addEventListener("change", () => {
    loadSavedKey();
    updateKeyHint();
  });
  els.apiKey.addEventListener("change", persistKey);
  els.saveKey.addEventListener("change", persistKey);
  els.toggleKey.addEventListener("click", () => {
    els.apiKey.type = els.apiKey.type === "password" ? "text" : "password";
  });

  els.refPick.addEventListener("click", () => els.refFile.click());
  els.refFile.addEventListener("change", async () => {
    const file = els.refFile.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await window.ImageProc.normalizeUpload(file);
      const { mimeType, base64 } = window.ImageProc.dataUrlToParts(dataUrl);
      referenceImage = { mimeType, base64, dataUrl };
      els.refImg.src = dataUrl;
      els.refPreview.hidden = false;
      els.refPick.textContent = "🖼 다른 이미지로 바꾸기";
    } catch (err) {
      alert(`이미지를 불러올 수 없어요: ${err.message}`);
    }
  });
  els.refRemove.addEventListener("click", () => {
    referenceImage = null;
    els.refFile.value = "";
    els.refPreview.hidden = true;
    els.refPick.textContent = "🖼 이미지 올리기";
  });

  els.format.addEventListener("change", () => {
    els.animatedHint.hidden = els.format.value !== "animated";
  });

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      els.description.value =
        `${chip.textContent} 캐릭터를 기반으로 이모티콘을 만들어줘. ` +
        `상황에 따라서 표정 변화와 그 감정을 잘 느낄 수 있도록 해줘.`;
      els.description.focus();
    });
  });

  els.generateBtn.addEventListener("click", startGeneration);
  els.cancelBtn.addEventListener("click", () => abortController?.abort());
  els.downloadAllBtn.addEventListener("click", downloadAllAsZip);

  loadSavedKey();
  updateKeyHint();

  /* ---------- 생성 파이프라인 ---------- */

  async function startGeneration() {
    const provider = window.Providers[els.provider.value];
    const apiKey = els.apiKey.value.trim();
    const description = els.description.value.trim();

    if (!apiKey) return alert("API 키를 입력해 주세요.");
    if (!description) return alert("어떤 이모티콘을 만들지 설명을 입력해 주세요.");
    persistKey();

    abortController = new AbortController();
    const signal = abortController.signal;

    els.generateBtn.disabled = true;
    els.sectionProgress.hidden = false;
    els.sectionResults.hidden = true;
    els.resultsGrid.innerHTML = "";
    setProgress(0, "이모티콘 아이디어를 기획하고 있어요…");

    try {
      const count = parseInt(els.count.value, 10);
      const animated = els.format.value === "animated";
      const plan = await provider.plan(
        apiKey,
        {
          description,
          count,
          captionMode: els.captionMode.value,
          animated,
          reference: referenceImage
            ? { mimeType: referenceImage.mimeType, base64: referenceImage.base64 }
            : null,
        },
        signal
      );
      const ideas = plan.ideas.slice(0, count);

      session = {
        providerKey: els.provider.value, // 재생성 시 같은 제공자를 쓰도록 고정
        character: plan.character,
        styleKey: els.style.value,
        animated,
        transparent: els.transparentBg.checked,
        reference: referenceImage
          ? { mimeType: referenceImage.mimeType, base64: referenceImage.base64 }
          : null,
        items: ideas.map((idea) => ({
          idea, status: "pending", dataUrl: null, frames: null, error: null, card: null,
        })),
      };

      els.characterSummary.textContent = `캐릭터 설정: ${plan.character}`;
      els.sectionResults.hidden = false;
      session.items.forEach((item, i) => {
        item.card = createCard(item, i);
        els.resultsGrid.appendChild(item.card);
      });

      const totalUnits = ideas.length * (animated ? FRAME_COUNT : 1);
      let doneUnits = 0;
      const onUnit = () => {
        doneUnits++;
        setProgress(
          5 + Math.round((doneUnits / totalUnits) * 95),
          animated
            ? `프레임을 그리는 중… (${doneUnits}/${totalUnits}장)`
            : `이모티콘을 그리는 중… (${doneUnits}/${totalUnits})`
        );
      };
      setProgress(5, `기획 완료! 이모티콘 ${ideas.length}개를 그리는 중…`);

      const queue = session.items.map((item, i) => ({ item, i }));
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0 && !signal.aborted) {
          const { item, i } = queue.shift();
          await generateOne(provider, apiKey, item, i, signal, onUnit);
        }
      });
      await Promise.all(workers);

      const failed = session.items.filter((it) => it.status === "error").length;
      setProgress(
        100,
        failed > 0
          ? `완료! (실패 ${failed}개는 카드에서 다시 시도할 수 있어요)`
          : "모든 이모티콘 완성! 🎉"
      );
    } catch (err) {
      if (err.name === "AbortError") {
        setProgress(0, "중단했어요.");
      } else {
        setProgress(0, `오류: ${err.message}`);
        alert(`생성 중 오류가 발생했어요.\n\n${err.message}`);
      }
    } finally {
      els.generateBtn.disabled = false;
      abortController = null;
    }
  }

  async function generateOne(provider, apiKey, item, index, signal, onUnit) {
    item.status = "loading";
    updateCard(item, index);
    try {
      if (session.animated) {
        await generateAnimated(provider, apiKey, item, signal, onUnit);
      } else {
        item.dataUrl = await generateSingle(provider, apiKey, item, signal, {});
        onUnit?.();
      }
      item.status = "done";
      item.error = null;
    } catch (err) {
      if (err.name === "AbortError") {
        item.status = "pending";
      } else {
        item.status = "error";
        item.error = err.message;
      }
    }
    updateCard(item, index);
  }

  /** 한 장 생성 (+URL 응답 처리 + 배경 투명화) */
  async function generateSingle(provider, apiKey, item, signal, { frameDesc, frameIndex, frameRef }) {
    // 참조 이미지 입력을 지원하지 않는 제공자(xAI)는 프롬프트에서도 참조 문구를 뺀다
    const canRef = provider.supportsReference !== false;
    const usableFrameRef = canRef ? frameRef : null;
    const usableUserRef = canRef ? session.reference : null;
    const refMode = usableFrameRef ? "frame" : usableUserRef ? "user" : null;
    const prompt = window.PromptBuilder.buildImagePrompt(
      session.character,
      item.idea,
      session.styleKey,
      { frameDesc, frameIndex: frameIndex || 0, refMode }
    );
    let dataUrl = await provider.generateImage(apiKey, prompt, {
      signal,
      reference: usableFrameRef || usableUserRef,
      transparent: session.transparent,
    });
    if (dataUrl.startsWith("http")) {
      dataUrl = await urlToDataUrl(dataUrl).catch(() => dataUrl);
    }
    if (session.transparent) {
      dataUrl = await window.ImageProc.removeWhiteBackground(dataUrl).catch(() => dataUrl);
    }
    return dataUrl;
  }

  /** 프레임 4장 생성: 1번을 기준 프레임으로, 나머지는 1번 이미지를 참조해 그린다 */
  async function generateAnimated(provider, apiKey, item, signal, onUnit) {
    const descs = (Array.isArray(item.idea.frames) && item.idea.frames.length > 0
      ? item.idea.frames
      : ["base pose", "slight bounce up", "back to base pose", "slight lean down"]
    ).slice(0, FRAME_COUNT);
    while (descs.length < FRAME_COUNT) descs.push(descs[descs.length - 1]);

    const frames = [];
    for (let f = 0; f < descs.length; f++) {
      if (signal?.aborted) throw new DOMException("중단됨", "AbortError");
      const frameRef =
        f === 0 ? null : window.ImageProc.dataUrlToParts(frames[0]);
      const dataUrl = await generateSingle(provider, apiKey, item, signal, {
        frameDesc: descs[f],
        frameIndex: f,
        frameRef,
      });
      frames.push(dataUrl);
      onUnit?.();
    }
    item.frames = frames;
    item.dataUrl = await assembleApngDataUrl(frames, PREVIEW_SIZE);
  }

  async function assembleApngDataUrl(frames, size) {
    const pngFrames = [];
    for (const f of frames) pngFrames.push(await window.ImageProc.toPngBytes(f, size));
    const bytes = window.makeApng(pngFrames, FRAME_DELAY_MS);
    const blob = new Blob([bytes], { type: "image/png" });
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function urlToDataUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`이미지 다운로드 실패 (${res.status})`);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /* ---------- 카드 렌더링 ---------- */

  function createCard(item, index) {
    const card = document.createElement("div");
    card.className = "emoji-card";
    card.innerHTML = `
      <div class="img-wrap"></div>
      <div class="title"></div>
      <div class="card-actions"></div>
    `;
    updateCardInto(card, item, index);
    return card;
  }

  function updateCard(item, index) {
    if (item.card) updateCardInto(item.card, item, index);
  }

  function updateCardInto(card, item, index) {
    card.classList.toggle("loading", item.status === "loading");
    card.classList.toggle("error", item.status === "error");
    card.querySelector(".title").textContent = `${index + 1}. ${item.idea.title}`;

    const imgWrap = card.querySelector(".img-wrap");
    const actions = card.querySelector(".card-actions");
    imgWrap.innerHTML = "";
    actions.innerHTML = "";

    if (item.status === "done" && item.dataUrl) {
      const img = document.createElement("img");
      img.src = item.dataUrl; // APNG dataURL은 <img>에서 그대로 재생됨
      img.alt = item.idea.title;
      imgWrap.appendChild(img);

      if (item.frames) {
        const dlApng = document.createElement("button");
        dlApng.textContent = "⬇ APNG";
        dlApng.addEventListener("click", () => downloadAnimated(item, index, "apng"));
        const dlGif = document.createElement("button");
        dlGif.textContent = "⬇ GIF";
        dlGif.addEventListener("click", () => downloadAnimated(item, index, "gif"));
        actions.append(dlApng, dlGif);
      } else {
        const dl = document.createElement("button");
        dl.textContent = "⬇ 저장";
        dl.addEventListener("click", () => downloadOne(item, index));
        actions.appendChild(dl);
      }
      const re = document.createElement("button");
      re.textContent = "🔄 다시";
      re.addEventListener("click", () => regenerateOne(item, index));
      actions.appendChild(re);
    } else if (item.status === "error") {
      const msg = document.createElement("div");
      msg.className = "error-msg";
      msg.textContent = item.error || "실패";
      imgWrap.appendChild(msg);
      const re = document.createElement("button");
      re.textContent = "🔄 다시 시도";
      re.addEventListener("click", () => regenerateOne(item, index));
      actions.appendChild(re);
    }
  }

  async function regenerateOne(item, index) {
    const provider = window.Providers[session?.providerKey || els.provider.value];
    const apiKey = els.apiKey.value.trim();
    if (!apiKey) return alert("API 키를 입력해 주세요.");
    await generateOne(provider, apiKey, item, index, undefined, undefined);
  }

  /* ---------- 다운로드 ---------- */

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 30) || "emoticon";
  }

  function fileNameFor(item, index, ext = "png") {
    return `${String(index + 1).padStart(2, "0")}_${sanitizeFilename(item.idea.title)}.${ext}`;
  }

  function exportSize() {
    return parseInt(els.exportSize.value, 10);
  }

  // 애니메이션은 모든 프레임 크기가 같아야 하므로 "원본"이면 첫 프레임 크기로 통일
  async function resolveFrameSize(item, size) {
    if (size > 0) return size;
    const img = await window.ImageProc.loadImage(item.frames[0]);
    return img.naturalWidth;
  }

  async function buildApngBytes(item, size) {
    const s = await resolveFrameSize(item, size);
    const pngFrames = [];
    for (const f of item.frames) pngFrames.push(await window.ImageProc.toPngBytes(f, s));
    return window.makeApng(pngFrames, FRAME_DELAY_MS);
  }

  async function buildGifBytes(item, size) {
    const s = await resolveFrameSize(item, size);
    const frames = [];
    for (const f of item.frames) frames.push(await window.ImageProc.toImageData(f, s));
    return window.makeGif(frames, FRAME_DELAY_MS);
  }

  async function downloadOne(item, index) {
    try {
      const bytes = await window.ImageProc.toPngBytes(item.dataUrl, exportSize());
      saveBlob(new Blob([bytes], { type: "image/png" }), fileNameFor(item, index));
    } catch (err) {
      alert(`저장 실패: ${err.message}`);
    }
  }

  async function downloadAnimated(item, index, format) {
    try {
      if (format === "gif") {
        const bytes = await buildGifBytes(item, exportSize());
        saveBlob(new Blob([bytes], { type: "image/gif" }), fileNameFor(item, index, "gif"));
      } else {
        const bytes = await buildApngBytes(item, exportSize());
        saveBlob(new Blob([bytes], { type: "image/png" }), fileNameFor(item, index, "png"));
      }
    } catch (err) {
      alert(`저장 실패: ${err.message}`);
    }
  }

  async function downloadAllAsZip() {
    if (!session) return;
    const doneItems = session.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === "done" && item.dataUrl);
    if (doneItems.length === 0) return alert("완성된 이모티콘이 아직 없어요.");

    els.downloadAllBtn.disabled = true;
    els.downloadAllBtn.textContent = "묶는 중…";
    try {
      const size = exportSize();
      const files = [];
      for (const { item, index } of doneItems) {
        if (item.frames) {
          files.push({ name: fileNameFor(item, index, "png"), data: await buildApngBytes(item, size) });
          files.push({ name: fileNameFor(item, index, "gif"), data: await buildGifBytes(item, size) });
        } else {
          files.push({
            name: fileNameFor(item, index),
            data: await window.ImageProc.toPngBytes(item.dataUrl, size),
          });
        }
      }
      saveBlob(window.makeZip(files), "emoticons.zip");
    } catch (err) {
      alert(`ZIP 저장 실패: ${err.message}`);
    } finally {
      els.downloadAllBtn.disabled = false;
      els.downloadAllBtn.textContent = "⬇ 전체 ZIP 다운로드";
    }
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  /* ---------- 진행 표시 ---------- */

  function setProgress(percent, text) {
    els.progressFill.style.width = `${percent}%`;
    els.progressText.textContent = text;
  }
})();
