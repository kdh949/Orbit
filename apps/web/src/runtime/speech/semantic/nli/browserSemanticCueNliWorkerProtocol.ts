import type { SemanticCueNliHypothesisInput } from "./semanticCueNliProvider";

export type BrowserSemanticCueNliDevice = "webgpu" | "wasm";
export type BrowserSemanticCueNliDtype = "fp32";

export type BrowserSemanticCueNliLoadMessage = {
  type: "load";
  requestId: string;
  modelId: string;
  device: BrowserSemanticCueNliDevice;
  dtype: BrowserSemanticCueNliDtype;
};

export type BrowserSemanticCueNliInferMessage = {
  type: "infer";
  requestId: string;
  jobId: number;
  premise: string;
  hypotheses: readonly SemanticCueNliHypothesisInput[];
};

export type BrowserSemanticCueNliDisposeMessage = {
  type: "dispose";
};

export type BrowserSemanticCueNliWorkerRequest =
  | BrowserSemanticCueNliLoadMessage
  | BrowserSemanticCueNliInferMessage
  | BrowserSemanticCueNliDisposeMessage;

export type BrowserSemanticCueNliWorkerResponse =
  | {
      type: "loaded";
      requestId: string;
      provider: "browser-transformersjs";
      modelId: string;
      device: BrowserSemanticCueNliDevice;
      dtype: BrowserSemanticCueNliDtype;
      labelMapping: {
        entailment: number;
        neutral: number;
        contradiction: number;
      };
      loadedAtMs: number;
    }
  | {
      type: "result";
      requestId: string;
      jobId: number;
      decisions: Array<{
        cueId: string;
        hypothesis: string;
        entailmentScore: number;
        neutralScore: number;
        contradictionScore: number;
        latencyMs: number;
      }>;
    }
  | {
      type: "error";
      requestId: string;
      message: string;
    };
