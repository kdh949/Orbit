import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect } from "storybook/test";

import {
  demoDeck,
  reportMockupReport,
  reportMockupRun,
  reportMockupRunId,
} from "../../../app/fixtures/reportMockup";
import { RehearsalReportPage } from "./RehearsalReportPage";

const meta = {
  component: RehearsalReportPage,
  title: "Screens/Reports/Rehearsal Detail",
  parameters: { layout: "fullscreen" },
  args: {
    initialDeck: demoDeck,
    initialReport: reportMockupReport,
    initialRun: reportMockupRun,
    projectId: reportMockupRun.projectId,
    runId: reportMockupRunId,
  },
} satisfies Meta<typeof RehearsalReportPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CompletedAnalysis: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("1회차 리허설 리포트"),
    ).toBeInTheDocument();
    await expect(canvas.getByText("말버릇 총량")).toBeInTheDocument();
    await expect(canvas.getByText("긴 침묵 구간 분석")).toBeInTheDocument();
    await expect(canvas.getByText("개선 피드백")).toBeInTheDocument();
  },
};
