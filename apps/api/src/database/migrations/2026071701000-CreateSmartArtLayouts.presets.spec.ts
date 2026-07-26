import type { DeckCanvas } from "@orbit/shared/deck";
import type { QueryRunner } from "typeorm";
import { describe, expect, it } from "vitest";
import { buildSmartArtOperations } from "../../design-agent/design-agent.service";
import type { SmartArtLayoutEntity } from "../../smart-art-layouts/smart-art-layout.entity";
import { CreateSmartArtLayouts2026071701000 } from "./2026071701000-CreateSmartArtLayouts";

function recorder() {
  const queries: Array<{ sql: string; parameters?: unknown[] }> = [];
  const queryRunner = {
    query: async (sql: string, parameters?: unknown[]) => {
      queries.push({ sql, parameters });
    },
  } as unknown as QueryRunner;
  return { queries, queryRunner };
}

const canvas: DeckCanvas = {
  preset: "wide-16-9",
  aspectRatio: "16:9",
  width: 1920,
  height: 1080,
};

describe("seeded smart art presets produce valid deck patch operations", () => {
  it("expands every seeded preset into schema-valid add_element operations", async () => {
    const { queries, queryRunner } = recorder();
    await new CreateSmartArtLayouts2026071701000().up(queryRunner);

    const inserts = queries.filter((query) => query.sql.includes("INSERT INTO smart_art_layouts"));
    expect(inserts).toHaveLength(7);

    for (const insert of inserts) {
      const [layoutId, layoutType, , itemCountMin, itemCountMax, elementsJson] =
        insert.parameters as [string, string, string, number, number, string, string | null];
      const layout = {
        layoutId,
        elements: JSON.parse(elementsJson),
      } as unknown as SmartArtLayoutEntity;

      const itemCount = itemCountMax;
      const items = Array.from({ length: itemCount }, (_, i) => ({
        title: `항목 ${i + 1}`,
        description: `설명 ${i + 1}`,
      }));

      const operations = buildSmartArtOperations(layout, items, "slide_test_1", canvas);
      expect(operations.length).toBeGreaterThan(0);
      expect(operations.every((op) => op.type === "add_element")).toBe(true);

      // Sanity: no two generated elements overlap the exact same id, and every
      // element stays inside the 1920x1080 canvas.
      const ids = new Set<string>();
      for (const op of operations) {
        if (op.type !== "add_element") continue;
        expect(ids.has(op.element.elementId)).toBe(false);
        ids.add(op.element.elementId);
        expect(op.element.x + op.element.width).toBeLessThanOrEqual(canvas.width + 0.001);
        expect(op.element.y + op.element.height).toBeLessThanOrEqual(canvas.height + 0.001);
      }

      expect(itemCountMin).toBeLessThanOrEqual(itemCountMax);
      expect(["list", "process", "card_grid"]).toContain(layoutType);
    }
  });
});
