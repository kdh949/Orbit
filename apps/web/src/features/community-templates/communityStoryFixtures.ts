import { createDemoDeck, sanitizeCommunityTemplate } from "@orbit/editor-core";
import type { CommunityTemplateDiscoverCard } from "@orbit/shared/community-templates";

const snapshot = sanitizeCommunityTemplate(createDemoDeck());

export const communityStoryCards: CommunityTemplateDiscoverCard[] = [
  {
    author: {
      avatarUrl: null,
      displayName: "오빗 메이커",
      userId: "user_story_author_1",
    },
    category: "business",
    categoryName: "비즈니스",
    createdAt: "2026-08-24T09:00:00.000Z",
    description:
      "의사결정자가 핵심 전략과 다음 행동을 빠르게 파악하는 발표입니다.",
    likedByMe: false,
    preview: {
      canvas: snapshot.canvas,
      slide: snapshot.slides[0],
      theme: snapshot.theme,
    },
    stats: {
      commentCount: 14,
      likeCount: 1280,
      shareCount: 31,
      useCount: 246,
      viewCount: 8430,
    },
    tags: [
      { name: "전략", tagId: "community_tag_strategy" },
      { name: "보고", tagId: "community_tag_report" },
    ],
    templateId: "community_template_story_strategy",
    title: "분기 전략을 한 장으로 설명하는 법",
  },
  {
    author: {
      avatarUrl: null,
      displayName: "데이터 스피커",
      userId: "user_story_author_2",
    },
    category: "data-research",
    categoryName: "데이터·리서치",
    createdAt: "2026-08-22T09:00:00.000Z",
    description:
      "복잡한 지표를 이야기 흐름으로 연결한 데이터 발표 템플릿입니다.",
    likedByMe: true,
    preview: {
      canvas: snapshot.canvas,
      slide: snapshot.slides[1] ?? snapshot.slides[0],
      theme: snapshot.theme,
    },
    stats: {
      commentCount: 9,
      likeCount: 842,
      shareCount: 18,
      useCount: 173,
      viewCount: 5210,
    },
    tags: [{ name: "데이터", tagId: "community_tag_data" }],
    templateId: "community_template_story_data",
    title: "데이터를 설득력 있게 보여주는 흐름",
  },
];
