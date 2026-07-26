import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workerEntry = resolve(
  appRoot,
  "src/runtime/speech/semantic/nli/browserSemanticCueNliWorker.ts"
);

await build({
  root: appRoot,
  configFile: false,
  publicDir: false,
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    minify: "esbuild",
    outDir: resolve(appRoot, "dist"),
    sourcemap: false,
    target: "es2022",
    rollupOptions: {
      input: workerEntry,
      output: {
        assetFileNames: "assets/semantic-cue-nli-worker-[name]-[hash][extname]",
        chunkFileNames: "assets/semantic-cue-nli-worker-[name]-[hash].js",
        entryFileNames: "semantic-cue-nli-worker.js",
        format: "es"
      }
    }
  }
});
