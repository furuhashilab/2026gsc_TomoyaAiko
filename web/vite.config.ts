import { resolve } from "node:path";
import { type Plugin, defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { createSaveHandler } from "./src/dev/save-video-outputs.ts";

// CesiumJS needs its Workers, Assets, Widgets and ThirdParty folders served as static
// files; this follows the official cesium-vite-example setup.
const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesiumStatic";

// Dev server only: lets tools/video-export.html write its WebM and record JSON to
// web/out/video/ (git-ignored). Origin, size and type checks: src/dev/save-video-outputs.ts.
function saveVideoOutputs(): Plugin {
  return {
    name: "circuitforge-save-video-outputs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__video-out", createSaveHandler({ dir: resolve("out/video"), label: "web/out/video" }));
    },
  };
}

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  plugins: [
    saveVideoOutputs(),
    viteStaticCopy({
      targets: [
        { src: `${cesiumSource}/ThirdParty`, dest: cesiumBaseUrl, rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Workers`, dest: cesiumBaseUrl, rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Assets`, dest: cesiumBaseUrl, rename: { stripBase: 4 } },
        { src: `${cesiumSource}/Widgets`, dest: cesiumBaseUrl, rename: { stripBase: 4 } },
      ],
    }),
  ],
  build: {
    // The Cesium bundle alone is ~4 MB minified; splitting it is not useful at this stage.
    chunkSizeWarningLimit: 5000,
  },
  server: {
    // Allow importing the shared AOI config and course samples (paths relative to web/).
    fs: { allow: [".", "../config", "../contracts", "../docs/evidence"] },
  },
});
