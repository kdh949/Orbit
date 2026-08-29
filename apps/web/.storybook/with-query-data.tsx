import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import type { Decorator } from "@storybook/react-vite";
import { useState, type ReactNode } from "react";

type QueryFixture = readonly [queryKey: QueryKey, data: unknown];

function QueryDataBoundary(props: {
  children: ReactNode;
  fixtures: readonly QueryFixture[];
}) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    for (const [queryKey, data] of props.fixtures) {
      client.setQueryData(queryKey, data);
    }
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      {props.children}
    </QueryClientProvider>
  );
}

export function withQueryData(fixtures: readonly QueryFixture[]): Decorator {
  return (Story) => (
    <QueryDataBoundary fixtures={fixtures}>
      <Story />
    </QueryDataBoundary>
  );
}
