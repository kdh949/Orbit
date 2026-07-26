import type { Slide } from "@orbit/shared/deck";
import { IconExternalLink as ExternalLink } from "@tabler/icons-react";

export function SourceLedgerPanel(props: { slide: Slide | null }) {
  const sources = deduplicateSourceLedger(props.slide?.aiNotes?.sourceLedger ?? []);
  const visualAsset = props.slide?.aiNotes?.visualPlan?.asset;

  return (
    <section className="suggestion-card source-ledger-card" data-testid="source-ledger-panel">
      <strong>현재 슬라이드 출처</strong>
      <div className="source-ledger-list">
        {sources.length > 0 ? (
          sources.map((source) => (
            <div className="source-ledger-item" key={sourceKey(source)}>
              <div className="source-ledger-heading">
                <span className={`source-authority source-authority-${source.authority ?? "unknown"}`}>
                  {sourceAuthorityLabel(source.authority)}
                </span>
                <strong>{source.title ?? source.source}</strong>
              </div>
              <small>{source.claim}</small>
              {source.url ? (
                <a href={source.url} rel="noreferrer" target="_blank">
                  <ExternalLink aria-hidden="true" size={13} />
                  원문 열기
                </a>
              ) : null}
            </div>
          ))
        ) : (
          <div className="source-ledger-empty">이 슬라이드에 기록된 출처가 없습니다.</div>
        )}
        {visualAsset ? (
          <div className="source-ledger-item" data-testid="visual-asset-provenance">
            <div className="source-ledger-heading">
              <span
                className={`source-authority source-authority-${visualAsset.sourceAuthority ?? "unknown"}`}
              >
                {visualAssetProviderLabel(visualAsset.provider)}
              </span>
              <strong>현재 이미지 asset</strong>
            </div>
            <small>
              {[
                visualAssetUsageLabel(visualAsset.usageBasis),
                visualAsset.author,
                visualAsset.license
              ]
                .filter(Boolean)
                .join(" · ")}
            </small>
            {visualAsset.sourceUrl ? (
              <a href={visualAsset.sourceUrl} rel="noreferrer" target="_blank">
                <ExternalLink aria-hidden="true" size={13} />
                출처 페이지
              </a>
            ) : null}
            {visualAsset.sourceAssetUrl ? (
              <a
                href={visualAsset.sourceAssetUrl}
                rel="noreferrer"
                target="_blank"
              >
                <ExternalLink aria-hidden="true" size={13} />
                원본 이미지
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

type SourceLedgerItem = NonNullable<Slide["aiNotes"]>["sourceLedger"] extends
  | Array<infer T>
  | undefined
  ? T
  : never;

function deduplicateSourceLedger(sources: SourceLedgerItem[]) {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = sourceKey(source);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sourceKey(source: SourceLedgerItem) {
  return source.sourceId ?? source.url ?? source.source;
}

function sourceAuthorityLabel(authority: SourceLedgerItem["authority"]) {
  if (authority === "official") return "공식";
  if (authority === "independent") return "독립";
  return "출처";
}

type VisualAsset = NonNullable<
  NonNullable<NonNullable<Slide["aiNotes"]>["visualPlan"]>["asset"]
>;

function visualAssetProviderLabel(provider: VisualAsset["provider"]) {
  if (provider === "official-web") return "공식 이미지";
  if (provider === "openverse") return "공개 이미지";
  if (provider === "openai") return "AI 생성";
  return provider;
}

function visualAssetUsageLabel(usageBasis: VisualAsset["usageBasis"]) {
  if (usageBasis === "official-reference") return "공식 참조";
  if (usageBasis === "licensed") return "라이선스 확인";
  if (usageBasis === "generated") return "AI 생성";
  if (usageBasis === "user-provided") return "사용자 제공";
  return "사용 근거 미기록";
}
