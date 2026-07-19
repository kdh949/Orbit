import type {
  PronunciationAliasOrigin,
  PronunciationTermCategory,
} from "./pronunciation.schema";

export type StaticPronunciationDictionaryEntry = {
  source: string;
  aliases: readonly string[];
  category: PronunciationTermCategory;
  origin: Extract<PronunciationAliasOrigin, "static" | "domain">;
  confidence: number;
};

const entries: readonly StaticPronunciationDictionaryEntry[] = [
  product("OpenAI", ["오픈에이아이", "오픈 AI"]),
  product("React", ["리액트"]),
  word("browser", ["브라우저"]),
  product("GitHub", ["깃허브", "깃헙"]),
  product("Next.js", ["넥스트제이에스"]),
  product("Figma", ["피그마"]),
  product("Vercel", ["버셀", "베르셀"]),
  domain("WebRTC", ["웹알티씨"]),
  numeric("GPT-4", ["지피티 포", "지피티 사"], 0.82),
  mixed("UI/UX", ["유아이 유엑스"]),
];

export const staticPronunciationDictionary = new Map(
  entries.map((entry) => [normalizeDictionaryKey(entry.source), entry]),
);

export function normalizeDictionaryKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[\s./_+#-]+/g, "");
}

function product(
  source: string,
  aliases: readonly string[],
): StaticPronunciationDictionaryEntry {
  return {
    source,
    aliases,
    category: "product",
    origin: "static",
    confidence: 1,
  };
}

function word(
  source: string,
  aliases: readonly string[],
): StaticPronunciationDictionaryEntry {
  return {
    source,
    aliases,
    category: "word",
    origin: "static",
    confidence: 0.98,
  };
}

function domain(
  source: string,
  aliases: readonly string[],
): StaticPronunciationDictionaryEntry {
  return {
    source,
    aliases,
    category: "product",
    origin: "domain",
    confidence: 0.98,
  };
}

function numeric(
  source: string,
  aliases: readonly string[],
  confidence: number,
): StaticPronunciationDictionaryEntry {
  return {
    source,
    aliases,
    category: "numeric-symbol",
    origin: "static",
    confidence,
  };
}

function mixed(
  source: string,
  aliases: readonly string[],
): StaticPronunciationDictionaryEntry {
  return {
    source,
    aliases,
    category: "mixed",
    origin: "static",
    confidence: 0.98,
  };
}
