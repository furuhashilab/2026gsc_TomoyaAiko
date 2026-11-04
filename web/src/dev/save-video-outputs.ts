// Dev-server endpoint that writes the video export's WebM / record JSON to disk.
// Runs in Node (vite.config.ts), never in the browser bundle.
//
// The dev server only listens on localhost and Vite rejects unknown Host headers, but any
// page open in the same browser could still send a "simple" cross-site POST. So a write is
// accepted only when all of these hold:
// - Origin is present and equals this server's own origin (a browser always sends Origin
//   on fetch POST; requests without it, e.g. plain curl, are refused);
// - Sec-Fetch-Site, when the browser sends it, is "same-origin";
// - the custom header below is set (a cross-site page cannot add it without a CORS preflight);
// - the file name is plain and its Content-Type matches the extension;
// - the bytes actually received stay within the limit (Content-Length is only a hint).
// The body goes to a temporary file in the same directory and is renamed into place only
// after the whole request arrived; on any failure the temporary file is removed before the
// response is sent.
import { randomBytes } from "node:crypto";
import { createWriteStream, mkdirSync, renameSync, rmSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { DEFAULT_MAX_BYTES, SAVE_HEADER } from "./save-protocol.ts";

export { DEFAULT_MAX_BYTES, SAVE_HEADER };

const TYPES: Record<string, string> = { webm: "video/webm", json: "application/json" };
const NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,99}\.(webm|json)$/;

export interface SaveOptions {
  dir: string;
  maxBytes?: number;
  /** Path shown to the user in the response (e.g. "web/out/video"). */
  label?: string;
}

function reply(res: ServerResponse, status: number, body: Record<string, unknown>): void {
  if (res.headersSent) return;
  res.writeHead(status, { "content-type": "application/json", connection: "close" });
  res.end(JSON.stringify(body));
}

/** Returns why the request is refused, or null when the headers allow a write. */
export function checkRequest(req: IncomingMessage, name: string, maxBytes: number): { status: number; error: string } | null {
  if (req.method !== "POST") return { status: 405, error: "POST only" };
  if (!NAME.test(name) || name.includes("..")) return { status: 400, error: "invalid file name" };
  const origin = req.headers.origin;
  const scheme = (req.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
  if (!origin) return { status: 403, error: "Origin header required" };
  if (!req.headers.host || origin !== `${scheme}://${req.headers.host}`) return { status: 403, error: "cross-origin request" };
  const site = req.headers["sec-fetch-site"];
  if (site !== undefined && site !== "same-origin") return { status: 403, error: "cross-site request" };
  if (req.headers[SAVE_HEADER] !== "1") return { status: 403, error: `${SAVE_HEADER} header required` };
  const ext = name.slice(name.lastIndexOf(".") + 1);
  const type = (req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
  if (type !== TYPES[ext]) return { status: 415, error: `Content-Type must be ${TYPES[ext]}` };
  const declared = Number(req.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) return { status: 413, error: `larger than ${maxBytes} bytes` };
  return null;
}

export function createSaveHandler(opts: SaveOptions) {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  return (req: IncomingMessage, res: ServerResponse): void => {
    const name = new URL(req.url ?? "", "http://localhost").searchParams.get("name") ?? "";
    const refused = checkRequest(req, name, maxBytes);
    if (refused) {
      reply(res, refused.status, { error: refused.error });
      req.resume(); // drain without storing
      return;
    }
    mkdirSync(opts.dir, { recursive: true });
    const target = join(opts.dir, name);
    const temp = join(opts.dir, `.${name}.${process.pid}-${randomBytes(6).toString("hex")}.part`);
    const out = createWriteStream(temp, { flags: "wx" });
    let received = 0;
    let finished = false;
    // The file is opened asynchronously, so delete it only once the stream has closed
    // (deleting earlier could race the open and leave an empty .part file behind), and
    // answer only after the cleanup.
    const fail = (status: number, error: string) => {
      if (finished) return;
      finished = true;
      req.pause();
      const cleanup = () => {
        rmSync(temp, { force: true });
        reply(res, status, { error });
        req.destroy();
      };
      if (out.closed) cleanup();
      else {
        out.once("close", cleanup);
        out.destroy();
      }
    };
    req.on("data", (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBytes) fail(413, `larger than ${maxBytes} bytes`);
      else if (!out.write(chunk)) {
        req.pause();
        out.once("drain", () => req.resume());
      }
    });
    req.on("end", () => {
      if (finished) return;
      out.end(() => {
        if (finished) return;
        finished = true;
        try {
          renameSync(temp, target);
        } catch (e) {
          rmSync(temp, { force: true });
          reply(res, 500, { error: String(e) });
          return;
        }
        reply(res, 200, { path: `${opts.label ?? opts.dir}/${name}`, bytes: received });
      });
    });
    // client went away before the body was complete
    req.on("aborted", () => fail(400, "request aborted"));
    req.on("close", () => {
      if (!req.complete) fail(400, "request aborted");
    });
    out.on("error", (e) => fail(500, String(e)));
  };
}
