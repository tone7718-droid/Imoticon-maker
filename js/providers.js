/**
 * AI 제공자 어댑터 — 브라우저에서 각 AI API를 직접 호출한다.
 * 각 어댑터는 두 가지 기능을 제공한다:
 *   plan(apiKey, opts, signal)            : 사용자 설명(+참조 이미지) → 캐릭터 시트 + 아이디어 목록 (JSON)
 *   generateImage(apiKey, prompt, opts)   : 이미지 프롬프트(+참조 이미지) → dataURL
 * opts.reference = { mimeType, base64 } (선택), opts.transparent = boolean (선택)
 */
(function () {
  "use strict";

  const STYLE_PROMPTS = {
    "cute-sticker":
      "cute chibi sticker style, thick bold outlines, simple flat colors, glossy highlights",
    "soft-pastel":
      "soft pastel color palette, gentle rounded shapes, dreamy sticker illustration",
    "bold-cartoon":
      "bold cartoon style, saturated colors, expressive exaggerated features",
    "minimal-line":
      "minimal line art sticker, thin clean strokes, mostly white with small color accents",
    watercolor:
      "soft watercolor illustration sticker, light brush textures, warm tones",
  };

  function buildPlanPrompt({ description, count, captionMode, animated, hasReference }) {
    const captionRule =
      captionMode === "korean"
        ? '각 아이디어에 이모티콘 안에 넣을 짧은 한글 문구(2~6글자)를 "caption"으로 넣어라.'
        : '"caption"은 항상 빈 문자열("")로 두어라.';
    const referenceRule = hasReference
      ? '\n0. 첨부된 참조 이미지 속 캐릭터를 그대로 사용하라. "character" 필드에는 참조 이미지 캐릭터의 종/색상/무늬/체형/눈 모양/소품을 최대한 정확하게 영어로 묘사하라.'
      : "";
    const animatedRule = animated
      ? '\n6. 각 아이디어에 "frames" 배열로 프레임 묘사(영어) 정확히 4개를 넣어라. 프레임 1은 기본 포즈이고, 2~4는 같은 장면을 반복 재생했을 때 자연스러운 미세한 움직임(들썩임, 눈 깜빡임, 땀방울이 떨어짐, 팔 흔들기 등)이다. 배경/구도/캐릭터 크기와 위치는 모든 프레임에서 동일해야 한다.'
      : "";
    const framesField = animated ? ', "frames": ["...", "...", "...", "..."]' : "";
    return `너는 카카오톡/라인 이모티콘 세트를 기획하는 전문 디자이너다.
사용자의 요청을 바탕으로 이모티콘 ${count}개 세트를 기획하라.

사용자 요청: """${description}"""

규칙:${referenceRule}
1. 먼저 캐릭터의 외형을 확정하라. 모든 이모티콘에서 완전히 동일한 캐릭터가 나오도록, 종/색상/무늬/체형/눈 모양/소품 등을 구체적인 영어 문장으로 묘사하라 ("character" 필드).
2. 일상 대화에서 실제로 자주 쓰이는 감정/상황(인사, 좋아요, 슬픔, 화남, 축하, 피곤, 사랑, 웃음, 놀람, 부탁 등)을 사용자 요청의 컨셉과 엮어 ${count}개의 서로 다른 장면을 만들어라.
3. 각 장면은 캐릭터의 표정과 감정이 강하게 드러나야 하며, 포즈/표정/효과(땀방울, 하트, 번개 등)를 영어로 묘사하라 ("scene" 필드).
4. "title"은 한국어 2~8글자의 짧은 이름이다 (파일명으로도 쓰인다).
5. ${captionRule}${animatedRule}

아래 JSON 형식으로만 답하라. 다른 텍스트는 절대 포함하지 마라:
{"character": "...", "ideas": [{"title": "...", "scene": "...", "caption": "..."${framesField}}]}`;
  }

  /**
   * 이미지 프롬프트 생성.
   * opts.frameDesc  : 애니메이션 프레임 묘사 (선택)
   * opts.frameIndex : 0부터 시작하는 프레임 번호
   * opts.refMode    : "user"(사용자 참조 이미지) | "frame"(이전 프레임 참조) | null
   */
  function buildImagePrompt(character, idea, styleKey, opts = {}) {
    const style = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS["cute-sticker"];
    const caption = idea.caption
      ? ` Include short Korean text "${idea.caption}" in a cute hand-lettered style near the character.`
      : " Do not include any text or letters in the image.";

    if (opts.refMode === "frame") {
      // 프레임 1 이미지를 참조로 다음 프레임을 그리는 경우
      return (
        `The reference image is frame 1 of a short looping sticker animation. ` +
        `Draw frame ${opts.frameIndex + 1} with the exact same character, art style, colors, ` +
        `background, framing, character size and position. ` +
        `The only change from the reference: ${opts.frameDesc}.` +
        caption
      );
    }

    const refNote =
      opts.refMode === "user"
        ? " Match the character design in the reference image exactly (same species, colors, markings, proportions and accessories)."
        : "";
    const frameNote = opts.frameDesc
      ? ` This is frame ${(opts.frameIndex || 0) + 1} of a short looping sticker animation; keep the background, framing and character position identical across frames. Pose for this frame: ${opts.frameDesc}.`
      : "";
    return (
      `A single messenger emoticon sticker of one character, centered on a plain pure white background. ` +
      `Character (must look identical in every sticker): ${character}.` +
      refNote +
      ` Scene and emotion: ${idea.scene}. ` +
      `Art style: ${style}. ` +
      `Square composition, the character fills most of the frame, no border, no watermark.` +
      caption +
      frameNote
    );
  }

  /** fetch + 오류메시지 추출 + 429/5xx 재시도 */
  async function fetchWithRetry(url, options, { retries = 3, signal } = {}) {
    let delay = 2000;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { ...options, signal });
      } catch (err) {
        if (err.name === "AbortError") throw err;
        // CORS 차단 또는 네트워크 단절 — fetch는 상세 이유를 숨기므로 안내를 덧붙인다
        throw new Error(
          "네트워크 오류: API에 연결할 수 없어요. 인터넷 연결을 확인해 주세요. " +
          "(이 API 제공자가 브라우저 직접 호출(CORS)을 막는 환경일 수도 있어요)"
        );
      }
      if (res.ok) return res;
      const retriable = res.status === 429 || res.status >= 500;
      const body = await res.text().catch(() => "");
      if (!retriable || attempt >= retries) {
        let msg = body;
        try {
          const j = JSON.parse(body);
          msg = j.error?.message || j.message || body;
        } catch (_) { /* 본문이 JSON이 아니면 원문 사용 */ }
        throw new Error(`API 오류 (${res.status}): ${String(msg).slice(0, 300)}`);
      }
      await new Promise((r) => {
        const t = setTimeout(r, delay);
        signal?.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
      });
      if (signal?.aborted) throw new DOMException("중단됨", "AbortError");
      delay *= 2;
    }
  }

  function parsePlanJson(text) {
    // 모델이 코드블록으로 감싸는 경우 대비
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end < 0) throw new Error("AI가 올바른 JSON 기획안을 반환하지 않았어요.");
    const plan = JSON.parse(cleaned.slice(start, end + 1));
    if (!plan.character || !Array.isArray(plan.ideas) || plan.ideas.length === 0) {
      throw new Error("AI 기획안에 캐릭터 또는 아이디어가 없어요.");
    }
    return plan;
  }

  /* ---------------- Google Gemini ---------------- */

  const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

  const gemini = {
    label: "Google Gemini",
    supportsReference: true, // 이미지 생성에 참조 이미지 입력 가능

    async plan(apiKey, opts, signal) {
      const parts = [];
      if (opts.reference) {
        parts.push({ inlineData: { mimeType: opts.reference.mimeType, data: opts.reference.base64 } });
      }
      parts.push({ text: buildPlanPrompt({ ...opts, hasReference: !!opts.reference }) });
      const res = await fetchWithRetry(
        `${GEMINI_BASE}/gemini-2.5-flash:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
          }),
        },
        { signal }
      );
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      return parsePlanJson(text);
    },

    async generateImage(apiKey, prompt, { signal, reference } = {}) {
      const parts = [];
      if (reference) {
        parts.push({ inlineData: { mimeType: reference.mimeType, data: reference.base64 } });
      }
      parts.push({ text: prompt });
      const res = await fetchWithRetry(
        `${GEMINI_BASE}/gemini-2.5-flash-image:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
        },
        { signal }
      );
      const data = await res.json();
      const outParts = data.candidates?.[0]?.content?.parts || [];
      const imgPart = outParts.find((p) => p.inlineData?.data);
      if (!imgPart) {
        const reason = data.candidates?.[0]?.finishReason || "이미지 없음";
        throw new Error(`이미지 생성 실패 (${reason})`);
      }
      return `data:${imgPart.inlineData.mimeType || "image/png"};base64,${imgPart.inlineData.data}`;
    },
  };

  /* ---------------- OpenAI ---------------- */

  const OPENAI_BASE = "https://api.openai.com/v1";

  const openai = {
    label: "OpenAI",
    supportsReference: true, // images/edits로 참조 이미지 입력 가능

    async plan(apiKey, opts, signal) {
      const content = [];
      content.push({ type: "text", text: buildPlanPrompt({ ...opts, hasReference: !!opts.reference }) });
      if (opts.reference) {
        content.push({
          type: "image_url",
          image_url: { url: `data:${opts.reference.mimeType};base64,${opts.reference.base64}` },
        });
      }
      const res = await fetchWithRetry(
        `${OPENAI_BASE}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            temperature: 0.9,
            response_format: { type: "json_object" },
            messages: [{ role: "user", content }],
          }),
        },
        { signal }
      );
      const data = await res.json();
      return parsePlanJson(data.choices?.[0]?.message?.content || "");
    },

    async generateImage(apiKey, prompt, { signal, reference, transparent } = {}) {
      // 참조 이미지가 있으면 gpt-image-1 편집(edits) API 사용
      if (reference) {
        try {
          return await this._edit(apiKey, prompt, reference, transparent, signal);
        } catch (err) {
          if (err.name === "AbortError") throw err;
          // 편집 API 권한이 없으면 참조 없이 일반 생성으로 대체
        }
      }
      try {
        return await this._image(apiKey, prompt, "gpt-image-1", transparent, signal);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (/403|verif|not.*allowed|does not have access|invalid.*model/i.test(err.message)) {
          return await this._image(apiKey, prompt, "dall-e-3", false, signal);
        }
        throw err;
      }
    },

    async _image(apiKey, prompt, model, transparent, signal) {
      const body = { model, prompt, n: 1, size: "1024x1024" };
      if (model === "gpt-image-1") {
        body.quality = "medium";
        if (transparent) {
          body.background = "transparent";
          body.output_format = "png";
        }
      } else {
        body.response_format = "b64_json";
      }
      const res = await fetchWithRetry(
        `${OPENAI_BASE}/images/generations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        },
        { signal }
      );
      return this._extract(await res.json());
    },

    async _edit(apiKey, prompt, reference, transparent, signal) {
      const form = new FormData();
      form.append("model", "gpt-image-1");
      form.append("prompt", prompt);
      form.append("size", "1024x1024");
      form.append("quality", "medium");
      if (transparent) form.append("background", "transparent");
      const blob = window.ImageProc.dataUrlToBlob(
        `data:${reference.mimeType};base64,${reference.base64}`
      );
      form.append("image[]", blob, "reference.png");
      const res = await fetchWithRetry(
        `${OPENAI_BASE}/images/edits`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}` },
          body: form,
        },
        { signal }
      );
      return this._extract(await res.json());
    },

    _extract(data) {
      const item = data.data?.[0];
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item?.url) return item.url; // dall-e-3가 URL만 반환하는 경우
      throw new Error("이미지 생성 실패: 응답에 이미지가 없어요.");
    },
  };

  /* ---------------- xAI Grok ---------------- */

  const XAI_BASE = "https://api.x.ai/v1";

  const xai = {
    label: "xAI Grok",
    // grok-2-image는 이미지 입력을 받지 않는다 → 참조 이미지는 기획(비전) 단계에만 반영되고,
    // 애니메이션 프레임도 이전 프레임 참조 없이 텍스트만으로 그린다 (일관성이 다소 낮음).
    supportsReference: false,

    async plan(apiKey, opts, signal) {
      try {
        return await this._plan(apiKey, opts, signal, "grok-4-fast-non-reasoning", true);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (/model|not found|does not exist|invalid/i.test(err.message)) {
          // 구형 계정/모델명 변경 대비: 텍스트 전용 모델로 대체 (참조 이미지는 무시됨)
          return await this._plan(apiKey, opts, signal, "grok-3-mini", false);
        }
        throw err;
      }
    },

    async _plan(apiKey, opts, signal, model, vision) {
      const content = [
        { type: "text", text: buildPlanPrompt({ ...opts, hasReference: vision && !!opts.reference }) },
      ];
      if (vision && opts.reference) {
        content.push({
          type: "image_url",
          image_url: { url: `data:${opts.reference.mimeType};base64,${opts.reference.base64}` },
        });
      }
      const res = await fetchWithRetry(
        `${XAI_BASE}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.9,
            messages: [{ role: "user", content }],
          }),
        },
        { signal }
      );
      const data = await res.json();
      return parsePlanJson(data.choices?.[0]?.message?.content || "");
    },

    async generateImage(apiKey, prompt, { signal } = {}) {
      // grok-2-image는 size/quality/배경 옵션이 없다 → 투명화는 클라이언트에서 처리
      const res = await fetchWithRetry(
        `${XAI_BASE}/images/generations`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "grok-2-image",
            prompt,
            n: 1,
            response_format: "b64_json",
          }),
        },
        { signal }
      );
      const data = await res.json();
      const item = data.data?.[0];
      if (item?.b64_json) return `data:image/jpeg;base64,${item.b64_json}`;
      if (item?.url) return item.url;
      throw new Error("이미지 생성 실패: 응답에 이미지가 없어요.");
    },
  };

  window.Providers = { gemini, openai, xai };
  window.PromptBuilder = { buildImagePrompt };
})();
