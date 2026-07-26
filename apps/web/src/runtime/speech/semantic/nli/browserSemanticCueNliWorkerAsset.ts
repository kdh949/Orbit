export type BrowserSemanticCueNliWorkerAssetEnv = {
  readonly DEV: boolean;
  readonly BASE_URL: string;
};

const devWorkerUrl = "/src/runtime/speech/semantic/nli/browserSemanticCueNliWorker.ts";
const productionWorkerFileName = "semantic-cue-nli-worker.js";

export function resolveBrowserSemanticCueNliWorkerUrl(
  env: BrowserSemanticCueNliWorkerAssetEnv = import.meta.env
) {
  if (env.DEV) {
    return devWorkerUrl;
  }

  return joinBaseUrl(env.BASE_URL, productionWorkerFileName);
}

function joinBaseUrl(baseUrl: string, fileName: string) {
  if (!baseUrl) {
    return fileName;
  }

  return baseUrl.endsWith("/") ? `${baseUrl}${fileName}` : `${baseUrl}/${fileName}`;
}
