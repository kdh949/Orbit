import type { VerifyAudienceAccessSessionResponse } from "@orbit/shared/presentation";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, mocked } from "storybook/test";

import { AudienceEntrance } from "./AudienceEntrance";
import {
  getAudienceSessionAccess,
  verifyAudienceSessionPasscode,
} from "./audienceApi";

const verifiedAccess = {
  session: {
    createdAt: "2026-08-29T06:00:00.000Z",
    expiresAt: "2026-08-29T08:00:00.000Z",
    projectId: "project_story_audience",
    sessionId: "session_story_audience",
    status: "open",
  },
  verified: true,
} satisfies VerifyAudienceAccessSessionResponse;

const meta = {
  component: AudienceEntrance,
  title: "Screens/Audience/Entrance",
  parameters: { layout: "fullscreen" },
  args: { sessionId: verifiedAccess.session.sessionId },
  beforeEach() {
    mocked(getAudienceSessionAccess).mockRejectedValue(
      new Error("비밀번호가 필요합니다."),
    );
    mocked(verifyAudienceSessionPasscode).mockResolvedValue(verifiedAccess);
  },
} satisfies Meta<typeof AudienceEntrance>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PasscodeRequired: Story = {
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("textbox", { name: "4자리 입장 비밀번호" }),
    ).toBeVisible();
    await expect(
      canvas.getByRole("button", { name: "비밀번호 확인" }),
    ).toBeDisabled();
  },
};

export const InvalidPasscode: Story = {
  beforeEach() {
    mocked(verifyAudienceSessionPasscode).mockRejectedValue(
      new Error("입장 링크 또는 비밀번호를 확인해 주세요."),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      await canvas.findByRole("textbox", { name: "4자리 입장 비밀번호" }),
      "1234",
    );
    await userEvent.click(
      canvas.getByRole("button", { name: "비밀번호 확인" }),
    );
    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "입장 링크 또는 비밀번호를 확인해 주세요.",
    );
  },
};

export const VerifiedRoomSelection: Story = {
  beforeEach() {
    mocked(getAudienceSessionAccess).mockResolvedValue(verifiedAccess);
  },
  play: async ({ canvas, userEvent }) => {
    const questionsRoom = await canvas.findByRole("button", { name: /질문방/ });
    await userEvent.click(questionsRoom);
    await expect(questionsRoom).toHaveClass("selected");
    await expect(
      canvas.getByRole("button", { name: "입장하기" }),
    ).toBeEnabled();
  },
};

export const CheckingAccess: Story = {
  beforeEach() {
    mocked(getAudienceSessionAccess).mockImplementation(
      () => new Promise(() => undefined),
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "입장 상태 확인 중",
    );
  },
};
