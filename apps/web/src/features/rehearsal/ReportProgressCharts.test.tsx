import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DurationLineChart } from "./ReportProgressCharts";

describe("DurationLineChart", () => {
  it("목표시간 라벨을 최신 회차 값과 떨어진 차트 시작점에 표시한다", () => {
    const html = renderToStaticMarkup(
      <DurationLineChart
        series={[
          { label: "1회차", seconds: 420 },
          { label: "2회차", seconds: 502 },
        ]}
        targetValue={480}
      />,
    );

    expect(html).toContain('class="report-project-chart-svg is-duration"');
    expect(html).toContain('x="56"');
    expect(html).toContain('text-anchor="start"');
    expect(html).toContain("목표 8:00");
    expect(html).toContain("2회차");
  });

  it("커진 회차 라벨이 겹치지 않도록 최신 회차에 가까운 중간 눈금을 생략한다", () => {
    const html = renderToStaticMarkup(
      <DurationLineChart
        series={Array.from({ length: 23 }, (_, index) => ({
          label: `${index + 1}회차`,
          seconds: 420 + index,
        }))}
        targetValue={480}
      />,
    );

    expect(html).not.toContain(">21회차<");
    expect(html).toContain(">23회차<");
  });
});
