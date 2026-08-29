import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Preview } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";
import { mswLoader } from "msw-storybook-addon/csf3";
import { sb } from "storybook/test";

import { AppProviders } from "../src/app/AppProviders";
import "../src/fonts.css";
import "../src/styles/tokens.css";
import "../src/styles/foundations.css";
import "../src/styles.css";
import { mswHandlers } from "./msw-handlers";

sb.mock(import("../src/features/ai-ppt/ai-deck-preview-api.ts"), {
  spy: true,
});
sb.mock(import("../src/features/audience/audienceApi.ts"), { spy: true });

function PreviewProviders(props: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AppProviders>{props.children}</AppProviders>
    </QueryClientProvider>
  );
}

const preview: Preview = {
  tags: ["autodocs"],
  decorators: [
    (Story, context) => (
      <PreviewProviders key={context.id}>
        <Story />
      </PreviewProviders>
    ),
  ],
  loaders: [mswLoader()],
  parameters: {
    msw: mswHandlers,
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    a11y: {
      // 'todo' - show a11y violations in the test UI only
      // 'error' - fail CI on a11y violations
      // 'off' - skip a11y checks entirely
      test: "error",
    },
  },
};

export default preview;
