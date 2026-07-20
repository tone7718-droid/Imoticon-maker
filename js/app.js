/**
 * 이모티콘 메이커 — 메인 앱 로직
 * 흐름: 설명 입력 → AI가 세트 기획(캐릭터 시트 + 장면 목록) → 장면별 이미지 생성 → 다운로드
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
    description: $("#description"),
    count: $("#count"),
    style: $("#style"),
    captionMode: $("#caption-mode"),
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
  let abortController = null;
  // 현재 세트 상태: { character, styleKey, items: [{idea, status, dataUrl, error, card}] }
  let session = null;

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
    const providerKey = els.provider.value;
    const provider = window.Providers[providerKey];
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
      const plan = await provider.plan(
        apiKey,
        { description, count, captionMode: els.captionMode.value },
        signal
      );
      const ideas = plan.ideas.slice(0, count);

      session = {
        character: plan.character,
        styleKey: els.style.value,
        items: ideas.map((idea) => ({ idea, status: "pending", dataUrl: null, error: null, card: null })),
      };

      els.characterSummary.textContent = `캐릭터 설정: ${plan.character}`;
      els.sectionResults.hidden = false;
      session.items.forEach((item, i) => {
        item.card = createCard(item, i);
        els.resultsGrid.appendChild(item.card);
      });

      setProgress(5, `기획 완료! 이모티콘 ${ideas.length}개를 그리는 중… (0/${ideas.length})`);

      let done = 0;
      const queue = session.items.map((item, i) => ({ item, i }));
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length > 0 && !signal.aborted) {
          const { item, i } = queue.shift();
          await generateOne(provider, apiKey, item, i, signal);
          done++;
          setProgress(
            5 + Math.round((done / session.items.length) * 95),
            `이모티콘을 그리는 중… (${done}/${session.items.length})`
          );
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

  async function generateOne(provider, apiKey, item, index, signal) {
    item.status = "loading";
    updateCard(item, index);
    try {
      const prompt = window.PromptBuilder.buildImagePrompt(
        session.character,
        item.idea,
        session.styleKey
      );
      let dataUrl = await provider.generateImage(apiKey, prompt, signal);
      if (dataUrl.startsWith("http")) {
        dataUrl = await urlToDataUrl(dataUrl).catch(() => dataUrl);
      }
      item.dataUrl = dataUrl;
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
      img.src = item.dataUrl;
      img.alt = item.idea.title;
      imgWrap.appendChild(img);

      const dl = document.createElement("button");
      dl.textContent = "⬇ 저장";
      dl.addEventListener("click", () => downloadOne(item, index));
      const re = document.createElement("button");
      re.textContent = "🔄 다시";
      re.addEventListener("click", () => regenerateOne(item, index));
      actions.append(dl, re);
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
    const provider = window.Providers[els.provider.value];
    const apiKey = els.apiKey.value.trim();
    if (!apiKey) return alert("API 키를 입력해 주세요.");
    await generateOne(provider, apiKey, item, index, undefined);
  }

  /* ---------- 다운로드 ---------- */

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 30) || "emoticon";
  }

  function fileNameFor(item, index) {
    return `${String(index + 1).padStart(2, "0")}_${sanitizeFilename(item.idea.title)}.png`;
  }

  /** dataURL을 지정 크기의 PNG Uint8Array로 변환 (0이면 원본 크기 유지) */
  async function toPngBytes(dataUrl, size) {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("이미지 디코딩 실패"));
      image.src = dataUrl;
    });
    const w = size > 0 ? size : img.naturalWidth;
    const h = size > 0 ? size : img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG 변환 실패");
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function downloadOne(item, index) {
    try {
      const size = parseInt(els.exportSize.value, 10);
      const bytes = await toPngBytes(item.dataUrl, size);
      saveBlob(new Blob([bytes], { type: "image/png" }), fileNameFor(item, index));
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
      const size = parseInt(els.exportSize.value, 10);
      const files = [];
      for (const { item, index } of doneItems) {
        const bytes = await toPngBytes(item.dataUrl, size);
        files.push({ name: fileNameFor(item, index), data: bytes });
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
