import type { DeckCanvas } from "@orbit/shared/deck";
import type { QueryRunner } from "typeorm";
import { describe, expect, it } from "vitest";
import { buildSmartArtOperations } from "../../design-agent/design-agent.service";
import type { SmartArtLayoutEntity } from "../../smart-art-layouts/smart-art-layout.entity";
import { AddSmartArtTemplateLayouts2026071702000 } from "./2026071702000-AddSmartArtTemplateLayouts";

const canvas: DeckCanvas = {
  preset: "wide-16-9",
  aspectRatio: "16:9",
  width: 1920,
  height: 1080,
};

describe("AddSmartArtTemplateLayouts2026071702000", () => {
  it("seeds four PPT-derived layouts that expand into one draggable group", async () => {
    const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
    const queryRunner = {
      query: async (sql: string, parameters?: unknown[]) => {
        queries.push({ sql, parameters });
      },
    } as unknown as QueryRunner;

    await new AddSmartArtTemplateLayouts2026071702000().up(queryRunner);
    const inserts = queries.filter((query) => query.sql.includes("INSERT INTO smart_art_layouts"));
    expect(inserts).toHaveLength(4);

    for (const insert of inserts) {
      const [layoutId, layoutType, , itemCount, elementsJson] = insert.parameters as [
        string,
        string,
        string,
        number,
        string,
        string,
      ];
      const layout = {
        layoutId,
        layoutType,
        elements: JSON.parse(elementsJson),
      } as SmartArtLayoutEntity;
      const items = Array.from({ length: itemCount }, (_, index) => ({
        title: `항목 ${index + 1}`,
        description: `설명 ${index + 1}`,
      }));
      const operations = buildSmartArtOperations(layout, items, "slide_test", canvas);
      const addedElements = operations.flatMap((operation) =>
        operation.type === "add_element" ? [operation.element] : [],
      );
      const group = addedElements.find((element) => element.type === "group");

      expect(group?.type).toBe("group");
      if (group?.type === "group") {
        expect(group.props.childElementIds).toHaveLength(addedElements.length - 1);
      }
      expect(
        addedElements.every(
          (element) =>
            element.x >= 0 &&
            element.y >= 0 &&
            element.x + element.width <= canvas.width + 0.001 &&
            element.y + element.height <= canvas.height + 0.001,
        ),
      ).toBe(true);
    }
  });
});
