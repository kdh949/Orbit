import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv } from "vite";

const rootDir = fileURLToPath(new URL("../..", import.meta.url));

interface WebEnvConfig {
  appEnv: string;
  apiBaseUrl: string;
  webPort: number;
}

const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin"
} as const;

const allowedHosts = ["orbit.dhkim.cloud"];

function requireWebEnv(
  env: Record<string, string | undefined>,
  key: string
): string {
  const value = env[key]?.trim();

  if (!value) {
    throw new Error(
      `Invalid ORBIT environment for web.\n- ${key}: ${key} is required`
    );
  }

  return value;
}

function loadWebEnv(mode: string): WebEnvConfig {
  const env = { ...loadEnv(mode, rootDir, ""), ...process.env };
  const appEnv = requireWebEnv(env, "APP_ENV");
  const apiBaseUrl = requireWebEnv(env, "API_BASE_URL");
  const webPort = Number(requireWebEnv(env, "WEB_PORT"));

  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
    throw new Error(
      "Invalid ORBIT environment for web.\n- WEB_PORT: WEB_PORT must be a valid port"
    );
  }

  try {
    new URL(apiBaseUrl);
  } catch {
    throw new Error(
      "Invalid ORBIT environment for web.\n- API_BASE_URL: API_BASE_URL must be a valid URL"
    );
  }

  if (
    (appEnv === "staging" || appEnv === "production") &&
    apiBaseUrl === "http://localhost:3000"
  ) {
    throw new Error(
      `Invalid ORBIT environment for web.\n- API_BASE_URL: API_BASE_URL must not use the local default in ${appEnv}`
    );
  }

  return { appEnv, apiBaseUrl, webPort };
}

export default defineConfig(({ mode }) => {
  const env = loadWebEnv(mode);

  return {
    envDir: rootDir,
    plugins: [react()],
    worker: {
      // The sherpa live STT runtime is a classic worker that loads WASM with importScripts.
      // Browser semantic cue NLI is built separately as an ES module worker asset.
      format: "iife"
    },
    server: {
      host: "0.0.0.0",
      port: env.webPort,
      allowedHosts,
      headers: crossOriginIsolationHeaders,
      proxy: {
        "/api/v1": {
          target: env.apiBaseUrl,
          changeOrigin: true
        },
        "/api": {
          target: env.apiBaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, "")
        },
        "/socket.io": {
          target: env.apiBaseUrl,
          changeOrigin: true,
          ws: true
        }
      }
    },
    preview: {
      host: "0.0.0.0",
      port: env.webPort,
      allowedHosts,
      headers: crossOriginIsolationHeaders
    }
  };
});
