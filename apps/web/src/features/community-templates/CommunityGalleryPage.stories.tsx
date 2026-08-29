import type { Meta, StoryObj } from "@storybook/react-vite";
import { delay, http, HttpResponse } from "msw";
import { expect, fn } from "storybook/test";

import { withQueryData } from "../../../.storybook/with-query-data";
import { CommunityGalleryPage } from "./CommunityGalleryPage";
import { communityStoryCards } from "./communityStoryFixtures";

const communitySuccessHandlers = [
  http.get("/api/v1/community-templates/discover", () =>
    HttpResponse.json({ hasMore: false, items: communityStoryCards, page: 1 }),
  ),
  http.get("/api/v1/community-templates/categories", () =>
    HttpResponse.json({
      items: [
        { categoryId: "business", name: "비즈니스" },
        { categoryId: "data-research", name: "데이터·리서치" },
      ],
    }),
  ),
  http.get("/api/v1/community-templates/tags", () =>
    HttpResponse.json({
      items: [
        { name: "전략", tagId: "community_tag_strategy", usageCount: 28 },
        { name: "데이터", tagId: "community_tag_data", usageCount: 19 },
      ],
    }),
  ),
];

const meta = {
  component: CommunityGalleryPage,
  title: "Screens/Community/Gallery",
  parameters: {
    layout: "fullscreen",
    msw: communitySuccessHandlers,
  },
  args: { onNavigate: fn() },
} satisfies Meta<typeof CommunityGalleryPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Curated: Story = {
  decorators: [
    withQueryData([
      [
        ["community", "discover", "", "", [], "popular"],
        {
          pageParams: [1],
          pages: [{ hasMore: false, items: communityStoryCards, page: 1 }],
        },
      ],
    ]),
  ],
  parameters: { msw: communitySuccessHandlers },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByRole("heading", { name: /ORBIT 커뮤니티/ }),
    ).toBeVisible();
    await expect(canvas.getByText(communityStoryCards[0].title)).toBeVisible();
  },
};

export const SearchEmpty: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/v1/community-templates/discover", ({ request }) => {
        const query = new URL(request.url).searchParams.get("query");
        return HttpResponse.json({
          hasMore: false,
          items: query ? [] : communityStoryCards,
          page: 1,
        });
      }),
    );
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(
      canvas.getByRole("textbox", { name: "공유된 발표자료 검색" }),
      "검색 결과 없음",
    );
    await expect(
      await canvas.findByText("조건에 맞는 자료가 없습니다."),
    ).toBeVisible();
  },
};

export const Loading: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/v1/community-templates/discover", async () => {
        await delay("infinite");
        return HttpResponse.json({});
      }),
    );
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole("status")).toHaveTextContent(
      "자료를 큐레이션하고 있습니다.",
    );
  },
};

export const Error: Story = {
  beforeEach({ msw }) {
    msw.use(
      http.get("/api/v1/community-templates/discover", () =>
        HttpResponse.json({}, { status: 503 }),
      ),
    );
  },
  play: async ({ canvas }) => {
    await expect(
      await canvas.findByText("커뮤니티 자료를 불러오지 못했습니다."),
    ).toBeVisible();
  },
};
