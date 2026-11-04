// Pre-flight check of a GLB and the external files it references (e.g. Textures/colormap.png),
// so a missing texture is reported at once with a clear reason instead of waiting for CesiumJS
// to time out. The dev server answers unknown paths with index.html, so content types are
// checked as well as HTTP status.

type Fetch = (url: string) => Promise<Response>;

/** URIs of buffers/images that a GLB references outside itself (data: URIs excluded). */
export function externalUris(glb: ArrayBuffer): string[] {
  const view = new DataView(glb);
  if (glb.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error("GLB ではありません");
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jsonLength))) as {
    images?: { uri?: string }[];
    buffers?: { uri?: string }[];
  };
  return [...(json.images ?? []), ...(json.buffers ?? [])]
    .map((x) => x.uri)
    .filter((u): u is string => typeof u === "string" && !u.startsWith("data:"));
}

/** Resolves when the GLB and every external file it references can be fetched; rejects with a reason. */
export async function checkModelResources(modelUrl: string, fetchFn: Fetch = fetch): Promise<void> {
  const res = await fetchFn(modelUrl);
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || type.includes("text/html")) throw new Error(`モデル ${modelUrl} を取得できません（HTTP ${res.status}）`);
  // relative model URLs resolve against the page; absolute ones (as in tests) stand alone
  const base = new URL(modelUrl, globalThis.location?.href);
  for (const uri of externalUris(await res.arrayBuffer())) {
    const r = await fetchFn(new URL(uri, base).href);
    const t = r.headers.get("content-type") ?? "";
    if (!r.ok || t.includes("text/html")) throw new Error(`テクスチャ ${uri} を取得できません（HTTP ${r.status}${t.includes("text/html") ? "、HTML が返りました" : ""}）`);
  }
}
