import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadProfiles() {
  const source = await readFile(new URL("../public/js/profiles.js", import.meta.url), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: "profiles.js" });
  return context.window.ExportProfiles;
}

test("platform profiles expose valid counts and formats", async () => {
  const profiles = await loadProfiles();
  assert.deepEqual(Array.from(profiles.get("generic").counts), [10, 12, 15]);
  assert.deepEqual(Array.from(profiles.get("line-animated").counts), [8, 16, 24]);
  assert.equal(profiles.get("line-animated").animated.minFrames, 5);
  assert.equal(profiles.get("telegram-static").width, 512);
});

test("local animation uses one generated image per item", async () => {
  const profiles = await loadProfiles();
  const local = profiles.estimate({ count: 15, format: "animated-local", hasReference: false });
  const ai = profiles.estimate({ count: 15, format: "animated-ai", hasReference: false });
  assert.equal(local.imageCalls, 16);
  assert.equal(ai.imageCalls, 91);
  assert.ok(local.neurons < ai.neurons);
});

test("LINE animation validation rejects too few frames and oversized files", async () => {
  const profiles = await loadProfiles();
  const issues = profiles.validateFile("line-animated", 1024 * 1024 + 1, 4);
  assert.equal(issues.length, 2);
});
