export const semanticCueEmbeddingRecallFixture = {
  cues: [
    {
      cueId: "scue_rsp",
      meaning: "RSP가 런타임에서 파일 쓰기를 차단합니다",
      hypotheses: ["발표자는 RSP의 파일 쓰기 차단 정책을 설명했다"],
      concepts: ["RSP", "파일 쓰기 차단"],
      vector: [1, 0, 0, 0]
    },
    {
      cueId: "scue_cac",
      meaning: "CAC가 높은 원인은 초기 영업 비용입니다",
      hypotheses: ["발표자는 고객 획득 비용의 원인을 설명했다"],
      concepts: ["CAC", "초기 영업 비용"],
      vector: [0, 1, 0, 0]
    },
    {
      cueId: "scue_rox",
      meaning: "ROX는 읽기 전용 실행 환경을 뜻합니다",
      hypotheses: ["발표자는 ROX의 읽기 전용 실행 환경을 설명했다"],
      concepts: ["ROX", "읽기 전용 실행 환경"],
      vector: [0, 0, 1, 0]
    }
  ],
  queries: [
    {
      transcript: "알에스피가 실행 중 파일을 쓰지 못하게 막습니다",
      vector: [0.96, 0.08, 0.02, 0],
      expectedCueId: "scue_rsp"
    },
    {
      transcript: "초기 세일즈 지출 때문에 고객 한 명을 데려오는 비용이 큽니다",
      vector: [0.05, 0.94, 0.08, 0],
      expectedCueId: "scue_cac"
    },
    {
      transcript: "알오엑스는 읽기만 허용하는 실행 환경입니다",
      vector: [0.03, 0.05, 0.97, 0],
      expectedCueId: "scue_rox"
    }
  ],
  unrelatedQuery: {
    transcript: "오늘 점심 메뉴와 날씨를 소개합니다",
    vector: [0, 0, 0, 1]
  }
} as const;
