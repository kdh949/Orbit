import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, fn } from "storybook/test";

import { OrbitAuthPage } from "./AuthPage";

const meta = {
  component: OrbitAuthPage,
  parameters: { layout: "fullscreen" },
  title: "Screens/Auth/Authentication",
  args: {
    isAuthenticated: false,
    mode: "login",
    onNavigate: fn(),
  },
} satisfies Meta<typeof OrbitAuthPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Login: Story = {};

export const Registration: Story = { args: { mode: "register" } };

export const AlreadyAuthenticated: Story = { args: { isAuthenticated: true } };

export const ServerError: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          { message: "이메일 또는 비밀번호를 확인해 주세요." },
          { status: 401 },
        ),
      ),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByLabelText("이메일"),
      "presenter@orbit.test",
    );
    await userEvent.type(
      canvas.getByLabelText("비밀번호"),
      "incorrect-password",
    );
    await userEvent.click(canvas.getByRole("button", { name: "로그인" }));

    await expect(await canvas.findByRole("alert")).toHaveTextContent(
      "이메일 또는 비밀번호를 확인해 주세요.",
    );
  },
};

export const Submitting: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.post("/api/v1/auth/login", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByLabelText("이메일"),
      "presenter@orbit.test",
    );
    await userEvent.type(canvas.getByLabelText("비밀번호"), "correct-password");
    await userEvent.click(canvas.getByRole("button", { name: "로그인" }));

    await expect(
      canvas.getByRole("button", { name: "로그인 중..." }),
    ).toBeDisabled();
  },
};
