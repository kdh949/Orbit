import type { ChartStyle } from "@orbit/shared";
import { describe, expect, it } from "vitest";

import {
  clampDataEditorFontSize,
  mergeChartStyle
} from "./InlineDataEditorOverlay";

const chartStyle: ChartStyle = {
  colors: ["#4F81BD"],
  showLegend: true,
  legendPosition: "bottom",
  showDataLabels: false,
  showGrid: true,
  xAxisTitle: "",
  yAxisTitle: "",
  unit: ""
};

describe("inline data editor helpers", () => {
  it("merges chart typography without losing existing style", () => {
    expect(mergeChartStyle(chartStyle, { axisLabelFontSize: 30 })).toMatchObject({
      axisLabelFontSize: 30,
      colors: ["#4F81BD"],
      showLegend: true
    });
  });

  it("clamps editable font sizes", () => {
    expect(clampDataEditorFontSize("2")).toBe(6);
    expect(clampDataEditorFontSize("240")).toBe(200);
    expect(clampDataEditorFontSize("24")).toBe(24);
  });
});
