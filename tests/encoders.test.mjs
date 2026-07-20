import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function loadEncoders() {
  const context = {
    ArrayBuffer,
    Blob,
    DataView,
    Date,
    Map,
    Math,
    TextEncoder,
    Uint8Array,
    Uint8ClampedArray,
    Uint32Array,
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ["zip.js", "apng.js", "gif.js"]) {
    const source = await readFile(new URL(`../public/js/${file}`, import.meta.url), "utf8");
    vm.runInContext(source, context, { filename: file });
  }
  return context;
}

function chunk(bytes, type) {
  for (let position = 8; position < bytes.length;) {
    const length = new DataView(bytes.buffer, bytes.byteOffset + position, 4).getUint32(0);
    const name = String.fromCharCode(...bytes.slice(position + 4, position + 8));
    if (name === type) return bytes.slice(position + 8, position + 8 + length);
    position += 12 + length;
  }
  return null;
}

test("APNG contains animation control, frame data and finite play count", async () => {
  const encoders = await loadEncoders();
  const png = new Uint8Array(Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X2NDWQAAAABJRU5ErkJggg==",
    "base64"
  ));
  const apng = encoders.makeApng([png, png], 150, 4);
  assert.deepEqual(Array.from(apng.slice(0, 8)), [137, 80, 78, 71, 13, 10, 26, 10]);
  const animation = chunk(apng, "acTL");
  assert.ok(animation);
  const view = new DataView(animation.buffer, animation.byteOffset, animation.byteLength);
  assert.equal(view.getUint32(0), 2);
  assert.equal(view.getUint32(4), 4);
  assert.ok(chunk(apng, "fdAT"));
});

test("GIF encoder writes a looping GIF89a stream", async () => {
  const encoders = await loadEncoders();
  const frame = {
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 0, 0, 0, 0,
    ]),
  };
  const gif = encoders.makeGif([frame, frame], 150);
  assert.equal(Buffer.from(gif.slice(0, 6)).toString("ascii"), "GIF89a");
  assert.equal(gif.at(-1), 0x3b);
  assert.ok(Buffer.from(gif).includes(Buffer.from("NETSCAPE2.0")));
});

test("ZIP encoder creates a UTF-8 store archive", async () => {
  const encoders = await loadEncoders();
  const blob = encoders.makeZip([{ name: "테스트.txt", data: new TextEncoder().encode("ok") }]);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
  assert.deepEqual(Array.from(bytes.slice(-22, -18)), [0x50, 0x4b, 0x05, 0x06]);
});
