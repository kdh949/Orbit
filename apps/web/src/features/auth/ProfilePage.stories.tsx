import type { Meta, StoryObj } from "@storybook/react-vite";
import { http, HttpResponse } from "msw";
import { expect, fn } from "storybook/test";

import { ProfilePage } from "./ProfilePage";

const user = {
  displayName: "발표 장인",
  email: "person@example.com",
  userId: "user_story_1",
};

const meta = {
  component: ProfilePage,
  title: "Screens/Auth/Profile",
  parameters: { layout: "fullscreen" },
  args: {
    onNavigate: fn(),
    user,
  },
} satisfies Meta<typeof ProfilePage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvas }) => {
    await expect(canvas.getByDisplayValue("발표 장인")).toBeVisible();
    await expect(canvas.getByDisplayValue("person@example.com")).toBeDisabled();
  },
};

export const Saved: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.patch("/api/v1/auth/profile", () =>
        HttpResponse.json({ user: { ...user, displayName: "오빗 발표자" } }),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("textbox", { name: /^닉네임/ });
    await userEvent.clear(input);
    await userEvent.type(input, "오빗 발표자");
    await userEvent.click(canvas.getByRole("button", { name: "저장" }));
    await expect(await canvas.findByRole("status")).toHaveTextContent(
      "닉네임을 저장했습니다.",
    );
  },
};

export const DuplicateNameError: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.patch("/api/v1/auth/profile", () =>
        HttpResponse.json(
          { message: "Nickname already in use" },
          { status: 409 },
        ),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole("textbox", { name: /^닉네임/ });
    await userEvent.clear(input);
    await userEvent.type(input, "Orbit");
    await userEvent.click(canvas.getByRole("button", { name: "저장" }));
    await expect(
      await canvas.findByText("이미 사용 중인 닉네임입니다."),
    ).toBeVisible();
  },
};
