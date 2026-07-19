import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EditorFileMenu, type EditorFileMenuVariant } from "./EditorFileMenu";

describe("EditorFileMenu", () => {
  it("기본적으로 홈 계정 메뉴와 같은 흰색 변형을 사용한다", () => {
    const html = renderToStaticMarkup(
      <EditorFileMenu
        groups={[]}
        subtitle="프레젠테이션 · 1920 × 1080px"
        title="테스트 발표"
      />,
    );

    expect(html).toContain("redesign-dropdown-menu-white");
    expect(html).toContain("editor-file-menu--white");
    expect(html).not.toContain("테스트 발표");
  });

  it.each<EditorFileMenuVariant>(["dark", "soft-gray", "white"])(
    "%s 변형을 동일한 메뉴 구조로 렌더링한다",
    (variant) => {
      const html = renderToStaticMarkup(
        <EditorFileMenu
          groups={[
            {
              items: [
                {
                  id: "save",
                  label: "저장",
                  meta: "저장됨",
                  onSelect: vi.fn(),
                },
              ],
            },
          ]}
          subtitle="프레젠테이션 · 1920 × 1080px"
          title="테스트 발표"
          variant={variant}
        />,
      );

      expect(html).toContain(`editor-file-menu--${variant}`);
      expect(html).toContain(`data-variant="${variant}"`);
      expect(html).toContain("redesign-dropdown-menu");
      expect(html).toContain('role="menuitem"');
      expect(html).toContain("저장됨");
    },
  );
});
