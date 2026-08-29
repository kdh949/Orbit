import { createDemoDeck } from "@orbit/editor-core/fixtures";
import { demoIds } from "@orbit/shared/common";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http, HttpResponse } from "msw";
import { expect } from "storybook/test";

import { ProjectAccessProvider } from "../../projects/ProjectAccessContext";
import { EditorShell } from "./EditorShell";

const editorDeck = createDemoDeck();

const meta = {
  component: EditorShell,
  parameters: { layout: "fullscreen" },
  title: "Screens/Editor/Workspace",
  args: {
    projectId: editorDeck.projectId,
  },
  decorators: [
    (Story) => (
      <ProjectAccessProvider membership={{ role: "owner", status: "accepted" }}>
        <Story />
      </ProjectAccessProvider>
    ),
  ],
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/health", () =>
        HttpResponse.json({ app: "orbit-api", demo: demoIds, status: "ok" }),
      ),
      http.get("/api/v1/projects/:projectId/deck", () =>
        HttpResponse.json({ deck: editorDeck }),
      ),
    );
  },
} satisfies Meta<typeof EditorShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(editorDeck.title)).toBeVisible();
    await expect(canvas.getByLabelText("에디터 동기화")).toBeEnabled();
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/health", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
      http.get("/api/v1/projects/:projectId/deck", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
  },
  play: async ({ canvasElement }) => {
    await expect(
      canvasElement.querySelector("main[aria-busy='true']"),
    ).toBeInTheDocument();
  },
};

export const ErrorFallback: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/health", () => HttpResponse.json({}, { status: 503 })),
      http.get("/api/v1/projects/:projectId/deck", () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findAllByText("오프라인 데모")).not.toHaveLength(
      0,
    );
  },
};
