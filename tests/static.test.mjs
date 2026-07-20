import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("browser bundle contains no provider secret input", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const provider = await readFile(new URL("../public/js/providers.js", import.meta.url), "utf8");
  assert.doesNotMatch(html, /id=["']api-key["']/i);
  assert.doesNotMatch(html, /OpenAI 대시보드|Google AI Studio.*키 발급/i);
  assert.match(html, /Cloudflare Worker/);
  assert.doesNotMatch(provider, /X-Client-Id|localStorage|form\.append\(["']prompt["']/i);
  assert.match(provider, /form\.append\(["']mode["']/i);
});

test("recovery and partial export controls remain available", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/js/app.js", import.meta.url), "utf8");
  assert.match(html, /id="resume-btn"/);
  assert.match(html, /id="download-partial-btn"/);
  assert.match(app, /⬇ GIF/);
  assert.match(app, /partial.*missingIndexes/s);
});

test("all scripts referenced by index exist", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(scripts.length >= 7);
  for (const script of scripts) {
    await access(new URL(`../public/${script}`, import.meta.url));
  }
});
