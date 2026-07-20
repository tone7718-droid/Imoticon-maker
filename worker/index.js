const PLANNER_MODEL = "@cf/google/gemma-4-26b-a4b-it";
const IMAGE_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";

const DAILY_LIMITS = Object.freeze({ plan: 12, image: 80 });
const MAX_DESCRIPTION_LENGTH = 1200;
const MAX_IMAGE_PROMPT_LENGTH = 4000;
const MAX_REFERENCE_BYTES = 2 * 1024 * 1024;
const ALLOWED_COUNTS = new Set([8, 10, 12, 15, 16, 24, 32]);
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

const FALLBACK_IDEAS = [
  ["안녕", "waves both hands with a bright welcoming smile"],
  ["좋아요", "gives an enthusiastic thumbs-up with sparkling eyes"],
  ["슬퍼", "sits with drooping shoulders and large tears rolling down"],
  ["화남", "crosses arms with puffed cheeks and a tiny anger symbol"],
  ["축하", "jumps with confetti and holds a small party popper"],
  ["피곤", "slumps sleepily with heavy eyelids and a floating yawn"],
  ["사랑해", "hugs a large heart with a warm affectionate expression"],
  ["웃겨", "laughs hard while holding their belly"],
  ["놀람", "gasps with wide eyes and both hands raised"],
  ["부탁", "clasps hands together with hopeful sparkling eyes"],
  ["고마워", "bows politely while smiling with a small heart"],
  ["미안해", "bows deeply with an apologetic worried expression"],
  ["응원", "raises a fist confidently with energetic sparkles"],
  ["대박", "celebrates with starry eyes and both arms in the air"],
  ["잘자", "curls up under a tiny blanket with a peaceful smile"],
  ["기다려", "holds one hand forward while hurrying to catch up"],
  ["최고", "holds up a trophy with a proud joyful expression"],
  ["멘붕", "freezes in confusion with spiraling eyes"],
  ["출근", "walks reluctantly while carrying a work bag"],
  ["퇴근", "runs home joyfully with arms spread wide"],
  ["배고파", "holds a rumbling stomach while imagining food"],
  ["졸려", "nods off while standing with a tiny sleep bubble"],
  ["신나", "dances excitedly with musical notes around them"],
  ["걱정", "fidgets nervously with a worried sweat drop"],
  ["오케이", "makes a clear OK hand sign with a confident smile"],
  ["싫어", "turns away firmly while making an X with both arms"],
  ["부끄", "hides a blushing face behind both hands"],
  ["집중", "leans forward with intense focus and a tiny flame"],
  ["파이팅", "pumps both fists with determined energy"],
  ["행복", "spins happily surrounded by flowers and sparkles"],
  ["당황", "looks around flustered with several sweat drops"],
  ["감동", "tears up happily while holding both hands to the chest"],
];

const SECURITY_HEADERS = Object.freeze({
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join("; "),
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
});

export class QuotaCounter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const input = await request.json();
    const day = String(input.day || "");
    const kind = input.kind === "plan" ? "plan" : "image";
    const units = Math.max(1, Math.min(100, Number(input.units) || 1));
    const limit = DAILY_LIMITS[kind];
    const minute = Math.floor(Date.now() / 60_000);

    const result = await this.state.storage.transaction(async (tx) => {
      const current = (await tx.get("quota")) || {
        day,
        plan: 0,
        image: 0,
        minute,
        minuteRequests: 0,
      };

      if (current.day !== day) {
        current.day = day;
        current.plan = 0;
        current.image = 0;
      }
      if (current.minute !== minute) {
        current.minute = minute;
        current.minuteRequests = 0;
      }
      if (current.minuteRequests >= 24) {
        return { ok: false, status: 429, message: "요청이 너무 빨라요. 잠시 후 다시 시도해 주세요." };
      }
      if (current[kind] + units > limit) {
        return {
          ok: false,
          status: 429,
          message: `오늘의 ${kind === "image" ? "이미지" : "기획"} 무료 한도를 모두 사용했어요.`,
          remaining: Math.max(0, limit - current[kind]),
        };
      }

      current[kind] += units;
      current.minuteRequests += 1;
      await tx.put("quota", current);
      return { ok: true, status: 200, remaining: limit - current[kind], limit };
    });

    return json(result, result.status);
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/config" && request.method === "GET") {
        return json({
          plannerModel: PLANNER_MODEL,
          imageModel: IMAGE_MODEL,
          dailyLimits: { plans: DAILY_LIMITS.plan, images: DAILY_LIMITS.image },
          pricing: {
            freeNeuronsPerDay: 10_000,
            outputNeuronsPer1024Image: 104.2,
            referenceNeuronsPer511Image: 5.37,
          },
        });
      }

      if (url.pathname === "/api/plan" && request.method === "POST") {
        return await handlePlan(request, env);
      }

      if (url.pathname === "/api/image" && request.method === "POST") {
        return await handleImage(request, env);
      }

      if (url.pathname.startsWith("/api/")) {
        return json({ error: "API 경로를 찾을 수 없어요." }, 404);
      }

      const asset = await env.ASSETS.fetch(request);
      return withSecurityHeaders(asset);
    } catch (error) {
      console.error("Unhandled request error", error);
      return json({ error: userFacingError(error) }, 500);
    }
  },
};

async function handlePlan(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return json({ error: "JSON 요청만 지원해요." }, 415);
  }

  const input = await request.json();
  const description = cleanText(input.description, MAX_DESCRIPTION_LENGTH);
  const count = Number(input.count);
  const captionMode = input.captionMode === "korean" ? "korean" : "none";
  if (!description) return json({ error: "이모티콘 설명을 입력해 주세요." }, 400);
  if (!ALLOWED_COUNTS.has(count)) return json({ error: "지원하지 않는 이모티콘 개수예요." }, 400);

  const quota = await consumeQuota(request, env, "plan", 1);
  if (!quota.ok) return json({ error: quota.message, quota }, quota.status);

  const prompt = buildPlanPrompt({ description, count, captionMode });
  const result = await env.AI.run(PLANNER_MODEL, {
    messages: [
      {
        role: "system",
        content: "You are a professional messenger sticker planner. Return one valid JSON object only.",
      },
      { role: "user", content: prompt },
    ],
    max_tokens: 3600,
    temperature: 0.45,
    response_format: { type: "json_object" },
  });

  const text = result?.response || result?.result?.response || result?.output_text || "";
  const parsed = parseJsonObject(text);
  const plan = normalizePlan(parsed, count, captionMode, description);
  return json({ ...plan, quota });
}

async function handleImage(request, env) {
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("multipart/form-data")) {
    return json({ error: "multipart/form-data 요청만 지원해요." }, 415);
  }

  const incoming = await request.formData();
  const prompt = cleanText(incoming.get("prompt"), MAX_IMAGE_PROMPT_LENGTH);
  const reference = incoming.get("reference");
  if (!prompt) return json({ error: "이미지 프롬프트가 비어 있어요." }, 400);

  if (reference instanceof File) {
    if (!ALLOWED_IMAGE_TYPES.has(reference.type)) {
      return json({ error: "PNG, JPEG, WebP 참조 이미지만 지원해요." }, 400);
    }
    if (reference.size > MAX_REFERENCE_BYTES) {
      return json({ error: "참조 이미지는 2MB 이하여야 해요." }, 413);
    }
  }

  const quota = await consumeQuota(request, env, "image", 1);
  if (!quota.ok) return json({ error: quota.message, quota }, quota.status);

  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", "1024");
  form.append("height", "1024");
  form.append("seed", String(Math.floor(Math.random() * 2_147_483_647)));
  if (reference instanceof File) {
    form.append("input_image_0", reference, reference.name || "reference.png");
  }

  const serialized = new Response(form);
  const result = await env.AI.run(IMAGE_MODEL, {
    multipart: {
      body: serialized.body,
      contentType: serialized.headers.get("content-type"),
    },
  });

  const image = result?.image || result?.result?.image;
  if (!image) throw new Error("이미지 모델 응답에 이미지가 없어요.");
  const mimeType = result?.mimeType || result?.mime_type || "image/jpeg";
  return json({ image: `data:${mimeType};base64,${image}`, quota });
}

async function consumeQuota(request, env, kind, units) {
  if (!env.QUOTA_COUNTER) {
    throw new Error("QUOTA_COUNTER Durable Object 바인딩이 필요해요.");
  }
  const clientId = cleanClientId(request.headers.get("x-client-id"));
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const identity = await sha256Hex(`${ip}:${clientId}`);
  const id = env.QUOTA_COUNTER.idFromName(identity);
  const stub = env.QUOTA_COUNTER.get(id);
  const day = new Date().toISOString().slice(0, 10);
  const response = await stub.fetch("https://quota.internal/consume", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ day, kind, units }),
  });
  return await response.json();
}

function buildPlanPrompt({ description, count, captionMode }) {
  const captionRule = captionMode === "korean"
    ? "caption must be a natural Korean phrase of 2 to 6 characters."
    : "caption must always be an empty string.";
  return `Plan exactly ${count} messenger emoticons from this Korean request:\n${description}\n\n` +
    `Return: {"character":"detailed English character design",` +
    `"ideas":[{"title":"short Korean title","scene":"specific English pose and emotion",` +
    `"caption":"..."}]}. Rules: ideas must be distinct and useful in daily conversation; ` +
    `keep one identical character design; ${captionRule}`;
}

export function normalizePlan(input, count, captionMode, description = "character") {
  const character = cleanText(input?.character, 900) ||
    `A cute, expressive mascot based on this concept: ${cleanText(description, 300)}`;
  const source = Array.isArray(input?.ideas) ? input.ideas : [];
  const ideas = [];
  const seen = new Set();

  for (const raw of source) {
    if (ideas.length >= count) break;
    const title = cleanText(raw?.title, 24);
    const scene = cleanText(raw?.scene, 500);
    if (!title || !scene || seen.has(title)) continue;
    seen.add(title);
    ideas.push({
      title,
      scene,
      caption: captionMode === "korean" ? cleanText(raw?.caption, 18) : "",
    });
  }

  for (const [title, scene] of FALLBACK_IDEAS) {
    if (ideas.length >= count) break;
    if (seen.has(title)) continue;
    seen.add(title);
    ideas.push({ title, scene, caption: captionMode === "korean" ? title : "" });
  }
  return { character, ideas: ideas.slice(0, count) };
}

export function estimateNeurons({ imageCalls, referenceCalls, plannerNeurons = 50 }) {
  const images = Math.max(0, Number(imageCalls) || 0);
  const references = Math.max(0, Number(referenceCalls) || 0);
  return Math.round((images * 104.2 + references * 5.37 + plannerNeurons) * 10) / 10;
}

function parseJsonObject(text) {
  if (text && typeof text === "object") return text;
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("기획 모델이 올바른 JSON을 반환하지 않았어요.");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function cleanText(value, maxLength) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanClientId(value) {
  const id = String(value || "anonymous");
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : "anonymous";
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...SECURITY_HEADERS,
    },
  });
}

function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  if ((headers.get("content-type") || "").includes("text/html")) {
    headers.set("cache-control", "no-cache");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function userFacingError(error) {
  const message = String(error?.message || "알 수 없는 서버 오류가 발생했어요.");
  return message.slice(0, 300);
}
