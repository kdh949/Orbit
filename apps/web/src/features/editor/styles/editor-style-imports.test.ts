import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const editorShellSource = fs.readFileSync(
  path.join(process.cwd(), "src/features/editor/shell/EditorShell.tsx"),
  "utf8",
);

describe("editor style imports", () => {
  it("keeps extracted overrides in their original cascade order", () => {
    const orderedImports = [
      'import "../editor-shell.css";',
      'import "../styles/editor-slide-rehearsal.css";',
      'import "../styles/selection-inspector.css";',
      'import "../styles/editor-panel-visibility.css";',
      'import "../styles/editor-ai-chat-scroll.css";',
    ];

    const offsets = orderedImports.map((statement) =>
      editorShellSource.indexOf(statement),
    );

    expect(offsets.every((offset) => offset >= 0)).toBe(true);
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right));
  });
});
