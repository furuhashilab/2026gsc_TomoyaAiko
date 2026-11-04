// Shared by the browser page and the dev-server endpoint (no Node imports here, so the
// page can import it without pulling node:fs into the bundle).
export const SAVE_HEADER = "x-circuitforge-video-export";
export const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
