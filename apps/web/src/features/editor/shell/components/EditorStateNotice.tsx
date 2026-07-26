import type { DeckCanvas } from "@orbit/shared/deck";

export function EditorStateNotice(props: {
  isError: boolean;
  isLoading: boolean;
  isUsingFallback: boolean;
}) {
  if (props.isLoading) {
    return (
      <section className="editor-state-notice loading">
        <strong>덱을 불러오는 중</strong>
        <span>프로젝트 덱 응답을 기다리는 동안 데모 덱 미리보기를 유지합니다.</span>
      </section>
    );
  }

  if (props.isError) {
    return (
      <section className="editor-state-notice error">
        <strong>덱을 불러올 수 없음</strong>
        <span>403/404 또는 네트워크 오류일 수 있습니다. 현재 화면은 demo fallback 데이터입니다.</span>
      </section>
    );
  }

  if (props.isUsingFallback) {
    return (
      <section className="editor-state-notice fallback">
        <strong>Demo fallback</strong>
        <span>API 덱이 아직 없어서 로컬 데모 DeckSchema 데이터를 표시합니다.</span>
      </section>
    );
  }

  return null;
}

export function EmptyPanel(props: { title: string; description: string }) {
  return (
    <section className="empty-panel">
      <strong>{props.title}</strong>
      <p>{props.description}</p>
    </section>
  );
}

export function EmptyCanvasState(props: { canvas: DeckCanvas }) {
  return (
    <section className="empty-canvas-state">
      <strong>빈 덱</strong>
      <p>
        현재 덱에는 슬라이드가 없습니다. 캔버스 프리셋은 {props.canvas.preset} /{" "}
        {props.canvas.width} × {props.canvas.height}px로 유지됩니다.
      </p>
    </section>
  );
}
