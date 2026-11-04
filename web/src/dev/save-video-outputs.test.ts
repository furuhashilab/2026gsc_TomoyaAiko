// @vitest-environment node
// Runs the endpoint on a real HTTP server and sends raw requests, so headers, streaming,
// limits and dropped connections behave as they do on the Vite dev server.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { type Server, createServer, request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SAVE_HEADER, createSaveHandler } from "./save-video-outputs";

const LIMIT = 1024;
let dir: string;
let server: Server;
let port: number;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "cf-save-"));
  server = createServer(createSaveHandler({ dir, maxBytes: LIMIT }));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

const sameOrigin = () => ({
  origin: `http://127.0.0.1:${port}`,
  "sec-fetch-site": "same-origin",
  [SAVE_HEADER]: "1",
});

interface Res {
  status: number;
  body: string;
}

function post(name: string, headers: Record<string, string | undefined>, body: Buffer | string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined)) as Record<string, string>;
    const req = request({ host: "127.0.0.1", port, method: "POST", path: `/?name=${encodeURIComponent(name)}`, headers: clean }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

const files = () => readdirSync(dir);

describe("normal write", () => {
  it("stores a WebM and a JSON record with the right types", async () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
    expect((await post("a.webm", { ...sameOrigin(), "content-type": "video/webm" }, webm)).status).toBe(200);
    expect((await post("a.json", { ...sameOrigin(), "content-type": "application/json; charset=utf-8" }, "{}")).status).toBe(200);
    expect(readFileSync(join(dir, "a.webm"))).toEqual(webm);
    expect(files().sort()).toEqual(["a.json", "a.webm"]); // no temporary files left
  });

  it("accepts a browser without Sec-Fetch-Site when Origin and the custom header match", async () => {
    const r = await post("b.json", { ...sameOrigin(), "sec-fetch-site": undefined, "content-type": "application/json" }, "{}");
    expect(r.status).toBe(200);
  });
});

describe("cross-site and header checks", () => {
  const json = { "content-type": "application/json" };
  it("refuses another Origin", async () => {
    expect((await post("x.json", { ...sameOrigin(), ...json, origin: "https://evil.example" }, "{}")).status).toBe(403);
    expect((await post("x.json", { ...sameOrigin(), ...json, origin: "http://127.0.0.1:1" }, "{}")).status).toBe(403); // other local port
  });

  it("refuses a request without Origin", async () => {
    expect((await post("x.json", { ...sameOrigin(), ...json, origin: undefined }, "{}")).status).toBe(403);
  });

  it("refuses Sec-Fetch-Site other than same-origin", async () => {
    for (const site of ["cross-site", "same-site", "none"]) {
      expect((await post("x.json", { ...sameOrigin(), ...json, "sec-fetch-site": site }, "{}")).status).toBe(403);
    }
  });

  it("refuses a request without the custom header", async () => {
    expect((await post("x.json", { ...sameOrigin(), ...json, [SAVE_HEADER]: undefined }, "{}")).status).toBe(403);
  });

  it("refuses a Content-Type that does not match the extension", async () => {
    expect((await post("x.webm", { ...sameOrigin(), "content-type": "text/plain" }, "x")).status).toBe(415);
    expect((await post("x.webm", { ...sameOrigin(), "content-type": "application/json" }, "x")).status).toBe(415);
    expect((await post("x.json", { ...sameOrigin(), "content-type": "video/webm" }, "x")).status).toBe(415);
    expect(files()).toEqual([]);
  });

  it("refuses invalid file names", async () => {
    for (const name of ["../x.json", "x.exe", ".hidden.json", "a/b.webm", "", "x..json", "x.webm.sh"]) {
      expect((await post(name, { ...sameOrigin(), ...json }, "{}")).status).toBe(400);
    }
    expect(files()).toEqual([]);
  });
});

describe("size limit", () => {
  const webm = { "content-type": "video/webm" };
  it("refuses a declared Content-Length over the limit", async () => {
    expect((await post("big.webm", { ...sameOrigin(), ...webm }, Buffer.alloc(LIMIT + 1))).status).toBe(413);
    expect(files()).toEqual([]);
  });

  it("counts the bytes actually received (chunked body without Content-Length)", async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        { host: "127.0.0.1", port, method: "POST", path: "/?name=big.webm", headers: { ...sameOrigin(), ...webm, "transfer-encoding": "chunked" } },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        },
      );
      req.on("error", () => resolve(-1)); // the server may close the socket after answering
      for (let i = 0; i < 8; i++) req.write(Buffer.alloc(256));
      req.end();
      setTimeout(() => reject(new Error("no response")), 2000);
    });
    expect([413, -1]).toContain(status);
    await new Promise((r) => setTimeout(r, 50));
    expect(files()).toEqual([]);
  });

  it("accepts exactly the limit", async () => {
    expect((await post("max.webm", { ...sameOrigin(), ...webm }, Buffer.alloc(LIMIT))).status).toBe(200);
  });
});

describe("interrupted upload", () => {
  it("leaves no partial or temporary file when the client disconnects", async () => {
    await new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port, method: "POST", path: "/?name=cut.webm", headers: { ...sameOrigin(), "content-type": "video/webm", "content-length": "800" } });
      req.on("error", () => {});
      req.write(Buffer.alloc(300));
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(files()).toEqual([]);
  });

  it("keeps the previous file when a replacement upload is cut off", async () => {
    await post("keep.json", { ...sameOrigin(), "content-type": "application/json" }, '{"v":1}');
    await new Promise<void>((resolve) => {
      const req = request({ host: "127.0.0.1", port, method: "POST", path: "/?name=keep.json", headers: { ...sameOrigin(), "content-type": "application/json", "content-length": "500" } });
      req.on("error", () => {});
      req.write('{"v":2');
      setTimeout(() => {
        req.destroy();
        resolve();
      }, 50);
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(readFileSync(join(dir, "keep.json"), "utf8")).toBe('{"v":1}');
    expect(files()).toEqual(["keep.json"]);
  });
});
