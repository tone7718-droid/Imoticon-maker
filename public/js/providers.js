/**
 * 동일 출처 Cloudflare Worker API 어댑터.
 * 비밀키는 브라우저에 존재하지 않으며 Worker의 AI 바인딩만 사용한다.
 */
(function () {
  "use strict";

  const STYLE_PROMPTS = {
    "cute-sticker": "cute chibi sticker, thick bold outline, simple flat colors, glossy highlights",
    "soft-pastel": "soft pastel palette, gentle rounded forms, dreamy sticker illustration",
    "bold-cartoon": "bold cartoon style, saturated colors, expressive exaggerated features",
    "minimal-line": "minimal clean line-art sticker, restrained colors, elegant negative space",
    watercolor: "soft watercolor sticker illustration, warm tones and subtle paper texture",
  };

  let memoryClientId = null;

  function clientId() {
    const key = "imoticon-maker.anonymous-client-id";
    try {
      let id = localStorage.getItem(key);
      if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(key, id); // 비밀정보가 아닌 익명 할당량 식별자
      }
      return id;
    } catch (_) {
      memoryClientId ||= crypto.randomUUID();
      return memoryClientId;
    }
  }

  async function apiFetch(path, options = {}) {
    let response;
    try {
      response = await fetch(path, {
        ...options,
        headers: {
          "X-Client-Id": clientId(),
          ...(options.headers || {}),
        },
      });
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

  function buildImagePrompt(character, idea, styleKey, opts = {}) {
    const style = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS["cute-sticker"];
    const safeArea = idea.caption
      ? " Leave clean negative space near the bottom for a caption that will be added later."
      : "";

    if (opts.refMode === "frame") {
      return (
        `Use image 0 as the exact previous frame of a short looping messenger sticker. ` +
        `Keep the same character, colors, outline, camera, background, scale and position. ` +
        `Create frame ${opts.frameIndex + 1}; only change this motion: ${opts.frameDesc}. ` +
        `Do not draw text, letters, logos or watermarks.${safeArea}`
      );
    }

    const referenceRule = opts.refMode
      ? " Use image 0 as the canonical character reference and preserve its identity exactly."
      : "";
    return (
      `One centered messenger emoticon sticker on a plain pure white background. ` +
      `Character identity: ${character}.${referenceRule} ` +
      `Scene and emotion: ${idea.scene}. Art style: ${style}. ` +
      `Square composition, full character visible, bold readable silhouette, no border. ` +
      `Do not draw text, letters, logos or watermarks.${safeArea}`
    );
  }

  function buildCanonicalPrompt(character, styleKey) {
    const style = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS["cute-sticker"];
    return (
      `Create a canonical character reference image for a messenger sticker set. ` +
      `Character: ${character}. Neutral friendly standing pose, front three-quarter view, ` +
      `full body centered, plain pure white background. Art style: ${style}. ` +
      `Clear distinctive colors, markings and accessories. No text, letters, logos or watermark.`
    );
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

    async generateImage(prompt, { signal, reference } = {}) {
      const form = new FormData();
      form.append("prompt", prompt);
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
  window.PromptBuilder = { buildCanonicalPrompt, buildImagePrompt };
})();
