import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assetsRoot = join(packageRoot, "assets");
const webRoot = join(assetsRoot, "web");
const desktopRoot = join(assetsRoot, "desktop");
const licenseRoot = join(assetsRoot, "licenses");
const downloadWaiters = [];
let activeDownloads = 0;
const maxConcurrentDownloads = 16;

const fonts = [
  font("pretendard", "Pretendard", "basic", "sans-serif", true, [400, 700]),
  font("noto-sans-kr", "Noto Sans KR", "basic", "sans-serif", true, [400, 700], true),
  font("gowun-dodum", "Gowun Dodum", "basic", "sans-serif", true, [400]),
  font("noto-serif-kr", "Noto Serif KR", "korean-design", "serif", true, [400, 700], true),
  font("nanum-myeongjo", "Nanum Myeongjo", "korean-design", "serif", true, [400, 700]),
  font("black-han-sans", "Black Han Sans", "korean-design", "display", true, [400]),
  font("do-hyeon", "Do Hyeon", "korean-design", "display", true, [400]),
  font("jua", "Jua", "korean-design", "display", true, [400]),
  font("montserrat", "Montserrat", "english-design", "sans-serif", false, [400, 700], true),
  font("poppins", "Poppins", "english-design", "sans-serif", false, [400, 700]),
  font("playfair-display", "Playfair Display", "english-design", "serif", false, [400, 700], true),
  font("merriweather", "Merriweather", "english-design", "serif", false, [400, 700], true),
  font("bebas-neue", "Bebas Neue", "english-design", "display", false, [400]),
];

function font(id, family, group, category, supportsKorean, weights, variableWeb = false) {
  return { id, family, group, category, supportsKorean, weights, variableWeb };
}

async function main() {
  await rm(webRoot, { force: true, recursive: true });
  await rm(desktopRoot, { force: true, recursive: true });
  await mkdir(webRoot, { recursive: true });
  await mkdir(desktopRoot, { recursive: true });
  await mkdir(licenseRoot, { recursive: true });

  const catalog = [];
  for (const definition of fonts) {
    catalog.push(await syncFontsourceFont(definition));
  }
  catalog.splice(3, 0, await syncNanumSquareRound());
  catalog.splice(4, 0, await syncGmarketSans());

  await writeFile(
    join(assetsRoot, "manifest.json"),
    `${JSON.stringify({ fonts: catalog }, null, 2)}\n`,
  );
  await writeFile(join(packageRoot, "src/generated.ts"), renderTypescript(catalog));
}

async function syncFontsourceFont(definition) {
  const metadata = await fetchJson(`https://api.fontsource.org/v1/fonts/${definition.id}`);
  const referenceWeight = String(definition.weights[0]);
  const availableSubsets = Object.keys(
    metadata.variants[referenceWeight]?.normal ?? {},
  );
  const hasNumericKoreanSubsets = availableSubsets.some((subset) => /^\d+$/.test(subset));
  const subsets = definition.supportsKorean
    ? availableSubsets.filter((subset) =>
        subset === "latin" ||
        (hasNumericKoreanSubsets ? /^\d+$/.test(subset) : subset === "korean"),
      )
    : ["latin"];
  const faces = [];
  const faceJobs = [];

  if (definition.variableWeb) {
    for (const subset of subsets) {
      const filename = `${definition.id}-${subset}-variable-normal.woff2`;
      const url = `https://cdn.jsdelivr.net/fontsource/fonts/${definition.id}:vf@${metadata.npmVersion}/${subset}-wght-normal.woff2`;
      faceJobs.push(downloadFace({
        destination: join(webRoot, filename),
        filename,
        format: "woff2",
        kind: "web",
        style: "normal",
        subset,
        unicodeRange: metadata.unicodeRange[subset] ?? metadata.unicodeRange[`[${subset}]`],
        url,
        weight: `${Math.min(...metadata.weights)} ${Math.max(...metadata.weights)}`,
      }));
    }
  } else {
    for (const weight of definition.weights) {
      for (const subset of subsets) {
        const variant = metadata.variants[String(weight)]?.normal?.[subset];
        if (!variant) continue;
        const filename = `${definition.id}-${subset}-${weight}-normal.woff2`;
        faceJobs.push(downloadFace({
          destination: join(webRoot, filename),
          filename,
          format: "woff2",
          kind: "web",
          style: "normal",
          subset,
          unicodeRange: metadata.unicodeRange[subset] ?? metadata.unicodeRange[`[${subset}]`],
          url: pinFontsourceUrl(variant.url.woff2, metadata.npmVersion),
          weight: String(weight),
        }));
      }
    }
  }

  for (const weight of definition.weights) {
    for (const subset of subsets) {
      const variant = metadata.variants[String(weight)]?.normal?.[subset];
      if (!variant?.url.ttf) continue;
      const filename = `${definition.id}-${subset}-${weight}-normal.ttf`;
      faceJobs.push(downloadFace({
        destination: join(desktopRoot, filename),
        fallbackUrl: variant.url.ttf,
        filename,
        format: "truetype",
        kind: "desktop",
        style: "normal",
        subset,
        unicodeRange: metadata.unicodeRange[subset] ?? metadata.unicodeRange[`[${subset}]`],
        url: pinFontsourceUrl(variant.url.ttf, metadata.npmVersion),
        weight: String(weight),
      }));
    }
  }
  faces.push(...await Promise.all(faceJobs));

  const licenseFilename = `${definition.id}-OFL.txt`;
  const licenseUrl = definition.id === "pretendard"
    ? "https://raw.githubusercontent.com/orioncactus/pretendard/v1.3.9/LICENSE"
    : `https://raw.githubusercontent.com/google/fonts/main/ofl/${definition.id.replaceAll("-", "")}/OFL.txt`;
  const license = await downloadFile(licenseUrl, join(licenseRoot, licenseFilename));

  return {
    ...definition,
    faces,
    license: { filename: licenseFilename, sha256: sha256(license), url: licenseUrl },
    sourceUrl: metadata.source,
    version: metadata.version,
    assetVersion: metadata.npmVersion,
  };
}

async function syncNanumSquareRound() {
  const baseUrl = "https://hangeul.pstatic.net/hangeul_static/webfont/NanumSquareRound";
  const faces = [];
  for (const [weight, suffix] of [[400, "R"], [700, "B"]]) {
    for (const [kind, extension, format, root] of [
      ["web", "woff2", "woff2", webRoot],
      ["desktop", "ttf", "truetype", desktopRoot],
    ]) {
      const filename = `nanum-square-round-korean-${weight}-normal.${extension}`;
      faces.push(await downloadFace({
        destination: join(root, filename), filename, format, kind,
        style: "normal", subset: "korean",
        url: `${baseUrl}/NanumSquareRound${suffix}.${extension}`,
        weight: String(weight),
      }));
    }
  }
  const licenseFilename = "nanum-square-round-LICENSE.txt";
  const licenseText = `네이버 나눔글꼴 라이선스\nhttps://hangeul.naver.com/font\n\n네이버 글꼴은 개인 및 기업 사용자를 포함한 모든 사용자에게 무료로 제공되며, 글꼴 자체를 유료로 판매하는 것을 제외하고 자유롭게 사용할 수 있습니다.\n`;
  await writeFile(join(licenseRoot, licenseFilename), licenseText);
  return {
    id: "nanum-square-round", family: "NanumSquareRound", group: "basic",
    category: "display", supportsKorean: true, weights: [400, 700], variableWeb: false,
    faces, sourceUrl: "https://hangeul.naver.com/font", version: "official-webfont",
    assetVersion: "official-webfont",
    license: { filename: licenseFilename, sha256: sha256(Buffer.from(licenseText)), url: "https://hangeul.naver.com/font" },
  };
}

async function syncGmarketSans() {
  const work = join(tmpdir(), `orbit-gmarket-${process.pid}`);
  await rm(work, { force: true, recursive: true });
  await mkdir(work, { recursive: true });
  const zipPath = join(work, "GmarketSansTTF.zip");
  await downloadFile("https://corp.gmarket.com/fonts/GmarketSansTTF.zip", zipPath);
  execFileSync("unzip", ["-q", zipPath, "-d", work]);
  const faces = [];
  for (const [weight, sourceName] of [[400, "GmarketSansTTFMedium.ttf"], [700, "GmarketSansTTFBold.ttf"]]) {
    const sourcePath = join(work, sourceName);
    const bytes = await readFile(sourcePath);
    const filename = `gmarket-sans-korean-${weight}-normal.ttf`;
    await writeFile(join(webRoot, filename), bytes);
    await writeFile(join(desktopRoot, filename), bytes);
    for (const kind of ["web", "desktop"]) {
      faces.push({ filename, format: "truetype", kind, sha256: sha256(bytes), style: "normal", subset: "korean", weight: String(weight) });
    }
  }
  await rm(work, { force: true, recursive: true });
  const licenseFilename = "gmarket-sans-OFL.txt";
  const licenseText = `Gmarket Sans - SIL Open Font License\nhttps://corp.gmarket.com/fonts/\n\nGmarket Sans는 SIL Open Font License에 따라 개인 또는 기업이 영리적, 비영리적 목적으로 자유롭게 사용할 수 있습니다.\n`;
  await writeFile(join(licenseRoot, licenseFilename), licenseText);
  return {
    id: "gmarket-sans", family: "Gmarket Sans", group: "basic", category: "display",
    supportsKorean: true, weights: [400, 700], variableWeb: false, faces,
    sourceUrl: "https://corp.gmarket.com/fonts/", version: "official-ttf", assetVersion: "official-ttf",
    license: { filename: licenseFilename, sha256: sha256(Buffer.from(licenseText)), url: "https://corp.gmarket.com/fonts/" },
  };
}

async function downloadFace(input) {
  let bytes;
  try {
    bytes = await downloadFile(input.url, input.destination);
  } catch (error) {
    if (!input.fallbackUrl) throw error;
    bytes = await downloadFile(input.fallbackUrl, input.destination);
  }
  return {
    filename: input.filename,
    format: input.format,
    kind: input.kind,
    sha256: sha256(bytes),
    style: input.style,
    subset: input.subset,
    unicodeRange: input.unicodeRange,
    weight: input.weight,
  };
}

async function downloadFile(url, destination) {
  return withDownloadSlot(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    return bytes;
  });
}

async function withDownloadSlot(task) {
  if (activeDownloads >= maxConcurrentDownloads) {
    await new Promise((resolveWaiter) => downloadWaiters.push(resolveWaiter));
  }
  activeDownloads += 1;
  try {
    return await task();
  } finally {
    activeDownloads -= 1;
    downloadWaiters.shift()?.();
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

function pinFontsourceUrl(url, version) {
  return url.replace("@latest/", `@${version}/`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function renderTypescript(catalog) {
  const serialized = catalog.map((entry) => ({
    ...entry,
    faces: entry.faces.filter((face) => face.kind === "web").map((face) => ({
      ...face,
      urlExpression: `new URL(\"../assets/web/${face.filename}\", import.meta.url).href`,
    })),
  }));
  const body = serialized.map((entry) => {
    const faces = entry.faces.map(({ urlExpression, ...face }) =>
      `{ ...${JSON.stringify(face)}, url: ${urlExpression} }`
    ).join(",\n      ");
    const withoutFaces = { ...entry };
    delete withoutFaces.faces;
    return `{ ...${JSON.stringify(withoutFaces)}, faces: [\n      ${faces}\n    ] }`;
  }).join(",\n  ");
  return `export type FontAssetGroup = "basic" | "korean-design" | "english-design";\nexport type FontAssetCategory = "sans-serif" | "serif" | "display";\nexport type FontAssetSubset = string;\nexport type FontAssetFace = { filename: string; format: "woff2" | "truetype"; kind: "web"; sha256: string; style: string; subset: FontAssetSubset; unicodeRange?: string; weight: string; url: string };\nexport type FontAssetDefinition = { id: string; family: string; group: FontAssetGroup; category: FontAssetCategory; supportsKorean: boolean; weights: number[]; variableWeb: boolean; faces: FontAssetFace[]; sourceUrl: string; version: string; assetVersion: string; license: { filename: string; sha256: string; url: string } };\n\nexport const fontAssetCatalog = [\n  ${body}\n] as const satisfies readonly FontAssetDefinition[];\n\nexport const fontAssetCatalogByFamily = new Map(fontAssetCatalog.map((font) => [font.family, font] as const));\n`;
}

await main();
