import assert from "node:assert/strict";
import test from "node:test";

import { QuotaCounter, estimateNeurons, normalizePlan } from "../worker/index.js";

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
  assert.equal(estimateNeurons({ imageCalls: 15, referenceCalls: 15 }), 1693.6);
  assert.equal(estimateNeurons({ imageCalls: 0, referenceCalls: 0 }), 50);
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
