import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DEV_SERVER_URL = "ws://localhost:8787";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const devDefine = {
    "process.env.YIQIKAN_DEV_SERVER_URL": isDev
      ? JSON.stringify(DEV_SERVER_URL)
      : "undefined",
  };

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        ...devDefine,
        __DEV__: isDev ? "true" : "false",
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
      define: devDefine,
      build: {
        rollupOptions: {
          input: {
            index: resolve("src/preload/index.ts"),
            "webview-preload": resolve("src/preload/webview-preload.ts"),
          },
          output: {
            // Webview preload MUST be CJS — the webview sandbox
            // does not support ESM import statements.
            format: "cjs",
            entryFileNames: "[name].js",
          },
        },
      },
    },
    renderer: {
      resolve: {
        alias: {
          "@renderer": resolve("src/renderer/src"),
          "@yiqikan/shared": resolve("../../packages/shared/src/index.ts"),
        },
      },
      plugins: [tailwindcss() as any, react()],
      define: {
        // VITE_ prefix makes it available via import.meta.env in the renderer
        "import.meta.env.VITE_YIQIKAN_SERVER_URL": isDev
          ? JSON.stringify(DEV_SERVER_URL)
          : "undefined",
      },
    },
  };
});
