// Textures for the race presentation, drawn at runtime on canvases: no image files, no
// external or paid assets. Noise uses a fixed seed so every run looks the same.

import type { PresentationConfig, Sponsor } from "./config";

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}

// mulberry32: small deterministic PRNG
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Low-contrast speckle so the surface does not shimmer much without mipmaps.
function speckle(g: CanvasRenderingContext2D, w: number, h: number, base: number, spread: number, count: number, seed: number): void {
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const v = Math.round(base + (r() - 0.5) * spread);
    g.fillStyle = `rgb(${v},${v},${v + 2})`;
    g.fillRect(Math.floor(r() * w), Math.floor(r() * h), 1 + Math.floor(r() * 2), 1 + Math.floor(r() * 2));
  }
}

/**
 * Asphalt across the full virtual width (u = 0 at the left edge) and textureRepeatM along
 * the course: red/white kerbs at both edges with a white line inside each.
 */
export function roadTexture(road: PresentationConfig["road"]): HTMLCanvasElement {
  const W = 512;
  const H = 1024;
  const [c, g] = canvas(W, H);
  g.fillStyle = "#3b3d40";
  g.fillRect(0, 0, W, H);
  speckle(g, W, H, 62, 26, 60000, 1);
  const pxPerM = W / road.widthM;
  const kerb = Math.round(road.kerbWidthM * pxPerM);
  const line = Math.max(2, Math.round(road.lineWidthM * pxPerM));
  const block = H / road.textureRepeatM; // 1 m kerb blocks
  for (let i = 0; i * block < H; i++) {
    g.fillStyle = i % 2 === 0 ? "#c8102e" : "#f2f2f2";
    g.fillRect(0, i * block, kerb, block);
    g.fillRect(W - kerb, i * block, kerb, block);
  }
  g.fillStyle = "#ededed";
  g.fillRect(kerb + 2, 0, line, H);
  g.fillRect(W - kerb - 2 - line, 0, line, H);
  return c;
}

/** Concrete barrier face, CONCRETE_REPEAT_M long, with a joint line and a dark base. */
export function concreteTexture(): HTMLCanvasElement {
  const [c, g] = canvas(256, 64);
  g.fillStyle = "#b9b7b1";
  g.fillRect(0, 0, 256, 64);
  speckle(g, 256, 64, 180, 30, 3000, 2);
  g.fillStyle = "#8e8c87";
  g.fillRect(0, 0, 2, 64); // block joint
  g.fillStyle = "rgba(60,60,60,0.35)";
  g.fillRect(0, 54, 256, 10); // grime near the ground (canvas bottom = v 0)
  return c;
}

/**
 * Catch fence: a faint tint with horizontal wires, a post every FENCE_REPEAT_M and a top
 * rail. A fine diagonal mesh was tried first but shimmered badly (moire) without mipmaps.
 */
export function fenceTexture(): HTMLCanvasElement {
  const W = 256;
  const H = 256;
  const [c, g] = canvas(W, H);
  g.fillStyle = "rgba(190,200,210,0.12)";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "rgba(200,205,210,0.5)";
  for (let y = 24; y < H; y += 28) g.fillRect(0, y, W, 2); // horizontal wires
  g.fillStyle = "rgba(70,75,80,0.95)";
  g.fillRect(0, 0, 8, H); // post
  g.fillRect(0, 0, W, 6); // top rail
  return c;
}

/** Fictional sponsor board (8:1 like the default 8 m x 0.8 m panel, wide enough to read). */
export function adTexture(sponsor: Sponsor, subText: string, aspect: number): HTMLCanvasElement {
  const H = 160;
  const W = Math.round(H * aspect);
  const [c, g] = canvas(W, H);
  g.fillStyle = sponsor.bg;
  g.fillRect(0, 0, W, H);
  g.fillStyle = sponsor.fg;
  g.fillRect(0, 0, W, 8);
  g.fillRect(0, H - 8, W, 8);
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 100;
  g.font = `900 ${size}px system-ui, sans-serif`;
  while (g.measureText(sponsor.text).width > W * 0.86 && size > 20) {
    size -= 4;
    g.font = `900 ${size}px system-ui, sans-serif`;
  }
  g.fillText(sponsor.text, W / 2, H / 2 - 8);
  g.font = "600 22px system-ui, sans-serif";
  g.globalAlpha = 0.8;
  g.fillText(subText, W / 2, H - 26);
  return c;
}
