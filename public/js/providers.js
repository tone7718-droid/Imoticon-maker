/**
 * 동일 출처 Cloudflare Worker API 어댑터.
 * 비밀키는 브라우저에 존재하지 않으며 Worker의 AI 바인딩만 사용한다.
 */
(function () {
  "use strict";

  async function apiFetch(path, options = {}) {
    let response;
    try {
      response = await fetch(path, options);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      throw new Error("무료 AI Worker에 연결할 수 없어요. 배포 상태와 인터넷 연결을 확인해 주세요.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `Worker 오류 (${response.status})`);
      error.status = response.status;
      error.quota = data.quota;
      throw error;
    }
    return data;
  }

  const cloudflare = {
    label: "Cloudflare Workers AI",
    supportsReference: true,

    async config(signal) {
      return await apiFetch("/api/config", { signal });
    },

    async plan(opts, signal) {
      return await apiFetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: opts.description,
          count: opts.count,
          captionMode: opts.captionMode,
        }),
        signal,
      });
    },

    async generateImage(spec, { signal, reference } = {}) {
      const form = new FormData();
      form.append("mode", spec.mode);
      form.append("character", spec.character);
      form.append("scene", spec.scene || "");
      form.append("style", spec.styleKey || "cute-sticker");
      form.append("frameIndex", String(spec.frameIndex || 0));
      form.append("hasCaption", spec.hasCaption ? "1" : "0");
      if (reference) {
        const blob = window.ImageProc.dataUrlToBlob(
          `data:${reference.mimeType};base64,${reference.base64}`
        );
        form.append("reference", blob, "reference.png");
      }
      const data = await apiFetch("/api/image", { method: "POST", body: form, signal });
      return data.image;
    },
  };

  window.Providers = { cloudflare };
})();
