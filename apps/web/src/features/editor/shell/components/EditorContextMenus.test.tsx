import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EditorContextMenus } from "./EditorContextMenus";

vi.mock("react-dom", () => ({
  createPortal: (content: ReactNode) => content
}));

describe("EditorContextMenus table actions", () => {
  beforeEach(() => {
    vi.stubGlobal("document", { body: {} });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows selected-cell row and column actions with disabled reasons", () => {
    const html = renderToStaticMarkup(
      <EditorContextMenus
        chartMenuPosition={null}
        elementContextMenu={{
          actionDisabledReasons: {
            deleteColumn: "마지막 열은 삭제할 수 없습니다."
          },
          columnIndex: 0,
          elementId: "el_table",
          left: 10,
          rowIndex: 1,
          selection: {
            endColumnIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            startRowIndex: 1,
          },
          slideId: "slide_1",
          top: 20,
          type: "table-cell"
        }}
        isChartMenuOpen={false}
        isImageUploadPending={false}
        isShapeMenuOpen={false}
        onCloseChartMenu={vi.fn()}
        onCloseElementContextMenu={vi.fn()}
        onCloseShapeMenu={vi.fn()}
        onCreateGroup={vi.fn()}
        onInsertChart={vi.fn()}
        onInsertShape={vi.fn()}
        onReplaceImage={vi.fn()}
        onUngroup={vi.fn()}
        shapeMenuPosition={null}
      />
    );

    expect(html).toContain("위에 행 추가");
    expect(html).toContain("아래에 행 추가");
    expect(html).toContain("왼쪽에 열 추가");
    expect(html).toContain("오른쪽에 열 추가");
    expect(html).toContain("현재 행 삭제");
    expect(html).toContain("현재 열 삭제");
    expect(html).toContain("셀 병합");
    expect(html).toContain("셀 병합 해제");
    expect(html).toContain("마지막 열은 삭제할 수 없습니다.");
  });
});
