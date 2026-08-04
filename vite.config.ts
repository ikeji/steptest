import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages のようなサブパス配信でも動くよう相対パスで出力する
  base: "./",
  optimizeDeps: {
    exclude: ["replicad-opencascadejs"],
  },
  worker: {
    format: "es",
  },
});
