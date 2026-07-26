export type ImageAssetCandidate = {
  body: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  provider: string;
  sourceUrl?: string;
  sourceAssetUrl?: string;
  sourceAuthority?: "official" | "independent" | "unknown";
  usageBasis?:
    | "user-provided"
    | "licensed"
    | "official-reference"
    | "generated";
  author?: string;
  license?: string;
  checkedAt?: string;
  generationPrompt?: string;
};

export type GeneratedImageReferenceImage = {
  body: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  fileName: string;
  inputFidelity?: "high" | "low";
};

export interface GeneratedImageProvider {
  generate(input: {
    prompt: string;
    aspectRatio?: "landscape" | "portrait" | "square";
    referenceImages?: readonly GeneratedImageReferenceImage[];
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate>;
}

export interface PublicImageSearchProvider {
  search(input: {
    query: string;
    excludeSourceAssetUrls?: readonly string[];
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate>;
}

export interface OfficialImageProvider {
  fetch(input: {
    sourceUrls: string[];
    query: string;
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate>;
}
