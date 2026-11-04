import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// CesiumJS needs its Workers, Assets, Widgets and ThirdParty folders served as static
// files; this follows the official cesium-vite-example setup.
const cesiumSource = "node_modules/cesium/Build/Cesium";
const cesiumBaseUrl = "cesiumStatic";

export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify(`/${cesiumBaseUrl}`),
  },
  plugins: [
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
