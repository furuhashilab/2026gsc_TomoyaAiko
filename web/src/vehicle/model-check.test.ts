import { describe, expect, it } from "vitest";
import { checkModelResources, externalUris } from "./model-check";

// Minimal GLB: header + JSON chunk (no BIN chunk needed for these checks).
function glb(json: object): ArrayBuffer {
  let text = JSON.stringify(json);
  while (text.length % 4) text += " ";
  const body = new TextEncoder().encode(text);
  const buf = new ArrayBuffer(20 + body.length);
  const v = new DataView(buf);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, buf.byteLength, true);
  v.setUint32(12, body.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  new Uint8Array(buf, 20).set(body);
  return buf;
}

const model = glb({ images: [{ uri: "Textures/colormap.png" }, { bufferView: 0 }], buffers: [{ byteLength: 4 }] });

function fakeFetch(files: Record<string, { status: number; type: string; body?: ArrayBuffer }>) {
  return async (url: string) => {
    const path = new URL(url).pathname;
    const f = files[path] ?? { status: 200, type: "text/html" }; // dev-server style fallback
    return new Response(f.body ?? "x", { status: f.status, headers: { "content-type": f.type } });
  };
}

describe("externalUris", () => {
  it("lists external image/buffer URIs only", () => {
    expect(externalUris(model)).toEqual(["Textures/colormap.png"]);
  });

  it("rejects a non-GLB", () => {
    expect(() => externalUris(new ArrayBuffer(32))).toThrow(/GLB/);
  });
});

describe("checkModelResources", () => {
  const ok = {
    "/models/car/race.glb": { status: 200, type: "model/gltf-binary", body: model },
    "/models/car/Textures/colormap.png": { status: 200, type: "image/png" },
  };

  it("passes when the model and its texture exist", async () => {
    await expect(checkModelResources("http://localhost/models/car/race.glb", fakeFetch(ok))).resolves.toBeUndefined();
  });

  it("reports a missing texture (HTML fallback from the dev server)", async () => {
    const noTexture = { "/models/car/race.glb": ok["/models/car/race.glb"] };
    await expect(checkModelResources("http://localhost/models/car/race.glb", fakeFetch(noTexture))).rejects.toThrow(/colormap\.png/);
  });

  it("reports a missing model", async () => {
    await expect(checkModelResources("http://localhost/models/none.glb", fakeFetch({}))).rejects.toThrow(/none\.glb/);
  });
});
