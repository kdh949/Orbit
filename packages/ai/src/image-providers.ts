import type {
  GeneratedImageProvider,
  GeneratedImageReferenceImage,
  ImageAssetCandidate,
  OfficialImageProvider,
  PublicImageSearchProvider,
} from "./provider-contracts";
import { X509Certificate } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { connect as tlsConnect, rootCertificates } from "node:tls";
import { deflateSync } from "node:zlib";

const maxImageBytes = 12 * 1024 * 1024;
const maxCertificateBytes = 128 * 1024;
const supplementalCaCache = new Map<string, string[]>();

export class DeterministicImageProvider
  implements
    GeneratedImageProvider,
    PublicImageSearchProvider,
    OfficialImageProvider
{
  constructor(
    private readonly options: {
      seed: number;
      delayMs: number;
      errorRatePercent: number;
    },
  ) {}

  generate(input: {
    prompt: string;
    aspectRatio?: "landscape" | "portrait" | "square";
    referenceImages?: readonly GeneratedImageReferenceImage[];
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate> {
    return this.createCandidate(input.prompt, {
      generationPrompt: input.prompt,
      sourceAuthority: "unknown",
      usageBasis: "generated",
    });
  }

  search(input: {
    query: string;
    excludeSourceAssetUrls?: readonly string[];
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate> {
    return this.createCandidate(input.query, {
      sourceUrl: "https://load-test.invalid/public-source",
      sourceAssetUrl: "https://load-test.invalid/public-image.png",
      sourceAuthority: "independent",
      usageBasis: "licensed",
      author: "ORBIT deterministic load test",
      license: "load-test-only",
    });
  }

  fetch(input: {
    sourceUrls: string[];
    query: string;
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate> {
    return this.createCandidate(input.query, {
      sourceUrl: "https://load-test.invalid/official-source",
      sourceAssetUrl: "https://load-test.invalid/official-image.png",
      sourceAuthority: "official",
      usageBasis: "official-reference",
    });
  }

  private async createCandidate(
    key: string,
    metadata: Omit<
      ImageAssetCandidate,
      "body" | "mimeType" | "fileName" | "provider" | "checkedAt"
    >,
  ): Promise<ImageAssetCandidate> {
    if (this.options.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
    }
    const hash = stableHash(`${this.options.seed}:${key}`);
    if (hash % 100 < this.options.errorRatePercent) {
      throw new Error("Deterministic load-test image provider failure");
    }
    return {
      body: createSolidPng(1280, 720, hash),
      mimeType: "image/png",
      fileName: "deterministic-load-test.png",
      provider: "deterministic-load-test",
      checkedAt: new Date(0).toISOString(),
      ...metadata,
    };
  }
}

export class OpenAiGeneratedImageProvider implements GeneratedImageProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model = "gpt-image-1",
  ) {}

  async generate(input: {
    prompt: string;
    aspectRatio?: "landscape" | "portrait" | "square";
    referenceImages?: readonly GeneratedImageReferenceImage[];
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate> {
    const referenceImages = input.referenceImages;
    if (referenceImages?.length) {
      return this.editFromReferences({ ...input, referenceImages });
    }
    const response = await fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          prompt: input.prompt,
          size:
            input.aspectRatio === "portrait"
              ? "1024x1536"
              : input.aspectRatio === "square"
                ? "1024x1024"
                : "1536x1024",
          quality: "medium",
          output_format: "png",
        }),
        signal: input.abortSignal,
      },
    );
    if (!response.ok) {
      throw new Error(
        `OpenAI image generation failed with status ${response.status}`,
      );
    }
    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const encoded = payload.data?.[0]?.b64_json;
    if (!encoded)
      throw new Error("OpenAI image generation returned no image data");
    const body = Uint8Array.from(Buffer.from(encoded, "base64"));
    assertImageSize(body);
    return {
      body,
      mimeType: "image/png",
      fileName: "ai-generated.png",
      provider: "openai",
      checkedAt: new Date().toISOString(),
      generationPrompt: input.prompt,
      sourceAuthority: "unknown",
      usageBasis: "generated",
    };
  }

  private async editFromReferences(input: {
    prompt: string;
    aspectRatio?: "landscape" | "portrait" | "square";
    referenceImages: readonly GeneratedImageReferenceImage[];
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate> {
    const form = new FormData();
    form.set("model", this.model);
    form.set("prompt", input.prompt);
    form.set(
      "size",
      input.aspectRatio === "portrait"
        ? "1024x1536"
        : input.aspectRatio === "square"
          ? "1024x1024"
          : "1536x1024",
    );
    form.set("quality", "medium");
    form.set("output_format", "png");
    form.set("input_fidelity", "high");
    for (const reference of input.referenceImages) {
      form.append(
        "image[]",
        new Blob([reference.body], { type: reference.mimeType }),
        reference.fileName,
      );
    }
    const response = await fetch("https://api.openai.com/v1/images/edits", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
      signal: input.abortSignal,
    });
    if (!response.ok) {
      throw new Error(
        `OpenAI image generation failed with status ${response.status}`,
      );
    }
    const payload = (await response.json()) as {
      data?: Array<{ b64_json?: string }>;
    };
    const encoded = payload.data?.[0]?.b64_json;
    if (!encoded)
      throw new Error("OpenAI image generation returned no image data");
    const body = Uint8Array.from(Buffer.from(encoded, "base64"));
    assertImageSize(body);
    return {
      body,
      mimeType: "image/png",
      fileName: "ai-generated.png",
      provider: "openai",
      checkedAt: new Date().toISOString(),
      generationPrompt: input.prompt,
      sourceAuthority: "unknown",
      usageBasis: "generated",
    };
  }
}

type OpenverseImage = {
  url?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  creator?: string;
  license?: string;
  license_url?: string;
  foreign_landing_url?: string;
  title?: string;
  tags?: Array<string | { name?: string }>;
};

export class OpenversePublicImageSearchProvider implements PublicImageSearchProvider {
  async search(input: {
    query: string;
    excludeSourceAssetUrls?: readonly string[];
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate> {
    const excludedUrls = new Set(input.excludeSourceAssetUrls ?? []);
    let candidates: OpenverseImage[] = [];
    for (const query of openverseSearchQueries(input.query)) {
      const searchUrl = new URL("https://api.openverse.org/v1/images/");
      searchUrl.searchParams.set("q", query);
      searchUrl.searchParams.set("page_size", "20");
      searchUrl.searchParams.set("size", "large,medium");
      searchUrl.searchParams.set("aspect_ratio", "wide");
      const response = await fetch(searchUrl, { signal: input.abortSignal });
      if (!response.ok) {
        throw new Error(
          `Openverse image search failed with status ${response.status}`,
        );
      }
      const payload = (await response.json()) as { results?: OpenverseImage[] };
      candidates = (payload.results ?? []).filter(
        (item) =>
          (item.url || item.thumbnail) &&
          item.license &&
          item.foreign_landing_url &&
          ![item.url, item.thumbnail].some(
            (url) => url && excludedUrls.has(url),
          ) &&
          (!item.width ||
            !item.height ||
            (item.width >= 640 && item.height >= 360)) &&
          isRelevantOpenverseCandidate(input.query, item),
      );
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) {
      throw new Error("Openverse returned no licensed image candidate");
    }

    let lastError: unknown;
    for (const candidate of candidates.slice(0, 5)) {
      for (const imageUrl of uniqueUrls(candidate.url, candidate.thumbnail)) {
        try {
          const imageResponse = await fetchPublicUrl(imageUrl, {
            signal: input.abortSignal,
            accept: "image/*",
          });
          if (!imageResponse.ok) {
            throw new Error(
              `Public image download failed with status ${imageResponse.status}`,
            );
          }
          const mimeType = supportedImageMimeType(
            imageResponse.headers.get("content-type"),
          );
          const body = new Uint8Array(await imageResponse.arrayBuffer());
          assertImageSize(body);
          return {
            body,
            mimeType,
            fileName: fileNameForMime(
              candidate.title || "public-image",
              mimeType,
            ),
            provider: "openverse",
            sourceUrl: candidate.foreign_landing_url,
            sourceAssetUrl: imageResponse.url || imageUrl,
            sourceAuthority: "independent",
            usageBasis: "licensed",
            author: candidate.creator?.trim() || "Unknown creator",
            license: candidate.license_url || candidate.license,
            checkedAt: new Date().toISOString(),
          };
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw lastError ?? new Error("Openverse image candidates were unavailable");
  }
}

export class OfficialWebImageProvider implements OfficialImageProvider {
  async fetch(input: {
    sourceUrls: string[];
    query: string;
    abortSignal?: AbortSignal;
  }): Promise<ImageAssetCandidate> {
    let lastError: unknown;
    for (const sourceUrl of [...new Set(input.sourceUrls)].slice(0, 4)) {
      try {
        const page = await fetchPublicUrl(sourceUrl, {
          accept: "text/html,application/xhtml+xml",
          signal: input.abortSignal,
        });
        if (!page.ok) {
          throw new Error(
            `Official source page failed with status ${page.status}`,
          );
        }
        const contentType =
          page.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("text/html")) {
          throw new Error("Official source page is not HTML");
        }
        const contentLength = Number(page.headers.get("content-length") ?? 0);
        if (contentLength > 1_500_000) {
          throw new Error("Official source page exceeds the HTML size limit");
        }
        const html = await page.text();
        if (html.length > 1_500_000) {
          throw new Error("Official source page exceeds the HTML size limit");
        }
        const imageUrls = officialImageUrls(html, page.url || sourceUrl);
        if (imageUrls.length === 0) {
          throw new Error("Official source page has no representative image");
        }
        for (const imageUrl of imageUrls) {
          try {
            const image = await fetchPublicUrl(imageUrl, {
              accept: "image/*",
              signal: input.abortSignal,
            });
            if (!image.ok) {
              throw new Error(
                `Official image download failed with status ${image.status}`,
              );
            }
            const mimeType = supportedImageMimeType(
              image.headers.get("content-type"),
            );
            const body = new Uint8Array(await image.arrayBuffer());
            assertImageSize(body);
            return {
              body,
              mimeType,
              fileName: fileNameForMime(
                input.query || "official-image",
                mimeType,
              ),
              provider: "official-web",
              sourceUrl: page.url || sourceUrl,
              sourceAssetUrl: image.url || imageUrl,
              sourceAuthority: "official",
              usageBasis: "official-reference",
              checkedAt: new Date().toISOString(),
            };
          } catch (error) {
            lastError = error;
          }
        }
        throw (
          lastError ?? new Error("Official image candidates were unavailable")
        );
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("Official sources produced no usable image");
  }
}

function officialImageUrl(html: string, baseUrl: string) {
  const patterns = [
    /<meta\s+[^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<meta\s+[^>]*content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*>/i,
    /<link\s+[^>]*rel=["']image_src["'][^>]*href=["']([^"']+)["'][^>]*>/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (!match?.[1]) continue;
    const decoded = match[1].replaceAll("&amp;", "&").trim();
    try {
      return new URL(decoded, baseUrl).toString();
    } catch {
      continue;
    }
  }
  return null;
}

function officialImageUrls(html: string, baseUrl: string) {
  const representative = officialImageUrl(html, baseUrl);
  const trailerThumbnails = officialYoutubeVideoIds(html).map(
    (videoId) => `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
  );
  return [
    ...(representative && /(?:^|[\W_])logo(?:[\W_]|$)/i.test(representative)
      ? trailerThumbnails
      : []),
    representative,
    ...trailerThumbnails,
  ].filter(
    (value, index, values): value is string =>
      Boolean(value) && values.indexOf(value) === index,
  );
}

function officialYoutubeVideoIds(html: string) {
  const ids: string[] = [];
  const urlPattern =
    /(?:youtube\.com\/(?:embed\/|watch\?v=)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/gi;
  const contentPattern =
    /"contentType"[\s\S]{0,300}?"id":"youTubeVideo"[\s\S]{0,600}?"fields":\{[\s\S]{0,300}?"id":"([a-zA-Z0-9_-]{6,})"/gi;
  for (const pattern of [urlPattern, contentPattern]) {
    for (const match of html.matchAll(pattern)) {
      if (match[1]) ids.push(match[1]);
    }
  }
  return [...new Set(ids)];
}

async function fetchPublicUrl(
  rawUrl: string,
  input: { accept: string; signal?: AbortSignal },
) {
  let url = new URL(rawUrl);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicHttpUrl(url);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        headers: { accept: input.accept },
        signal: input.signal,
      });
    } catch (error) {
      if (
        url.protocol !== "https:" ||
        !isMissingIntermediateCertificateError(error)
      ) {
        throw error;
      }
      response = await fetchWithSupplementalCa(url, input);
    }
    if (response.status < 300 || response.status >= 400) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error("External redirect is missing a location");
    url = new URL(location, url);
  }
  throw new Error("External redirect limit exceeded");
}

function isMissingIntermediateCertificateError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "cause" in error &&
    typeof error.cause === "object" &&
    error.cause !== null &&
    "code" in error.cause &&
    error.cause.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  );
}

async function fetchWithSupplementalCa(
  url: URL,
  input: { accept: string; signal?: AbortSignal },
) {
  const cacheKey = url.origin;
  let ca = supplementalCaCache.get(cacheKey);
  if (!ca) {
    ca = await resolveSupplementalCa(url, input.signal);
    supplementalCaCache.set(cacheKey, ca);
  }
  return requestWithCa(url, input, ca);
}

async function resolveSupplementalCa(url: URL, signal?: AbortSignal) {
  const peer = await peerCertificate(url, signal);
  const issuerUrl = peer.infoAccess?.["CA Issuers - URI"]?.[0];
  if (!issuerUrl) throw new Error("TLS certificate has no CA Issuers URL");
  const certificateBody = await fetchIssuerCertificate(issuerUrl, signal);
  const leaf = new X509Certificate(peer.raw);
  const intermediate = new X509Certificate(certificateBody);
  if (leaf.issuer !== intermediate.subject) {
    throw new Error("AIA certificate does not match the TLS leaf issuer");
  }
  const trustedRoot = rootCertificates.find((pem) => {
    try {
      return new X509Certificate(pem).subject === intermediate.issuer;
    } catch {
      return false;
    }
  });
  if (!trustedRoot) {
    throw new Error("AIA certificate is not chained to a trusted Node root");
  }
  return [intermediate.toString(), trustedRoot];
}

async function peerCertificate(url: URL, signal?: AbortSignal) {
  return new Promise<{
    raw: Buffer;
    infoAccess?: Record<string, string[] | undefined>;
  }>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("TLS certificate discovery was aborted"));
      return;
    }
    const socket = tlsConnect({
      host: url.hostname,
      port: Number(url.port || 443),
      servername: url.hostname,
      rejectUnauthorized: false,
    });
    const onAbort = () =>
      socket.destroy(new Error("TLS certificate discovery was aborted"));
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.once("secureConnect", () => {
      const certificate = socket.getPeerCertificate(true);
      cleanup();
      socket.end();
      if (!certificate.raw) {
        reject(new Error("TLS peer certificate is unavailable"));
        return;
      }
      resolve({
        raw: certificate.raw,
        infoAccess: certificate.infoAccess,
      });
    });
    socket.once("error", (error) => {
      cleanup();
      reject(error);
    });
  });
}

async function fetchIssuerCertificate(rawUrl: string, signal?: AbortSignal) {
  let url = new URL(rawUrl);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    await assertPublicHttpUrl(url);
    const response = await fetch(url, {
      redirect: "manual",
      headers: {
        accept: "application/pkix-cert,application/x-x509-ca-cert",
      },
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("CA Issuers redirect has no location");
      url = new URL(location, url);
      continue;
    }
    if (!response.ok) {
      throw new Error(
        `CA Issuers request failed with status ${response.status}`,
      );
    }
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > maxCertificateBytes) {
      throw new Error("CA Issuers certificate exceeds the size limit");
    }
    const body = new Uint8Array(await response.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > maxCertificateBytes) {
      throw new Error("CA Issuers certificate has an invalid size");
    }
    return body;
  }
  throw new Error("CA Issuers redirect limit exceeded");
}

function requestWithCa(
  url: URL,
  input: { accept: string; signal?: AbortSignal },
  ca: string[],
) {
  return new Promise<Response>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: "GET",
        headers: { accept: input.accept },
        signal: input.signal,
        ca,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let sizeLimitExceeded = false;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > maxImageBytes) {
            sizeLimitExceeded = true;
            request.destroy(
              new Error("External response exceeds the size limit"),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.once("end", () => {
          if (sizeLimitExceeded) return;
          const headers = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) {
              value.forEach((item) => headers.append(name, item));
            } else if (value !== undefined) {
              headers.set(name, value);
            }
          }
          const body = Buffer.concat(chunks);
          resolve(
            new Response(body.byteLength > 0 ? body : null, {
              status: response.statusCode ?? 500,
              headers,
            }),
          );
        });
      },
    );
    request.once("error", reject);
    request.end();
  });
}

async function assertPublicHttpUrl(url: URL) {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("External asset URL must use public HTTP(S)");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("External asset URL uses a disallowed port");
  }
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("External asset URL cannot target localhost");
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true });
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => isPrivateAddress(address))
  ) {
    throw new Error("External asset URL resolved to a private network");
  }
}

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff") ||
    normalized.startsWith("2001:db8")
  ) {
    return true;
  }
  const ipv4 = mappedIpv4Address(normalized);
  const parts = ipv4.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part)))
    return false;
  const [first, second] = parts;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function mappedIpv4Address(address: string) {
  if (!address.startsWith("::ffff:")) return address;
  const mapped = address.slice("::ffff:".length);
  if (mapped.includes(".")) return mapped;
  const [high, low] = mapped
    .split(":")
    .map((part) => Number.parseInt(part, 16));
  if (!Number.isInteger(high) || !Number.isInteger(low)) return address;
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
}

const relevanceStopWords = new Set([
  "and",
  "clear",
  "diagram",
  "image",
  "media",
  "none",
  "presentation",
  "showing",
  "the",
  "visual",
  "with",
]);

const searchModifierWords = new Set([
  "exterior",
  "interior",
  "night",
  "photo",
  "photograph",
  "photorealistic",
  "realistic",
]);

function openverseSearchQueries(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim();
  const identityTokens = relevantTokens(normalized).filter(
    (token) => !searchModifierWords.has(token),
  );
  const compact = identityTokens.slice(0, 4).join(" ");
  return [...new Set([normalized, compact, identityTokens[0]].filter(Boolean))];
}

function isRelevantOpenverseCandidate(
  query: string,
  candidate: OpenverseImage,
) {
  const queryTokens = relevantTokens(query);
  const candidateTokens = relevantTokens(
    [
      candidate.title,
      ...(candidate.tags ?? []).map((tag) =>
        typeof tag === "string" ? tag : tag.name,
      ),
    ]
      .filter(Boolean)
      .join(" "),
  );
  return queryTokens.some((queryToken) =>
    candidateTokens.some(
      (candidateToken) =>
        queryToken === candidateToken ||
        (queryToken.length >= 4 &&
          candidateToken.length >= 4 &&
          (queryToken.startsWith(candidateToken) ||
            candidateToken.startsWith(queryToken))),
    ),
  );
}

function relevantTokens(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 3 && !relevanceStopWords.has(token));
}

function uniqueUrls(...values: Array<string | undefined>) {
  return [
    ...new Set(values.filter((value): value is string => Boolean(value))),
  ];
}

function supportedImageMimeType(
  raw: string | null,
): ImageAssetCandidate["mimeType"] {
  const mime = raw?.split(";", 1)[0]?.trim().toLowerCase();
  if (mime === "image/png" || mime === "image/jpeg" || mime === "image/webp") {
    return mime;
  }
  throw new Error(`Unsupported public image MIME type: ${mime || "unknown"}`);
}

function assertImageSize(body: Uint8Array) {
  if (body.byteLength === 0 || body.byteLength > maxImageBytes) {
    throw new Error(`Image byte size must be between 1 and ${maxImageBytes}`);
  }
}

function fileNameForMime(
  title: string,
  mimeType: ImageAssetCandidate["mimeType"],
) {
  const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
  const sanitized =
    title.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-|-$/g, "") ||
    "public-image";
  const stem = sanitized.slice(0, 96).replace(/[._-]+$/g, "") || "public-image";
  return `${stem}.${extension}`;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const byte of Buffer.from(value, "utf8")) {
    hash ^= byte;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function createSolidPng(width: number, height: number, colorSeed: number) {
  const red = colorSeed & 0xff;
  const green = (colorSeed >>> 8) & 0xff;
  const blue = (colorSeed >>> 16) & 0xff;
  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const offset = y * stride;
    raw[offset] = 0;
    for (let x = 0; x < width; x += 1) {
      const pixel = offset + 1 + x * 3;
      raw[pixel] = red;
      raw[pixel + 1] = green;
      raw[pixel + 2] = blue;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk("IHDR", header),
      pngChunk("IDAT", deflateSync(raw)),
      pngChunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

function pngChunk(type: string, data: Buffer) {
  const typeBytes = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([length, typeBytes, data, checksum]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
