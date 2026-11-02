import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

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
      plugins: [externalizeDepsPlugin({ exclude: ["@yiqikan/shared"] })],
      resolve: {
        alias: {
          "@yiqikan/shared": resolve("../../packages/shared/src/index.ts"),
        },
      },
      define: {
        ...devDefine,
        __DEV__: isDev ? "true" : "false",
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin({ exclude: ["@yiqikan/shared"] })],
      resolve: {
        alias: {
          "@yiqikan/shared": resolve("../../packages/shared/src/index.ts"),
        },
      },
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
      build: {
        rollupOptions: {
          input: {
            error: resolve("src/renderer/error.html"),
          },
        },
      },
    },
  };
});
