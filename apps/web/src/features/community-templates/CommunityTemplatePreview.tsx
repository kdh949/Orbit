import { type CommunityTemplateCard } from "@orbit/shared/community-templates";
import { deckSchema } from "@orbit/shared/deck";
import {
  Component,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

const ReadOnlySlideCanvas = lazy(async () => {
  const module = await import("../slides/rendering/ReadOnlySlideCanvas");
  return { default: module.ReadOnlySlideCanvas };
});

export function buildCommunityTemplatePreviewDeck(card: CommunityTemplateCard) {
  const suffix = card.templateId.replace(/^community_template_/, "");
  return deckSchema.parse({
    deckId: `deck_preview_${suffix}`,
    projectId: `project_preview_${suffix}`,
    title: card.title,
    version: 1,
    targetDurationMinutes: 1,
    canvas: card.preview.canvas,
    theme: card.preview.theme,
    slides: [card.preview.slide],
  });
}

export function CommunityTemplatePreview(props: {
  card: CommunityTemplateCard;
  className?: string;
}) {
  const deck = buildCommunityTemplatePreviewDeck(props.card);
  const shell = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);

  useEffect(() => {
    const target = shell.current;
    if (!target) return;
    const update = () => {
      if (target.clientWidth <= 0 || target.clientHeight <= 0) return;
      setScale(
        Math.min(
          target.clientWidth / deck.canvas.width,
          target.clientHeight / deck.canvas.height,
        ),
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, [deck.canvas.height, deck.canvas.width]);

  return (
    <PreviewErrorBoundary fallback={<CommunityTemplatePreviewFallback />}>
      <div
        aria-hidden="true"
        className={props.className ?? "community-template-preview"}
        ref={shell}
        style={{ aspectRatio: `${deck.canvas.width} / ${deck.canvas.height}` }}
      >
        <Suspense fallback={<CommunityTemplatePreviewFallback />}>
          {scale > 0 ? (
            <ReadOnlySlideCanvas
              deck={deck}
              scale={scale}
              slide={deck.slides[0]!}
            />
          ) : (
            <CommunityTemplatePreviewFallback />
          )}
        </Suspense>
      </div>
    </PreviewErrorBoundary>
  );
}

export function CommunityTemplatePreviewFallback() {
  return <span className="community-template-preview-fallback" />;
}

class PreviewErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Preview failures are intentionally isolated from card title and actions.
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
