/** 이모티콘 생성 파이프라인과 검증된 플랫폼별 내보내기. */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const els = {
    serviceStatus: $("#service-status"),
    serviceDetail: $("#service-detail"),
    description: $("#description"),
    refFile: $("#ref-file"),
    refPick: $("#ref-pick"),
    refPreview: $("#ref-preview"),
    refImg: $("#ref-img"),
    refRemove: $("#ref-remove"),
    platform: $("#platform"),
    count: $("#count"),
    style: $("#style"),
    captionMode: $("#caption-mode"),
    format: $("#format"),
    transparentBg: $("#transparent-bg"),
    usageEstimate: $("#usage-estimate"),
    usageNote: $("#usage-note"),
    generateBtn: $("#generate-btn"),
    sectionProgress: $("#section-progress"),
    progressFill: $("#progress-fill"),
    progressBar: $(".progress-bar"),
    progressText: $("#progress-text"),
    cancelBtn: $("#cancel-btn"),
    sectionResults: $("#section-results"),
    characterSummary: $("#character-summary"),
    validationSummary: $("#validation-summary"),
    exportProfile: $("#export-profile"),
    resultsGrid: $("#results-grid"),
    downloadAllBtn: $("#download-all-btn"),
  };

  const provider = window.Providers.cloudflare;
  const CONCURRENCY = 2;
  const AI_FRAME_DESCRIPTIONS = [
    "the base pose at the start of the motion",
    "a subtle upward bounce with a small anticipation movement",
    "the peak of the bounce with a natural expressive reaction",
    "settling back down with a slight secondary motion",
    "a small overshoot in the opposite direction",
    "returning seamlessly to the exact base pose",
  ];
  const FORMAT_LABELS = {
    static: "정지 PNG",
    "animated-local": "로컬 애니메이션 (무료·6프레임)",
    "animated-ai": "AI 애니메이션 (6배 사용량)",
  };

  let serviceConfig = null;
  let abortController = null;
  let referenceImage = null; // { mimeType, base64, dataUrl }
  let session = null;

  els.refPick.addEventListener("click", () => els.refFile.click());
  els.refFile.addEventListener("change", onReferenceSelected);
  els.refRemove.addEventListener("click", removeReference);
  els.platform.addEventListener("change", () => {
    applyProfileOptions();
    updateEstimate();
  });
  els.count.addEventListener("change", updateEstimate);
  els.format.addEventListener("change", updateEstimate);
  els.transparentBg.addEventListener("change", updateEstimate);
  els.generateBtn.addEventListener("click", startGeneration);
  els.cancelBtn.addEventListener("click", () => abortController?.abort());
  els.downloadAllBtn.addEventListener("click", downloadAllAsZip);
  window.addEventListener("beforeunload", cleanupSession);

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      els.description.value =
        `${chip.textContent} 캐릭터를 기반으로 일상 대화에 자주 쓰는 이모티콘을 만들어줘. ` +
        "상황별 표정과 감정이 한눈에 느껴지게 해줘.";
      els.description.focus();
    });
  });

  applyProfileOptions();
  updateEstimate();
  initializeService();

  async function initializeService() {
    try {
      serviceConfig = await provider.config();
      els.serviceStatus.classList.add("ready");
      els.serviceStatus.querySelector("span:last-child").textContent = "무료 AI Worker 연결됨";
      els.serviceDetail.textContent =
        `기획: ${serviceConfig.plannerModel} · 이미지: ${serviceConfig.imageModel} · ` +
        `익명 사용자별 하루 이미지 ${serviceConfig.dailyLimits.images}장`;
      els.generateBtn.disabled = false;
      updateEstimate();
    } catch (error) {
      els.serviceStatus.classList.add("error");
      els.serviceStatus.querySelector("span:last-child").textContent = "Worker에 연결할 수 없어요";
      els.serviceDetail.textContent = `${error.message} 로컬에서는 npx wrangler dev로 실행해야 해요.`;
    }
  }

  function applyProfileOptions() {
    const profile = currentProfile();
    const previousCount = Number(els.count.value);
    const previousFormat = els.format.value;
    replaceOptions(els.count, profile.counts.map((count) => ({ value: count, label: `${count}개` })));
    replaceOptions(
      els.format,
      profile.formats.map((format) => ({ value: format, label: FORMAT_LABELS[format] }))
    );
    if (profile.counts.includes(previousCount)) els.count.value = String(previousCount);
    if (profile.formats.includes(previousFormat)) els.format.value = previousFormat;
  }

  function replaceOptions(select, options) {
    select.replaceChildren(...options.map(({ value, label }) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = label;
      return option;
    }));
  }

  function currentProfile() {
    return window.ExportProfiles.get(els.platform.value);
  }

  function currentEstimate() {
    return window.ExportProfiles.estimate({
      count: Number(els.count.value || currentProfile().counts[0]),
      format: els.format.value || currentProfile().formats[0],
      hasReference: !!referenceImage,
    });
  }

  function updateEstimate() {
    const estimate = currentEstimate();
    const dailyLimit = serviceConfig?.dailyLimits?.images || 80;
    els.usageEstimate.textContent =
      `AI 이미지 ${estimate.imageCalls}장 · 약 ${estimate.neurons.toLocaleString()} Neurons ` +
      `(익명 일일 한도 ${dailyLimit}장)`;
    const overLimit = estimate.imageCalls > dailyLimit;
    els.usageNote.textContent = overLimit
      ? "현재 선택은 익명 일일 이미지 한도를 초과합니다. 개수나 형식을 줄여 주세요."
      : els.format.value === "animated-ai"
        ? "AI 애니메이션은 컷마다 6장을 생성합니다. 시작 전에 한 번 더 확인해요."
        : els.format.value === "animated-local"
          ? "로컬 애니메이션은 컷마다 AI 이미지 한 장만 사용하고 브라우저에서 6프레임을 만듭니다."
          : "참조 이미지가 없으면 캐릭터 기준 이미지 한 장이 사용량에 포함됩니다.";
  }

  async function onReferenceSelected() {
    const file = els.refFile.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await window.ImageProc.normalizeUpload(file, 511);
      const { mimeType, base64 } = window.ImageProc.dataUrlToParts(dataUrl);
      referenceImage = { mimeType, base64, dataUrl };
      els.refImg.src = dataUrl;
      els.refPreview.hidden = false;
      els.refPick.textContent = "🖼 다른 이미지로 바꾸기";
      updateEstimate();
    } catch (error) {
      alert(`이미지를 불러올 수 없어요: ${error.message}`);
    }
  }

  function removeReference() {
    referenceImage = null;
    els.refFile.value = "";
    els.refPreview.hidden = true;
    els.refImg.removeAttribute("src");
    els.refPick.textContent = "🖼 이미지 올리기";
    updateEstimate();
  }

  async function startGeneration() {
    if (!serviceConfig) return alert("무료 AI Worker 연결을 먼저 확인해 주세요.");
    const description = els.description.value.trim();
    if (!description) return alert("어떤 이모티콘을 만들지 설명을 입력해 주세요.");

    const profileKey = els.platform.value;
    const profile = currentProfile();
    const count = Number(els.count.value);
    const format = els.format.value;
    const selectionIssues = window.ExportProfiles.validateSelection(profileKey, count, format);
    if (selectionIssues.length) return alert(selectionIssues.join("\n"));

    const estimate = currentEstimate();
    if (estimate.imageCalls > serviceConfig.dailyLimits.images) {
      return alert(`예상 이미지 ${estimate.imageCalls}장이 일일 한도를 초과해요. 개수나 형식을 줄여 주세요.`);
    }
    if (format === "animated-ai") {
      const approved = confirm(
        `AI 이미지 ${estimate.imageCalls}장을 사용해 약 ${estimate.neurons.toLocaleString()} Neurons가 예상됩니다. 계속할까요?`
      );
      if (!approved) return;
    }

    cleanupSession();
    abortController = new AbortController();
    const signal = abortController.signal;
    els.generateBtn.disabled = true;
    els.sectionProgress.hidden = false;
    els.sectionResults.hidden = true;
    els.resultsGrid.replaceChildren();
    setProgress(0, "이모티콘 세트를 기획하고 있어요…");

    try {
      const plan = await provider.plan({
        description,
        count,
        captionMode: els.captionMode.value,
      }, signal);

      session = {
        provider,
        profileKey,
        profile,
        character: plan.character,
        styleKey: els.style.value,
        format,
        transparent: els.transparentBg.checked,
        reference: referenceImage
          ? { mimeType: referenceImage.mimeType, base64: referenceImage.base64 }
          : null,
        items: plan.ideas.slice(0, count).map((idea) => ({
          idea,
          status: "pending",
          dataUrl: null,
          frames: null,
          error: null,
          card: null,
          ownedUrls: new Set(),
        })),
      };

      let completedImages = 0;
      const totalImages = estimate.imageCalls;
      const onImage = (message) => {
        completedImages += 1;
        const percent = 8 + Math.round((completedImages / totalImages) * 90);
        setProgress(percent, `${message} (${completedImages}/${totalImages}장)`);
      };

      if (!session.reference) {
        setProgress(5, "세트 전체에 사용할 캐릭터 기준 이미지를 만들고 있어요…");
        session.reference = await createCanonicalReference(signal);
        onImage("캐릭터 기준 이미지 완성");
      }

      els.characterSummary.textContent = `캐릭터 설정: ${plan.character}`;
      els.exportProfile.textContent =
        `${profile.label} · ${profile.width}×${profile.height} · ${count}개`;
      setValidationSummary("생성 후 파일 크기와 프레임 규격을 다시 검사합니다.", "");
      els.sectionResults.hidden = false;
      session.items.forEach((item, index) => {
        item.card = createCard(item, index);
        els.resultsGrid.appendChild(item.card);
      });

      const queue = session.items.map((item, index) => ({ item, index }));
      const workers = Array.from({ length: CONCURRENCY }, async () => {
        while (queue.length && !signal.aborted) {
          const next = queue.shift();
          await generateOne(next.item, next.index, signal, onImage);
        }
      });
      await Promise.all(workers);
      if (signal.aborted) throw new DOMException("중단됨", "AbortError");

      const failed = session.items.filter((item) => item.status === "error").length;
      setProgress(100, failed
        ? `완료했지만 ${failed}개가 실패했어요. 카드에서 다시 시도할 수 있어요.`
        : "모든 이모티콘이 완성됐어요! 🎉");
      setValidationSummary(
        failed ? `실패한 ${failed}개를 재생성한 뒤 ZIP 검증을 진행해 주세요.` : "세트 개수와 기본 형식이 선택한 프로필과 일치합니다.",
        failed ? "warning" : ""
      );
    } catch (error) {
      if (error.name === "AbortError") {
        setProgress(0, "생성을 중단했어요. 중단 이후에는 추가 이미지 요청을 보내지 않습니다.");
        setValidationSummary("생성이 중단되어 일부 결과만 남아 있어요.", "warning");
      } else {
        setProgress(0, `오류: ${error.message}`);
        alert(`생성 중 오류가 발생했어요.\n\n${error.message}`);
      }
    } finally {
      abortController = null;
      els.generateBtn.disabled = !serviceConfig;
    }
  }

  async function createCanonicalReference(signal) {
    const prompt = window.PromptBuilder.buildCanonicalPrompt(session.character, session.styleKey);
    let image = await provider.generateImage(prompt, { signal });
    if (session.transparent) image = await window.ImageProc.removeWhiteBackground(image).catch(() => image);
    const normalized = await window.ImageProc.normalizeReference(image, 511);
    return window.ImageProc.dataUrlToParts(normalized);
  }

  async function generateOne(item, index, signal, onImage) {
    releaseItemUrls(item);
    item.status = "loading";
    item.error = null;
    updateCard(item, index);
    try {
      if (session.format === "static") {
        const art = await generateArt(item, signal, session.reference, {});
        onImage?.("정지 이모티콘 생성 중");
        const finished = await window.ImageProc.applyCaption(art, item.idea.caption);
        item.dataUrl = trackUrl(item, await window.ImageProc.dataUrlToObjectUrl(finished));
      } else if (session.format === "animated-local") {
        const art = await generateArt(item, signal, session.reference, {});
        onImage?.("애니메이션 원화 생성 중");
        const finished = await window.ImageProc.applyCaption(art, item.idea.caption);
        item.frames = await window.ImageProc.makeTransformFrames(
          finished,
          session.profile.animated?.frameCount || 6
        );
        item.frames.forEach((url) => trackUrl(item, url));
        item.dataUrl = trackUrl(item, await assembleApngUrl(item.frames));
      } else {
        await generateAiAnimation(item, signal, onImage);
      }
      item.status = "done";
    } catch (error) {
      if (error.name === "AbortError") {
        item.status = "pending";
        updateCard(item, index);
        throw error;
      }
      releaseItemUrls(item);
      item.status = "error";
      item.error = error.message;
    }
    updateCard(item, index);
  }

  async function generateAiAnimation(item, signal, onImage) {
    const rawFrames = [];
    let frameReference = session.reference;
    for (let index = 0; index < AI_FRAME_DESCRIPTIONS.length; index++) {
      if (signal.aborted) throw new DOMException("중단됨", "AbortError");
      const art = await generateArt(item, signal, frameReference, {
        frameDesc: AI_FRAME_DESCRIPTIONS[index],
        frameIndex: index,
        refMode: index === 0 ? "user" : "frame",
      });
      if (index === 0) {
        const normalized = await window.ImageProc.normalizeReference(art, 511);
        frameReference = window.ImageProc.dataUrlToParts(normalized);
      }
      rawFrames.push(await window.ImageProc.applyCaption(art, item.idea.caption));
      onImage?.("AI 애니메이션 프레임 생성 중");
    }
    item.frames = [];
    for (const frame of rawFrames) {
      item.frames.push(trackUrl(item, await window.ImageProc.dataUrlToObjectUrl(frame)));
    }
    item.dataUrl = trackUrl(item, await assembleApngUrl(item.frames));
  }

  async function generateArt(item, signal, reference, options) {
    const prompt = window.PromptBuilder.buildImagePrompt(
      session.character,
      item.idea,
      session.styleKey,
      {
        frameDesc: options.frameDesc,
        frameIndex: options.frameIndex ?? 0,
        refMode: options.refMode || (reference ? "user" : null),
      }
    );
    let image = await provider.generateImage(prompt, { signal, reference });
    if (session.transparent) image = await window.ImageProc.removeWhiteBackground(image).catch(() => image);
    return image;
  }

  async function assembleApngUrl(frames) {
    const previewSize = { width: 360, height: 360, fit: "contain" };
    const pngFrames = [];
    for (const frame of frames) pngFrames.push(await window.ImageProc.toPngBytes(frame, previewSize));
    const bytes = window.makeApng(pngFrames, 150, 0);
    return URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  }

  function createCard(item, index) {
    const card = document.createElement("article");
    card.className = "emoji-card";
    card.innerHTML = '<div class="img-wrap"></div><div class="title"></div><div class="card-actions"></div>';
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
    const imageWrap = card.querySelector(".img-wrap");
    const actions = card.querySelector(".card-actions");
    imageWrap.replaceChildren();
    actions.replaceChildren();

    if (item.status === "done" && item.dataUrl) {
      const img = document.createElement("img");
      img.src = item.dataUrl;
      img.alt = item.idea.title;
      imageWrap.appendChild(img);

      const download = document.createElement("button");
      download.textContent = item.frames ? "⬇ APNG" : "⬇ PNG";
      download.addEventListener("click", () => downloadOne(item, index));
      const regenerate = document.createElement("button");
      regenerate.textContent = "🔄 다시";
      regenerate.addEventListener("click", () => regenerateOne(item, index));
      actions.append(download, regenerate);
    } else if (item.status === "error") {
      const message = document.createElement("div");
      message.className = "error-msg";
      message.textContent = item.error || "생성 실패";
      imageWrap.appendChild(message);
      const retry = document.createElement("button");
      retry.textContent = "🔄 다시 시도";
      retry.addEventListener("click", () => regenerateOne(item, index));
      actions.appendChild(retry);
    }
  }

  async function regenerateOne(item, index) {
    if (!session || item.status === "loading") return;
    const controller = new AbortController();
    await generateOne(item, index, controller.signal);
  }

  async function downloadOne(item, index) {
    try {
      let bytes;
      if (item.frames) {
        bytes = await buildApngBytes(item);
      } else {
        bytes = await buildPngBytes(item);
      }
      const issues = window.ExportProfiles.validateFile(
        session.profileKey,
        bytes.length,
        item.frames?.length || 0
      );
      if (issues.length) throw new Error(issues.join(" "));
      saveBlob(new Blob([bytes], { type: "image/png" }), fileNameFor(item, index, "png"));
    } catch (error) {
      alert(`저장 전 규격 검사 실패: ${error.message}`);
    }
  }

  async function buildPngBytes(item) {
    return await window.ImageProc.toPngBytes(item.dataUrl, {
      width: session.profile.width,
      height: session.profile.height,
      fit: "contain",
    });
  }

  async function buildApngBytes(item) {
    const pngFrames = [];
    const options = {
      width: session.profile.width,
      height: session.profile.height,
      fit: "contain",
    };
    for (const frame of item.frames) pngFrames.push(await window.ImageProc.toPngBytes(frame, options));
    const animation = session.profile.animated || { delayMs: 150, plays: 0 };
    return window.makeApng(pngFrames, animation.delayMs, animation.plays);
  }

  async function buildGifBytes(item) {
    const imageData = [];
    const options = {
      width: session.profile.width,
      height: session.profile.height,
      fit: "contain",
    };
    for (const frame of item.frames) imageData.push(await window.ImageProc.toImageData(frame, options));
    return window.makeGif(imageData, session.profile.animated?.delayMs || 150);
  }

  async function downloadAllAsZip() {
    if (!session) return;
    const completed = session.items
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status === "done" && item.dataUrl);
    if (completed.length !== session.items.length) {
      return alert("세트의 모든 이모티콘을 완성한 뒤 다운로드해 주세요.");
    }

    els.downloadAllBtn.disabled = true;
    els.downloadAllBtn.textContent = "검증하고 묶는 중…";
    try {
      const files = [];
      const validation = [];
      for (const { item, index } of completed) {
        if (item.frames) {
          const apng = await buildApngBytes(item);
          const issues = window.ExportProfiles.validateFile(session.profileKey, apng.length, item.frames.length);
          validation.push(...issues.map((message) => `${index + 1}번: ${message}`));
          files.push({ name: fileNameFor(item, index, "png"), data: apng });
          if (session.profileKey === "generic") {
            files.push({ name: fileNameFor(item, index, "gif"), data: await buildGifBytes(item) });
          }
        } else {
          const png = await buildPngBytes(item);
          const issues = window.ExportProfiles.validateFile(session.profileKey, png.length, 0);
          validation.push(...issues.map((message) => `${index + 1}번: ${message}`));
          files.push({ name: fileNameFor(item, index, "png"), data: png });
        }
      }

      if (validation.length) {
        setValidationSummary(`규격 오류 ${validation.length}건: ${validation.slice(0, 3).join(" / ")}`, "error");
        throw new Error(validation.join("\n"));
      }

      const manifest = {
        generatedAt: new Date().toISOString(),
        profile: session.profileKey,
        size: `${session.profile.width}x${session.profile.height}`,
        count: completed.length,
        format: session.format,
        character: session.character,
        items: completed.map(({ item, index }) => ({ index: index + 1, title: item.idea.title })),
      };
      files.push({
        name: "manifest.json",
        data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)),
      });
      saveBlob(window.makeZip(files), `imoticons_${session.profileKey}.zip`);
      setValidationSummary("모든 파일이 선택한 플랫폼의 크기·용량·프레임 검사를 통과했어요.", "");
    } catch (error) {
      alert(`ZIP을 만들 수 없어요.\n\n${error.message}`);
    } finally {
      els.downloadAllBtn.disabled = false;
      els.downloadAllBtn.textContent = "⬇ 검증 후 ZIP 다운로드";
    }
  }

  function fileNameFor(item, index, extension) {
    const safe = String(item.idea.title || "imoticon")
      .replace(/[\\/:*?"<>|\s]+/g, "_")
      .slice(0, 30) || "imoticon";
    return `${String(index + 1).padStart(2, "0")}_${safe}.${extension}`;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function trackUrl(item, url) {
    item.ownedUrls.add(url);
    return url;
  }

  function releaseItemUrls(item) {
    for (const url of item.ownedUrls || []) URL.revokeObjectURL(url);
    item.ownedUrls?.clear();
    item.dataUrl = null;
    item.frames = null;
  }

  function cleanupSession() {
    if (!session) return;
    session.items.forEach(releaseItemUrls);
    session = null;
  }

  function setProgress(percent, text) {
    const safePercent = Math.max(0, Math.min(100, percent));
    els.progressFill.style.width = `${safePercent}%`;
    els.progressBar.setAttribute("aria-valuenow", String(safePercent));
    els.progressText.textContent = text;
  }

  function setValidationSummary(text, level) {
    els.validationSummary.textContent = text;
    els.validationSummary.className = `validation-summary${level ? ` ${level}` : ""}`;
  }
})();
