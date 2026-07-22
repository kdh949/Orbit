import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildAiPptGenerateDeckPayload,
  buildAiPptDesignSelection,
  defaultPaletteOptions,
  fetchDeckColorCustomization,
  getAiPptWizardValidationMessage,
  mergeAiPptContentFormData,
  mergeReferenceFiles,
  miniSlideFontStyles,
  pollJob,
} from "./AiPptMockupPage";
import { recommendGenerateDeckFonts } from "@orbit/shared";

const form = {
  topic: "하반기 제품 전략",
  content: "고객 문제와 핵심 로드맵을 설명한다.",
  audience: "제품·개발 리드",
  tone: "professional" as const,
  allowWebResearch: false,
  allowAiImages: false,
};

describe("AI PPT simplified input", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates only topic, content, and audience", () => {
    expect(getAiPptWizardValidationMessage({ ...form, topic: "" })).toBe(
      "발표 주제를 입력하세요.",
    );
    expect(getAiPptWizardValidationMessage({ ...form, content: "" })).toBe(
      "발표 내용을 입력하세요.",
    );
    expect(getAiPptWizardValidationMessage({ ...form, audience: "" })).toBe(
      "청중을 입력하세요.",
    );
    expect(getAiPptWizardValidationMessage(form)).toBe("");
  });

  it("restores the three content fields from form data", () => {
    const data = new FormData();
    data.set("topic", "새 주제");
    data.set("content", "새 내용");
    data.set("audience", "새 청중");

    expect(mergeAiPptContentFormData(form, data)).toMatchObject({
      topic: "새 주제",
      content: "새 내용",
      audience: "새 청중",
      tone: "professional",
    });
  });

  it("uses the fixed generation defaults without references", () => {
    const payload = buildAiPptGenerateDeckPayload(
      form,
      defaultPaletteOptions[0],
    );

    expect(payload.prompt).toBe(form.content);
    expect(payload.brief).toMatchObject({
      audienceText: form.audience,
      durationMinutes: 10,
      referencePolicy: "user-input-only",
    });
    expect(payload.targetDurationMinutes).toBe(10);
    expect(payload.slideCountRange).toEqual({ min: 5, max: 8 });
    expect(payload.design.mediaPolicy).toBe("minimal");
    expect(payload.referenceFileIds).toEqual([]);
    expect(payload.coachingContext).toEqual({
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
    });
    expect(payload.design.fontOverride?.fontId).toBe("pretendard");
    expect(payload.design).not.toHaveProperty("stylePackId");
    expect(payload.designPrompt).not.toContain("base=");
  });

  it("keeps auto pack mode optional and includes a manual override", () => {
    const font = recommendGenerateDeckFonts("professional")[0];
    const automatic = buildAiPptDesignSelection(
      defaultPaletteOptions[0],
      font,
      "",
      null,
    );
    const manual = buildAiPptDesignSelection(
      defaultPaletteOptions[0],
      font,
      "",
      { id: "executive-review", version: 1 },
    );

    expect(automatic).not.toHaveProperty("systemDesignPackSelection");
    expect(manual.systemDesignPackSelection).toEqual({
      id: "executive-review",
      version: 1,
    });
  });

  it("structures explicit duration and slide count from presentation content", () => {
    const payload = buildAiPptGenerateDeckPayload(
      {
        ...form,
        content: "임원 보고용 15분짜리 발표이며 9~11장으로 구성해 주세요.",
      },
      defaultPaletteOptions[0],
    );

    expect(payload.targetDurationMinutes).toBe(15);
    expect(payload.brief.durationMinutes).toBe(15);
    expect(payload.slideCountRange).toEqual({ min: 9, max: 11 });
  });

  it.each([
    [false, false, "user-input-only"],
    [false, true, "references-only"],
    [true, false, "research-first"],
    [true, true, "references-first"],
  ] as const)(
    "maps web research %s and attachments %s to %s",
    (allowWebResearch, hasAttachments, expectedPolicy) => {
      const payload = buildAiPptGenerateDeckPayload(
        { ...form, allowWebResearch },
        defaultPaletteOptions[0],
        hasAttachments
          ? [{ fileId: "file_document", mimeType: "application/pdf" }]
          : [],
      );

      expect(payload.referencePolicy).toBe(expectedPolicy);
      expect(payload.brief.referencePolicy).toBe(expectedPolicy);
      expect(payload.design.referencePolicy).toBe(expectedPolicy);
    },
  );

  it.each([
    [false, [], "minimal"],
    [
      true,
      [{ fileId: "file_document", mimeType: "application/pdf" }],
      "ai-generated",
    ],
    [
      true,
      [
        { fileId: "file_document", mimeType: "application/pdf" },
        { fileId: "file_jpeg", mimeType: "image/jpeg" },
        { fileId: "file_png", mimeType: "image/png" },
        { fileId: "file_webp", mimeType: "image/webp" },
        { fileId: "file_gif", mimeType: "image/gif" },
      ],
      "hybrid",
    ],
  ] as const)(
    "maps AI image use %s and uploaded files to %s",
    (allowAiImages, uploadedFiles, expectedPolicy) => {
      const payload = buildAiPptGenerateDeckPayload(
        { ...form, allowAiImages },
        defaultPaletteOptions[0],
        [...uploadedFiles],
      );

      expect(payload.design.mediaPolicy).toBe(expectedPolicy);
      expect(payload.visualPlanPolicy?.mediaPolicy).toBe(expectedPolicy);
      expect(payload.designPrompt).toContain(`mediaPolicy=${expectedPolicy}`);
      expect(payload.officialAssetFileIds).toEqual(
        expectedPolicy === "hybrid"
          ? ["file_jpeg", "file_png", "file_webp"]
          : undefined,
      );
    },
  );

  it("keeps every uploaded file as a reference for a hybrid request", () => {
    const payload = buildAiPptGenerateDeckPayload(
      {
        ...form,
        allowWebResearch: true,
        allowAiImages: true,
      },
      defaultPaletteOptions[0],
      [
        { fileId: "file_document", mimeType: "application/pdf" },
        { fileId: "file_image", mimeType: "image/png" },
      ],
    );

    expect(payload.referencePolicy).toBe("references-first");
    expect(payload.brief.referencePolicy).toBe("references-first");
    expect(payload.design.referencePolicy).toBe("references-first");
    expect(payload.design.mediaPolicy).toBe("hybrid");
    expect(payload.visualPlanPolicy?.mediaPolicy).toBe("hybrid");
    expect(payload.designPrompt).toContain("mediaPolicy=hybrid");
    expect(payload.officialAssetFileIds).toEqual(["file_image"]);
    expect(payload.referenceFileIds).toEqual(["file_document", "file_image"]);
    expect(payload.references).toEqual([
      { fileId: "file_document" },
      { fileId: "file_image" },
    ]);
    expect(payload.referenceContext).toEqual([]);
  });

  it("provides the nine approved palettes", () => {
    expect(defaultPaletteOptions.map((option) => option.optionId)).toEqual([
      "brandlogy-blue",
      "executive-slate",
      "modern-violet",
      "resort-blue",
      "calm-green",
      "energetic-coral",
      "warm-amber",
      "editorial-rose",
      "graphite-night",
    ]);
    expect(defaultPaletteOptions[6]?.palette).toMatchObject({
      primary: "#D97706",
      accentColor: "#2563EB",
    });
    expect(defaultPaletteOptions[8]?.palette.background).toBe("#0F172A");
  });

  it("builds the existing font preview stack safely", () => {
    expect(
      miniSlideFontStyles({
        headingFontFamily: 'Heading "Unsafe"',
        bodyFontFamily: "Body Font",
        fallbackFamily: "Arial",
      }),
    ).toEqual({
      heading: { fontFamily: '"Heading Unsafe", Arial, sans-serif' },
      body: { fontFamily: '"Body Font", Arial, sans-serif' },
    });
  });

  it("keeps one copy of duplicate attachments", () => {
    const first = new File(["a"], "brief.pdf", { lastModified: 1 });
    const duplicate = new File(["b"], "brief.pdf", { lastModified: 1 });
    Object.defineProperty(duplicate, "size", { value: first.size });

    expect(mergeReferenceFiles([first], [duplicate])).toHaveLength(1);
  });

  it("posts one strict palette customization request", async () => {
    const option = {
      optionId: "ai-custom",
      name: "따뜻한 포인트",
      palette: defaultPaletteOptions[0].palette,
      rationale: "포인트 색상을 따뜻하게 조정했습니다.",
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ option }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(
      fetchDeckColorCustomization({
        topic: form.topic,
        instruction: "포인트만 따뜻하게",
        basePalette: defaultPaletteOptions[0].palette,
        stylePackId: "brandlogy-modern",
        tone: form.tone,
      }),
    ).resolves.toEqual({ option });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/ai/deck-color-customization",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("polls through the existing job route", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            jobId: "job_1",
            projectId: "project_1",
            type: "ai-deck-generation",
            status: "succeeded",
            progress: 100,
            message: "done",
            result: null,
            error: null,
            createdAt: "2026-07-17T00:00:00.000Z",
            updatedAt: "2026-07-17T00:00:01.000Z",
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetcher);

    await expect(pollJob("job_1")).resolves.toMatchObject({
      status: "succeeded",
    });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/jobs/job_1",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("does not run standalone extraction or save a Presentation Brief", () => {
    const source = fs.readFileSync(
      new URL("./AiPptMockupPage.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("/references/extractions");
    expect(source).not.toContain("putPresentationBrief");
    expect(source).not.toContain("Saved Design Pack");
    expect(source).not.toContain("referencePolicyOptions");
    expect(source).not.toContain("mediaPolicyOptions");
    expect(source).not.toContain("function PolicySelect");
    expect(source).not.toContain("/generation/${encodeURIComponent(jobId)}/story");
    expect(source).toContain("styleColorPath(project.projectId, data.job.jobId)");
  });
});
