import assert from "node:assert/strict";
import test from "node:test";

import {
  QuotaCounter,
  buildImagePrompt,
  estimateNeurons,
  normalizePlan,
  quotaIdentity,
  readImageDimensions,
  validateMutationOrigin,
} from "../worker/index.js";
import worker from "../worker/index.js";

test("normalizePlan returns the exact requested count and removes duplicates", () => {
  const plan = normalizePlan({
    character: "A small orange raccoon with a blue cap",
    ideas: [
      { title: "안녕", scene: "waves", caption: "안녕" },
      { title: "안녕", scene: "duplicate", caption: "중복" },
      { title: "최고", scene: "thumbs up", caption: "최고야" },
    ],
  }, 10, "korean", "너구리");

  assert.equal(plan.ideas.length, 10);
  assert.equal(new Set(plan.ideas.map((idea) => idea.title)).size, 10);
  assert.equal(plan.ideas[0].caption, "안녕");
  assert.equal(plan.fallbackCount, 8);
});

test("normalizePlan strips captions when caption mode is disabled", () => {
  const plan = normalizePlan({
    character: "cat",
    ideas: [{ title: "인사", scene: "waves", caption: "안녕" }],
  }, 8, "none");
  assert.equal(plan.ideas.length, 8);
  assert.ok(plan.ideas.every((idea) => idea.caption === ""));
});

test("estimateNeurons matches the documented 1024 tile calculation", () => {
  assert.equal(estimateNeurons({ imageCalls: 15, referenceCalls: 15 }), 1763.6);
  assert.equal(estimateNeurons({ imageCalls: 0, referenceCalls: 0 }), 120);
});

test("QuotaCounter enforces per-minute and daily limits", async () => {
  const values = new Map();
  const storage = {
    async transaction(callback) {
      return await callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, structuredClone(value)),
      });
    },
  };
  const counter = new QuotaCounter({ storage });
  const request = (kind = "image") => new Request("https://quota.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ day: "2026-07-20", kind, units: 1 }),
  });

  for (let index = 0; index < 24; index++) {
    const response = await counter.fetch(request());
    assert.equal(response.status, 200);
  }
  assert.equal((await counter.fetch(request())).status, 429);

  values.set("quota", {
    day: "2026-07-20",
    plan: 0,
    image: 80,
    minute: 0,
    minuteRequests: 0,
  });
  const dailyResponse = await counter.fetch(request());
  assert.equal(dailyResponse.status, 429);
  assert.match((await dailyResponse.json()).message, /한도/);
});

test("QuotaCounter enforces the service-wide Neuron budget and supports refunds", async () => {
  const values = new Map();
  const storage = {
    async transaction(callback) {
      return await callback({
        get: async (key) => values.get(key),
        put: async (key, value) => values.set(key, structuredClone(value)),
      });
    },
  };
  const counter = new QuotaCounter({ storage });
  const request = (units, action = "consume") => new Request("https://quota.test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      day: "2026-07-20",
      scope: "global",
      kind: "neuron",
      units,
      limit: 9000,
      action,
    }),
  });

  assert.equal((await counter.fetch(request(8999))).status, 200);
  assert.equal((await counter.fetch(request(2))).status, 429);
  assert.equal((await counter.fetch(request(1000, "refund"))).status, 200);
  assert.equal((await counter.fetch(request(2))).status, 200);
});

test("per-IP quota identity ignores attacker-controlled client IDs", async () => {
  const first = new Request("https://example.com/api/image", {
    headers: { "cf-connecting-ip": "203.0.113.8", "x-client-id": "attacker-one" },
  });
  const second = new Request("https://example.com/api/image", {
    headers: { "cf-connecting-ip": "203.0.113.8", "x-client-id": "attacker-two" },
  });
  const otherIp = new Request("https://example.com/api/image", {
    headers: { "cf-connecting-ip": "203.0.113.9", "x-client-id": "attacker-one" },
  });
  assert.equal(await quotaIdentity(first), await quotaIdentity(second));
  assert.notEqual(await quotaIdentity(first), await quotaIdentity(otherIp));
});

test("mutation origin guard rejects cross-site and missing origins", () => {
  const allowed = new Request("https://stickers.example/api/image", {
    method: "POST",
    headers: { origin: "https://stickers.example", "sec-fetch-site": "same-origin" },
  });
  const crossSite = new Request("https://stickers.example/api/image", {
    method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
  });
  const missing = new Request("https://stickers.example/api/image", { method: "POST" });
  assert.equal(validateMutationOrigin(allowed), null);
  assert.equal(validateMutationOrigin(crossSite).status, 403);
  assert.equal(validateMutationOrigin(missing).status, 403);
});

test("image prompts are assembled from structured server fields", () => {
  const prompt = buildImagePrompt({
    mode: "sticker",
    character: "orange raccoon",
    scene: "waves hello",
    styleKey: "bold-cartoon",
    hasCaption: true,
  });
  assert.match(prompt, /Character data.*orange raccoon/);
  assert.match(prompt, /Scene data.*waves hello/);
  assert.match(prompt, /saturated colors/);
  assert.match(prompt, /caption.*added later/);
});

test("PNG reference dimensions are parsed before model invocation", async () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 511);
  view.setUint32(20, 480);
  assert.deepEqual(
    await readImageDimensions(new Blob([bytes], { type: "image/png" })),
    { width: 511, height: 480 }
  );
});

test("image endpoint rejects oversized reference pixels before quota or AI", async () => {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 512);
  view.setUint32(20, 511);
  const form = new FormData();
  form.append("mode", "sticker");
  form.append("character", "orange raccoon");
  form.append("scene", "waves hello");
  form.append("style", "cute-sticker");
  form.append("reference", new Blob([bytes], { type: "image/png" }), "wide.png");
  const request = new Request("https://stickers.example/api/image", {
    method: "POST",
    headers: { origin: "https://stickers.example", "sec-fetch-site": "same-origin" },
    body: form,
  });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /511px/);
});
