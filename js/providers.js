/**
 * AI 제공자 어댑터 — 브라우저에서 각 AI API를 직접 호출한다.
 * 각 어댑터는 두 가지 기능을 제공한다:
 *   plan(apiKey, opts)          : 사용자 설명 → 캐릭터 시트 + 이모티콘 아이디어 목록 (JSON)
 *   generateImage(apiKey, p)    : 이미지 프롬프트 → dataURL
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

  function buildPlanPrompt(description, count, captionMode) {
    const captionRule =
      captionMode === "korean"
        ? '각 아이디어에 이모티콘 안에 넣을 짧은 한글 문구(2~6글자)를 "caption"으로 넣어라.'
        : '"caption"은 항상 빈 문자열("")로 두어라.';
    return `너는 카카오톡/라인 이모티콘 세트를 기획하는 전문 디자이너다.
사용자의 요청을 바탕으로 이모티콘 ${count}개 세트를 기획하라.

사용자 요청: """${description}"""

규칙:
1. 먼저 캐릭터의 외형을 확정하라. 모든 이모티콘에서 완전히 동일한 캐릭터가 나오도록, 종/색상/무늬/체형/눈 모양/소품 등을 구체적인 영어 문장으로 묘사하라 ("character" 필드).
2. 일상 대화에서 실제로 자주 쓰이는 감정/상황(인사, 좋아요, 슬픔, 화남, 축하, 피곤, 사랑, 웃음, 놀람, 부탁 등)을 사용자 요청의 컨셉과 엮어 ${count}개의 서로 다른 장면을 만들어라.
3. 각 장면은 캐릭터의 표정과 감정이 강하게 드러나야 하며, 포즈/표정/효과(땀방울, 하트, 번개 등)를 영어로 묘사하라 ("scene" 필드).
4. "title"은 한국어 2~8글자의 짧은 이름이다 (파일명으로도 쓰인다).
5. ${captionRule}

아래 JSON 형식으로만 답하라. 다른 텍스트는 절대 포함하지 마라:
{"character": "...", "ideas": [{"title": "...", "scene": "...", "caption": "..."}]}`;
  }

  function buildImagePrompt(character, idea, styleKey) {
    const style = STYLE_PROMPTS[styleKey] || STYLE_PROMPTS["cute-sticker"];
    const caption = idea.caption
      ? ` Include short Korean text "${idea.caption}" in a cute hand-lettered style near the character.`
      : " Do not include any text or letters in the image.";
    return (
      `A single messenger emoticon sticker of one character, centered on a plain pure white background. ` +
      `Character (must look identical in every sticker): ${character}. ` +
      `Scene and emotion: ${idea.scene}. ` +
      `Art style: ${style}. ` +
      `Square composition, the character fills most of the frame, no border, no watermark.` +
      caption
    );
  }

  /** fetch + 오류메시지 추출 + 429/5xx 재시도 */
  async function fetchWithRetry(url, options, { retries = 3, signal } = {}) {
    let delay = 2000;
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { ...options, signal });
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

    async plan(apiKey, { description, count, captionMode }, signal) {
      const res = await fetchWithRetry(
        `${GEMINI_BASE}/gemini-2.5-flash:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: buildPlanPrompt(description, count, captionMode) }] }],
            generationConfig: { responseMimeType: "application/json", temperature: 0.9 },
          }),
        },
        { signal }
      );
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
      return parsePlanJson(text);
    },

    async generateImage(apiKey, prompt, signal) {
      const res = await fetchWithRetry(
        `${GEMINI_BASE}/gemini-2.5-flash-image:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": apiKey,
          },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"] },
          }),
        },
        { signal }
      );
      const data = await res.json();
      const parts = data.candidates?.[0]?.content?.parts || [];
      const imgPart = parts.find((p) => p.inlineData?.data);
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

    async plan(apiKey, { description, count, captionMode }, signal) {
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
            messages: [
              { role: "user", content: buildPlanPrompt(description, count, captionMode) },
            ],
          }),
        },
        { signal }
      );
      const data = await res.json();
      return parsePlanJson(data.choices?.[0]?.message?.content || "");
    },

    async generateImage(apiKey, prompt, signal) {
      // gpt-image-1 우선, 조직 미인증 등으로 실패하면 dall-e-3로 대체
      try {
        return await this._image(apiKey, prompt, "gpt-image-1", signal);
      } catch (err) {
        if (err.name === "AbortError") throw err;
        if (/403|verif|not.*allowed|does not have access|invalid.*model/i.test(err.message)) {
          return await this._image(apiKey, prompt, "dall-e-3", signal);
        }
        throw err;
      }
    },

    async _image(apiKey, prompt, model, signal) {
      const body = { model, prompt, n: 1, size: "1024x1024" };
      if (model === "gpt-image-1") {
        body.quality = "medium";
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
      const data = await res.json();
      const item = data.data?.[0];
      if (item?.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item?.url) return item.url; // dall-e-3가 URL만 반환하는 경우
      throw new Error("이미지 생성 실패: 응답에 이미지가 없어요.");
    },
  };

  window.Providers = { gemini, openai };
  window.PromptBuilder = { buildImagePrompt };
})();
