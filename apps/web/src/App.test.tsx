import { renderToStaticMarkup } from "react-dom/server";
import type { Job, Project } from "@orbit/shared";
import type { ReactNode } from "react";
import { forwardRef } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  buildAiTemplateDeckGenerationPayload,
  buildDesignReferences,
  buildGenerateDeckPayload,
  buildGenerateDeckDesignDirection,
  buildDefaultHomeGenerateDeckDesignDirection,
  buildHomeJsonFirstGenerateDeckPayload,
  buildHomeTemplateStyleGenerateDeckDesignDirection,
  buildPptxOoxmlGenerationPayload,
  buildReferenceGenerationInput,
  buildSimpleBasicGenerateDeckDesignDirection,
  buildTemplateStyleDesignOverrides,
  createGeneratedDeckProject,
  ExtractResultItem,
  GeneratedDeckResult,
  deckRenderPayloadStorageKey,
  getGeneratedDeckProjectPath,
  getGeneratedDeckProjectTitle,
  getAiTemplateDeckGenerationJobResult,
  getGenerateDeckJobResult,
  buildHomeExtractFormData,
  getHomeDeckGenerationJobEndpoint,
  getHomeDefaultUploadRole,
  getHomeGenerationValidationMessage,
  getHomeContentReferenceUploads,
  getHomePptxConversionValidationMessage,
  getHomeTemplateStylePath,
  homeReferenceExtractEndpoint,
  homeTemplateStyles,
  getPptxOoxmlGeneratedProjectPath,
  getPptxOoxmlGenerationJobResult,
  getPptxConversionProjectTitle,
  getJobResultFiles,
  getRoute,
  mergeGeneratedProjectList,
  parseHomeIntegerInput,
  pollJob,
  pollExtractJob,
  resolveGenerateDeckTargetProject,
  shouldRenderAppFrame,
  TemplateRail,
  TemplateStyleOptionsPanel
} from "./App";

vi.mock("react-konva", () => {
  const Group = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>
  );
  const Stage = forwardRef<HTMLDivElement, { children?: ReactNode }>(
    ({ children }, ref) => <div ref={ref}>{children}</div>
  );
  const Text = ({ text }: { text?: string }) => <span>{text}</span>;

  return {
    Arrow: () => <span data-konva-arrow="true" />,
    Circle: () => <span data-konva-circle="true" />,
    Group,
    Image: () => <span data-konva-image="true" />,
    Layer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
    Line: () => <span data-konva-line="true" />,
    Rect: () => <span data-konva-rect="true" />,
    RegularPolygon: () => <span data-konva-polygon="true" />,
    Shape: () => <span data-konva-shape="true" />,
    Star: () => <span data-konva-star="true" />,
    Stage,
    Text
  };
});

describe("App shell routing", () => {
  it("keeps the login page outside the shared navigation shell", () => {
    expect(shouldRenderAppFrame({ name: "login" })).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "project-editor",
        projectId: "project_demo_1"
      })
    ).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "presentation",
        projectId: "project_demo_1"
      })
    ).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "rehearsal",
        projectId: "project_demo_1"
      })
    ).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "rehearsal-report",
        projectId: "project_demo_1",
        runId: "run_demo_1"
      })
    ).toBe(false);
    expect(
      shouldRenderAppFrame({
        name: "present",
        deckId: "deck_demo_1",
        sessionId: "session_demo_1"
      })
    ).toBe(false);
    expect(shouldRenderAppFrame({ name: "home" })).toBe(true);
  });

  it("parses presenter slide-window routes with an optional session id", () => {
    expect(getRoute("/present/deck_demo_1", "?sessionId=session_demo_1")).toEqual({
      name: "present",
      deckId: "deck_demo_1",
      sessionId: "session_demo_1"
    });
    expect(getRoute("/present/deck_demo_1")).toEqual({
      name: "present",
      deckId: "deck_demo_1",
      sessionId: undefined
    });
  });

  it("parses presentation workspace routes", () => {
    expect(getRoute("/presentation/project_demo_1")).toEqual({
      name: "presentation",
      projectId: "project_demo_1"
    });
  });

  it("parses rehearsal presenter-window session query parameters", () => {
    expect(
      getRoute(
        "/rehearsal/project_demo_1",
        "?presenterSessionId=session-presenter-1&presenterWindow=1&slideIndex=2&stepIndex=1"
      )
    ).toEqual({
      name: "rehearsal",
      presenterInitialSlideIndex: 2,
      presenterInitialStepIndex: 1,
      presenterSessionId: "session-presenter-1",
      presenterWindow: true,
      projectId: "project_demo_1"
    });
  });

  it("keeps the deck render fixture outside the shared navigation shell", () => {
    const route = getRoute("/__deck-render");

    expect(route).toEqual({ name: "deck-render" });
    expect(shouldRenderAppFrame(route)).toBe(false);
    expect(deckRenderPayloadStorageKey).toBe("orbit.deckRenderPayload.v1");
  });

  it("routes the dev-only Semantic Cue Lab outside the navigation shell", () => {
    const route = getRoute("/dev/semantic-cue-lab");

    expect(route).toEqual({ name: "semantic-cue-lab" });
    expect(shouldRenderAppFrame(route)).toBe(false);
  });

  it("does not expose the old upload workspace route", () => {
    expect(getRoute("/upload")).toEqual({ name: "home" });
  });

  it("parses a selected home template style from the query string", () => {
    expect(getRoute("/", "?templateStyle=presentation-document")).toEqual({
      name: "home",
      templateStyleId: "presentation-document"
    });
    expect(getHomeTemplateStylePath("submission-document")).toBe(
      "/?templateStyle=submission-document"
    );
  });
});

describe("home template styles", () => {
  it("renders only the three supported template style cards", () => {
    const html = renderToStaticMarkup(
      <TemplateRail title="템플릿" selectedStyleId="presentation-document" />
    );

    expect(homeTemplateStyles).toHaveLength(3);
    expect(html).toContain("빈 프레젠테이션 만들기");
    expect(html).toContain("심플 베이직 스타일");
    expect(html).toContain("발표용 문서 스타일");
    expect(html).toContain("제출용 문서 스타일");
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("피치덱");
    expect(html).not.toContain("수업 자료");
    expect(html).not.toContain("워크숍");
  });

  it("does not select a template style by default", () => {
    const html = renderToStaticMarkup(<TemplateRail title="템플릿" />);

    expect(html).not.toContain('aria-pressed="true"');
    expect(html).not.toContain("template-card-active");
  });

  it("renders selected template style settings", () => {
    const html = renderToStaticMarkup(
      <TemplateStyleOptionsPanel
        templateStyle={homeTemplateStyles[0]}
        topic=""
        prompt=""
        tone="professional"
        durationInput="10"
        minSlidesInput="5"
        maxSlidesInput="8"
        designPrompt=""
        densityTarget="style-default"
        layoutDiversity="style-default"
        mediaPolicy="style-default"
        uploads={[]}
        totalUploadSize={0}
        rejected={[]}
        job={null}
        status=""
        error=""
        onClearStyle={() => undefined}
        onTopicChange={() => undefined}
        onPromptChange={() => undefined}
        onToneChange={() => undefined}
        onDurationInputChange={() => undefined}
        onMinSlidesInputChange={() => undefined}
        onMaxSlidesInputChange={() => undefined}
        onDesignPromptChange={() => undefined}
        onDensityTargetChange={() => undefined}
        onFileChange={() => undefined}
        onLayoutDiversityChange={() => undefined}
        onMediaPolicyChange={() => undefined}
        onRemoveUpload={() => undefined}
        onUpdateUploadRole={() => undefined}
        onGenerate={() => undefined}
      />
    );

    expect(html).toContain("발표 주제");
    expect(html).toContain("PPT 생성하기");
    expect(html).toContain('name="templateDesignPrompt"');
    expect(html).toContain('name="templateDensityTarget"');
    expect(html).toContain('name="templateLayoutDiversity"');
    expect(html).toContain('name="templateMediaPolicy"');
    expect(html).toContain("참고자료 첨부");
    expect(html).toContain('type="file"');
  });

  it("hides design reference roles in the selected template style settings", () => {
    const pptx = new File(["pptx"], "reference.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const html = renderToStaticMarkup(
      <TemplateStyleOptionsPanel
        templateStyle={homeTemplateStyles[0]}
        topic=""
        prompt=""
        tone="professional"
        durationInput="10"
        minSlidesInput="5"
        maxSlidesInput="8"
        designPrompt=""
        densityTarget="style-default"
        layoutDiversity="style-default"
        mediaPolicy="style-default"
        uploads={[{ id: "pptx", file: pptx, role: "content" }]}
        totalUploadSize={pptx.size}
        rejected={[]}
        job={null}
        status=""
        error=""
        onClearStyle={() => undefined}
        onTopicChange={() => undefined}
        onPromptChange={() => undefined}
        onToneChange={() => undefined}
        onDurationInputChange={() => undefined}
        onMinSlidesInputChange={() => undefined}
        onMaxSlidesInputChange={() => undefined}
        onDesignPromptChange={() => undefined}
        onDensityTargetChange={() => undefined}
        onFileChange={() => undefined}
        onLayoutDiversityChange={() => undefined}
        onMediaPolicyChange={() => undefined}
        onRemoveUpload={() => undefined}
        onUpdateUploadRole={() => undefined}
        onGenerate={() => undefined}
      />
    );

    expect(html).toContain("내용 참고");
    expect(html).not.toContain("디자인 참고");
    expect(html).not.toContain("둘 다");
  });
});

describe("reference extraction upload flow", () => {
  it("builds generate-deck references and keywords from succeeded extraction results", () => {
    const input = buildReferenceGenerationInput([
      {
        referenceDocumentId: " file_1 ",
        fileName: "success.pdf",
        kind: "pdf",
        status: "succeeded",
        rawText: "raw",
        cleanedText: "cleaned",
        keywords: [
          { keyword: "Deck", reason: "topic", priority: "high" },
          { keyword: " deck ", reason: "duplicate", priority: "medium" }
        ]
      },
      {
        referenceDocumentId: "file_2",
        fileName: "failed.pdf",
        kind: "pdf",
        status: "failed",
        rawText: "",
        keywords: [{ keyword: "ignored", reason: "failed", priority: "low" }]
      },
      {
        referenceDocumentId: "file_1",
        fileName: "duplicate.pdf",
        kind: "pdf",
        status: "succeeded",
        rawText: "raw",
        keywords: [{ keyword: "AI", reason: "topic", priority: "high" }]
      }
    ]);

    expect(input.references).toEqual([{ fileId: "file_1" }]);
    expect(input.referenceKeywords).toEqual([{ text: "Deck" }, { text: "AI" }]);
    expect(input.referenceContext).toEqual([
      { fileId: "file_1", title: "success.pdf", content: "cleaned" }
    ]);
    expect(input.succeededFiles).toHaveLength(2);
    expect(input.failedFiles.map((file) => file.fileName)).toEqual(["failed.pdf"]);
  });

  it("polls a succeeded job and renders its result", async () => {
    const file = {
      fileName: "sample.pdf",
      kind: "pdf",
      status: "succeeded",
      message: "done",
      rawText: "raw text",
      cleanedText: "cleaned text",
      cleanupStatus: "succeeded",
      keywords: [{ keyword: "deck", reason: "topic", priority: "high" }],
      keywordStatus: "succeeded",
      indexingStatus: "indexed",
      indexingMessage: "stored",
      chunkCount: 2
    };
    const baseJob: Job = {
      jobId: "job-1",
      projectId: "project-a",
      type: "reference-extract",
      status: "running",
      progress: 10,
      message: "Reference extraction running.",
      result: null,
      error: null,
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z"
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(baseJob)))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ...baseJob,
            status: "succeeded",
            progress: 100,
            result: { files: [file] }
          })
        )
      );

    const job = await pollExtractJob("job-1", { delayMs: 0, fetcher });
    const [result] = getJobResultFiles(job);
    const html = renderToStaticMarkup(<ExtractResultItem result={result} />);

    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/jobs/job-1");
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/jobs/job-1");
    expect(html).toContain("sample.pdf");
    expect(html).toContain("cleaned text");
    expect(html).toContain("2 chunks");
  });
});

describe("AI deck generation flow", () => {
  it("builds a PPTX OOXML generation payload without old generate-deck fields", () => {
    expect(
      buildPptxOoxmlGenerationPayload({
        fileId: "file_template",
        topic: " ORBIT ",
        prompt: " Keep source package "
      })
    ).toEqual({
      fileId: "file_template",
      topic: "ORBIT",
      prompt: "Keep source package"
    });
    expect(
      buildPptxOoxmlGenerationPayload({
        fileId: "file_template",
        topic: " ",
        prompt: ""
      })
    ).toEqual({ fileId: "file_template" });
  });

  it("validates the home PPTX conversion shortcut", () => {
    const pptx = new File(["pptx"], "source deck.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const pdf = new File(["pdf"], "content.pdf", { type: "application/pdf" });

    expect(getHomePptxConversionValidationMessage([])).toBe(
      "변환할 PPTX 파일을 첨부하세요."
    );
    expect(
      getHomePptxConversionValidationMessage([
        { id: "pptx", file: pptx, role: "design" }
      ])
    ).toBe("");
    expect(
      getHomePptxConversionValidationMessage([
        { id: "pptx", file: pptx, role: "design" },
        { id: "pdf", file: pdf, role: "content" }
      ])
    ).toBe("PPTX 변환은 PPTX 파일 1개만 첨부할 수 있습니다.");
    expect(getPptxConversionProjectTitle(" source deck.pptx ")).toBe(
      "source deck"
    );
  });

  it("reads a PPTX OOXML generation job result", () => {
    const job: Job = {
      jobId: "job-ooxml",
      projectId: "project-a",
      type: "pptx-ooxml-generation",
      status: "succeeded",
      progress: 100,
      message: "PPTX OOXML generation completed.",
      result: {
        deckId: "deck_ooxml_file_template",
        templateId: "template_file_template",
        sourceFileId: "file_template",
        currentPackageFileId: "file_current",
        qualityReport: {
          compositeScore: 90,
          metrics: {
            geometry: 90,
            text: 90,
            color: 90,
            layer: 90,
            editability: 90,
            pixelSimilarity: null
          },
          weights: {
            geometry: 25,
            text: 15,
            color: 10,
            layer: 10,
            editability: 10,
            pixelSimilarity: 30
          },
          editabilityCoverage: 0.9,
          appliedCap: null,
          notes: []
        },
        warnings: []
      },
      error: null,
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:01.000Z"
    };

    expect(getPptxOoxmlGenerationJobResult(job)?.deckId).toBe(
      "deck_ooxml_file_template"
    );
    expect(getPptxOoxmlGeneratedProjectPath("project-a")).toBe(
      "/project/project-a"
    );
  });

  it("builds a home AI template deck payload with file roles", () => {
    const pptx = new File(["pptx"], "design.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const pdf = new File(["pdf"], "content.pdf", { type: "application/pdf" });
    const uploadedFileIds = new Map([
      ["content", "file_content"],
      ["design", "file_design"]
    ]);

    expect(
      buildAiTemplateDeckGenerationPayload({
        topic: " ORBIT ",
        prompt: " 핵심 메시지 ",
        designPrompt: " 리포트 톤 ",
        duration: 12,
        minSlides: 4,
        maxSlides: 6,
        tone: "confident",
        uploads: [
          { id: "content", file: pdf, role: "content" },
          { id: "design", file: pptx, role: "design" }
        ],
        uploadedAssetFileIds: uploadedFileIds
      })
    ).toMatchObject({
      topic: "ORBIT",
      prompt: "핵심 메시지",
      designPrompt: "리포트 톤",
      targetDurationMinutes: 12,
      slideCountRange: { min: 4, max: 6 },
      metadata: {
        audience: "general",
        purpose: "inform",
        tone: "confident"
      },
      assets: [
        { fileId: "file_content", role: "content" },
        { fileId: "file_design", role: "design" }
      ]
    });
  });

  it("keeps a home PPTX both role in the AI template deck payload", () => {
    const pptx = new File(["pptx"], "template.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });

    expect(
      buildAiTemplateDeckGenerationPayload({
        topic: "ORBIT",
        prompt: "",
        designPrompt: "",
        duration: 10,
        minSlides: 5,
        maxSlides: 8,
        tone: "professional",
        uploads: [{ id: "template", file: pptx, role: "both" }],
        uploadedAssetFileIds: new Map([["template", "file_template"]])
      }).assets
    ).toEqual([{ fileId: "file_template", role: "both" }]);
  });

  it("keeps home number inputs empty until submit validation", () => {
    expect(parseHomeIntegerInput("")).toBeNull();
    expect(parseHomeIntegerInput("25")).toBe(25);
  });

  it("rejects invalid home generation duration and slide ranges", () => {
    const pptx = new File(["pptx"], "design.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const pdf = new File(["pdf"], "content.pdf", { type: "application/pdf" });
    const uploads = [{ id: "design", file: pptx, role: "design" as const }];

    expect(getHomeGenerationValidationMessage("ORBIT", [], "10", "5", "8")).toBe("");
    expect(
      getHomeGenerationValidationMessage(
        "ORBIT",
        [{ id: "pdf", file: pdf, role: "design" }],
        "10",
        "5",
        "8"
      )
    ).toBe("디자인 참고 파일은 PPTX여야 합니다.");
    expect(
      getHomeGenerationValidationMessage(
        "ORBIT",
        [
          { id: "design-1", file: pptx, role: "design" },
          { id: "design-2", file: pptx, role: "both" }
        ],
        "10",
        "5",
        "8"
      )
    ).toBe("디자인 참고 PPTX는 1개만 선택하세요.");
    expect(
      getHomeGenerationValidationMessage(
        "ORBIT",
        [
          { id: "design-1", file: pptx, role: "design" },
          { id: "design-2", file: pptx, role: "both" }
        ],
        "10",
        "5",
        "8",
        false
      )
    ).toBe("");
    expect(getHomeGenerationValidationMessage("ORBIT", uploads, "0", "5", "8")).toBe(
      "발표 시간은 1~120분으로 입력하세요."
    );
    expect(getHomeGenerationValidationMessage("ORBIT", uploads, "10", "9", "8")).toBe(
      "최소 슬라이드 수는 최대 슬라이드 수보다 클 수 없습니다."
    );
  });

  it("defaults PPTX uploads to content references while a template style is selected", () => {
    const pptx = new File(["pptx"], "reference.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const docx = new File(["docx"], "reference.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });

    expect(getHomeDefaultUploadRole(pptx, false)).toBe("design");
    expect(getHomeDefaultUploadRole(pptx, true)).toBe("content");
    expect(getHomeDefaultUploadRole(docx, true)).toBe("content");
  });

  it("reads an AI template deck generation job result", () => {
    const job: Job = {
      jobId: "job-template",
      projectId: "project-a",
      type: "ai-template-deck-generation",
      status: "succeeded",
      progress: 100,
      message: "AI template deck generation completed.",
      result: {
        deckId: "deck_ai_project_a",
        templateId: "template_file_design",
        sourceFileId: "file_design",
        currentPackageFileId: "file_current",
        contentReferenceFileIds: ["file_content"],
        qualityReport: {
          compositeScore: 90,
          metrics: {
            geometry: 90,
            text: 90,
            color: 90,
            layer: 90,
            editability: 90,
            pixelSimilarity: null
          },
          weights: {
            geometry: 25,
            text: 15,
            color: 10,
            layer: 10,
            editability: 10,
            pixelSimilarity: 30
          },
          editabilityCoverage: 0.9,
          appliedCap: null,
          notes: []
        },
        warnings: []
      },
      error: null,
      createdAt: "2026-07-04T00:00:00.000Z",
      updatedAt: "2026-07-04T00:00:01.000Z"
    };

    expect(getAiTemplateDeckGenerationJobResult(job)).toMatchObject({
      deckId: "deck_ai_project_a",
      currentPackageFileId: "file_current",
      contentReferenceFileIds: ["file_content"]
    });
  });

  it("builds a generate-deck payload with design direction", () => {
    const payload = buildGenerateDeckPayload({
      topic: "ORBIT",
      prompt: "Generate slides",
      designPrompt: "retro pixel palette",
      duration: 10,
      minSlides: 5,
      maxSlides: 8,
      template: "report",
      metadata: {
        audience: "general",
        purpose: "inform",
        tone: "professional"
      },
      design: {
        profile: "executive-report",
        visualRhythm: "auto",
        densityTarget: "medium",
        mediaPolicy: "balanced",
        layoutDiversity: "varied"
      },
      designReferences: [{ fileId: "file_design_1" }],
      referenceInput: {
        references: [{ fileId: "file_1" }],
        referenceKeywords: [{ text: "Deck" }],
        referenceContext: [
          { fileId: "file_1", title: "source.pdf", content: "source text" }
        ],
        succeededFiles: [],
        failedFiles: []
      }
    });

    expect(payload).toMatchObject({
      topic: "ORBIT",
      prompt: "Generate slides",
      designPrompt: "retro pixel palette",
      targetDurationMinutes: 10,
      slideCountRange: { min: 5, max: 8 },
      design: {
        profile: "executive-report",
        visualRhythm: "auto",
        densityTarget: "medium",
        mediaPolicy: "balanced",
        layoutDiversity: "varied"
      },
      references: [{ fileId: "file_1" }],
      designReferences: [{ fileId: "file_design_1" }],
      referenceKeywords: [{ text: "Deck" }],
      referenceContext: [
        { fileId: "file_1", title: "source.pdf", content: "source text" }
      ]
    });
  });

  it("builds a JSON-first home payload without a design PPTX", () => {
    const payload = buildHomeJsonFirstGenerateDeckPayload({
      topic: " ORBIT ",
      prompt: " 핵심 메시지 ",
      designPrompt: " 심플 베이직 발표용 ",
      duration: 10,
      minSlides: 5,
      maxSlides: 8,
      tone: "professional"
    });

    expect(payload).toMatchObject({
      topic: "ORBIT",
      prompt: "핵심 메시지",
      designPrompt: "심플 베이직 발표용",
      design: {
        visualRhythm: "auto",
        densityTarget: "medium",
        mediaPolicy: "balanced",
        layoutDiversity: "varied"
      },
      references: [],
      designReferences: [],
      referenceKeywords: [],
      referenceContext: []
    });
    expect(payload.design).not.toHaveProperty("stylePackId");
  });

  it("builds JSON-first home payloads with selected template styles", () => {
    const presentationPayload = buildHomeJsonFirstGenerateDeckPayload({
      topic: "ORBIT",
      prompt: "",
      designPrompt: "",
      templateStyleId: "presentation-document",
      duration: 10,
      minSlides: 5,
      maxSlides: 8,
      tone: "professional"
    });
    const submissionPayload = buildHomeJsonFirstGenerateDeckPayload({
      topic: "ORBIT",
      prompt: "",
      designPrompt: "",
      templateStyleId: "submission-document",
      duration: 10,
      minSlides: 5,
      maxSlides: 8,
      tone: "professional"
    });

    expect(presentationPayload.design).toMatchObject({
      stylePackId: "presentation-document",
      densityTarget: "low"
    });
    expect(submissionPayload.design).toMatchObject({
      stylePackId: "submission-document",
      densityTarget: "high",
      visualRhythm: "technical"
    });
  });

  it("applies selected template style design overrides", () => {
    const payload = buildHomeJsonFirstGenerateDeckPayload({
      topic: "ORBIT",
      prompt: "",
      designPrompt: "",
      templateStyleId: "presentation-document",
      templateStyleDesignOverrides: buildTemplateStyleDesignOverrides({
        densityTarget: "high",
        layoutDiversity: "varied",
        mediaPolicy: "avoid"
      }),
      duration: 10,
      minSlides: 5,
      maxSlides: 8,
      tone: "professional"
    });

    expect(payload.design).toMatchObject({
      stylePackId: "presentation-document",
      densityTarget: "high",
      layoutDiversity: "varied",
      mediaPolicy: "avoid"
    });
  });

  it("keeps content references when a template style is selected", () => {
    const payload = buildHomeJsonFirstGenerateDeckPayload({
      topic: "ORBIT",
      prompt: "",
      designPrompt: "",
      templateStyleId: "simple-basic",
      duration: 10,
      minSlides: 5,
      maxSlides: 8,
      tone: "professional",
      referenceInput: {
        references: [{ fileId: "file_reference" }],
        referenceKeywords: [{ text: "핵심" }],
        referenceContext: [
          { fileId: "file_reference", title: "reference.docx", content: "본문" }
        ],
        succeededFiles: [],
        failedFiles: []
      }
    });

    expect(payload.design.stylePackId).toBe("simple-basic");
    expect(payload.references).toEqual([{ fileId: "file_reference" }]);
    expect(payload.referenceKeywords).toEqual([{ text: "핵심" }]);
    expect(payload.referenceContext).toEqual([
      { fileId: "file_reference", title: "reference.docx", content: "본문" }
    ]);
  });

  it("routes home deck generation to JSON-first unless a design PPTX exists", () => {
    const pptx = new File(["pptx"], "design.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const pdf = new File(["pdf"], "content.pdf", { type: "application/pdf" });

    expect(getHomeDeckGenerationJobEndpoint("project a", [])).toBe(
      "/api/v1/projects/project%20a/jobs/generate-deck"
    );
    expect(
      getHomeDeckGenerationJobEndpoint("project a", [
        { id: "pdf", file: pdf, role: "content" }
      ])
    ).toBe("/api/v1/projects/project%20a/jobs/generate-deck");
    expect(
      getHomeDeckGenerationJobEndpoint("project a", [
        { id: "pptx", file: pptx, role: "design" }
      ])
    ).toBe("/api/v1/projects/project%20a/jobs/ai-template-deck-generation");
    expect(
      getHomeDeckGenerationJobEndpoint(
        "project a",
        [{ id: "pptx", file: pptx, role: "design" }],
        false
      )
    ).toBe("/api/v1/projects/project%20a/jobs/generate-deck");
    expect(getHomeDeckGenerationJobEndpoint("project a", [])).not.toContain(
      "pptx-ooxml"
    );
    expect(
      getHomeContentReferenceUploads([{ id: "pdf", file: pdf, role: "content" }])
    ).toHaveLength(1);
    expect(
      getHomeContentReferenceUploads(
        [{ id: "pptx", file: pptx, role: "design" }],
        true
      )
    ).toEqual([{ id: "pptx", file: pptx, role: "design" }]);
  });

  it("builds extract form data for content-only home references", () => {
    const pdf = new File(["pdf"], "content.pdf", { type: "application/pdf" });
    const formData = buildHomeExtractFormData(
      "project_ai",
      [{ id: "pdf", file: pdf, role: "content" }],
      new Map([["pdf", "file_content"]])
    );

    expect(formData.get("projectId")).toBe("project_ai");
    expect(formData.getAll("files")).toEqual([pdf]);
    expect(formData.getAll("fileIds")).toEqual(["file_content"]);
  });

  it("routes home reference extraction through the API proxy", () => {
    expect(homeReferenceExtractEndpoint).toBe("/api/extract");
  });

  it("omits a design profile when the profile picker is automatic", () => {
    expect(
      buildGenerateDeckDesignDirection({
        profile: "auto",
        visualRhythm: "auto",
        densityTarget: "medium",
        mediaPolicy: "balanced",
        layoutDiversity: "varied"
      })
    ).toEqual({
      visualRhythm: "auto",
      densityTarget: "medium",
      mediaPolicy: "balanced",
      layoutDiversity: "varied"
    });

    expect(
      buildGenerateDeckDesignDirection({
        profile: "editorial",
        visualRhythm: "auto",
        densityTarget: "medium",
        mediaPolicy: "balanced",
        layoutDiversity: "varied"
      }).profile
    ).toBe("editorial");
    expect(buildSimpleBasicGenerateDeckDesignDirection().stylePackId).toBe(
      "simple-basic"
    );
    expect(buildDefaultHomeGenerateDeckDesignDirection()).toEqual({
      visualRhythm: "auto",
      densityTarget: "medium",
      mediaPolicy: "balanced",
      layoutDiversity: "varied"
    });
    expect(
      buildHomeTemplateStyleGenerateDeckDesignDirection("presentation-document")
        .stylePackId
    ).toBe("presentation-document");
  });

  it("defaults an omitted design prompt to an empty string", () => {
    const payload = buildGenerateDeckPayload({
      topic: "ORBIT",
      prompt: "Generate slides",
      duration: 10,
      minSlides: 5,
      maxSlides: 8,
      template: "report",
      metadata: {
        audience: "general",
        purpose: "inform",
        tone: "professional"
      },
      design: {
        profile: "executive-report",
        visualRhythm: "auto",
        densityTarget: "medium",
        mediaPolicy: "balanced",
        layoutDiversity: "varied"
      },
      designReferences: [],
      referenceInput: {
        references: [],
        referenceKeywords: [],
        referenceContext: [],
        succeededFiles: [],
        failedFiles: []
      }
    });

    expect(payload.designPrompt).toBe("");
  });

  it("builds design references from PPTX role uploads", () => {
    const pptx = new File(["pptx"], "design.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const pdf = new File(["pdf"], "content.pdf", { type: "application/pdf" });
    const uploadedFileIds = new Map([
      ["design-only", "file_design"],
      ["both", "file_both"]
    ]);

    expect(
      buildDesignReferences(
        [
          { id: "content", file: pdf, role: "content" },
          { id: "design-only", file: pptx, role: "design" },
          { id: "both", file: pptx, role: "both" }
        ],
        uploadedFileIds
      )
    ).toEqual([{ fileId: "file_design" }, { fileId: "file_both" }]);
  });

  it("keeps a generated project at the top of the project list cache", () => {
    const older: Project = {
      projectId: "project_old",
      workspaceId: "workspace_demo_1",
      title: "Old",
      createdBy: "user_demo_1",
      createdAt: "2026-06-28T00:00:00.000Z"
    };
    const generated: Project = {
      projectId: "project_new_ai",
      workspaceId: "workspace_demo_1",
      title: "New",
      createdBy: "user_demo_1",
      createdAt: "2026-06-29T00:00:00.000Z"
    };

    expect(mergeGeneratedProjectList([older], generated)).toEqual([
      generated,
      older
    ]);
    expect(mergeGeneratedProjectList([generated, older], generated)).toEqual([
      generated,
      older
    ]);
  });

  it("creates a new project for an AI deck generation", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.endsWith("/workspaces/workspace_demo_1/projects")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({ title: "새 주제" });
        return new Response(
          JSON.stringify({
            projectId: "project_new_ai",
            workspaceId: "workspace_demo_1",
            title: "새 주제",
            createdBy: "user_demo_1",
            createdAt: "2026-06-29T00:00:00.000Z"
          })
        );
      }

      if (url.endsWith("/projects/project_new_ai/deck")) {
        const body = JSON.parse(String(init?.body));
        return new Response(
          JSON.stringify({
            deck: body.deck,
            snapshot: {
              snapshotId: "snapshot_new_ai",
              projectId: "project_new_ai",
              deckId: "deck_new_ai",
              version: 1,
              reason: "deck-replaced",
              createdAt: "2026-06-29T00:00:00.000Z"
            },
            updatedAt: "2026-06-29T00:00:00.000Z"
          })
        );
      }

      return new Response("unexpected request", { status: 500 });
    });

    await expect(createGeneratedDeckProject("  새 주제  ", fetcher)).resolves.toMatchObject({
      projectId: "project_new_ai"
    });
    expect(getGeneratedDeckProjectTitle("   ")).toBe("AI 덱");
  });

  it("uses a selected project as the generate-deck target", async () => {
    const selected: Project = {
      projectId: "project_selected",
      workspaceId: "workspace_demo_1",
      title: "Selected",
      createdBy: "user_demo_1",
      createdAt: "2026-06-29T00:00:00.000Z"
    };
    const fetcher = vi.fn(async () => new Response("unexpected", { status: 500 }));

    await expect(
      resolveGenerateDeckTargetProject({
        fetcher,
        projects: [selected],
        selectedProjectId: selected.projectId,
        topic: "새 주제"
      })
    ).resolves.toEqual({
      created: false,
      project: selected,
      projectId: selected.projectId
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("polls generic jobs through the API job route", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL) =>
      new Response(
        JSON.stringify({
          jobId: "job_done",
          projectId: "project_pptx",
          type: "pptx-import",
          status: "succeeded",
          progress: 100,
          message: "done",
          result: null,
          error: null,
          createdAt: "2026-07-03T00:00:00.000Z",
          updatedAt: "2026-07-03T00:00:00.000Z"
        })
      )
    );

    await expect(pollJob("job_done", fetcher)).resolves.toMatchObject({
      jobId: "job_done"
    });
    expect(String(fetcher.mock.calls[0][0])).toBe("/api/jobs/job_done");
  });

  it("reads a generated deck job result and renders slide evidence", () => {
    const job: Job = {
      jobId: "job-2",
      projectId: "project-a",
      type: "ai-deck-generation",
      status: "succeeded",
      progress: 100,
      message: "AI deck generation completed.",
      result: {
        deckId: "deck_ai_1",
        deck: {
          deckId: "deck_ai_1",
          projectId: "project-a",
          title: "AI 덱 생성 발표안",
          version: 1,
          metadata: {
            language: "ko",
            locale: "ko-KR",
            sourceType: "ai",
            generatedBy: "ai"
          },
          canvas: {
            preset: "wide-16-9",
            width: 1920,
            height: 1080,
            aspectRatio: "16:9"
          },
          slides: [
            {
              slideId: "slide_1",
              order: 1,
              title: "AI 덱 생성",
              thumbnailUrl: "",
              style: {},
              speakerNotes: "발표자 노트",
              elements: [],
              keywords: [],
              animations: [],
              actions: [],
              aiNotes: {
                emphasisPoints: ["핵심 메시지"],
                sourceEvidence: [{ fileId: "file_1", note: "근거 후보" }]
              }
            }
          ]
        },
        warnings: ["AI가 참고자료/주제 밀도를 기준으로 1장이 적정하다고 판단했습니다."],
        validation: {
          passed: true,
          layoutIssues: [],
          contentIssues: [],
          designIssues: [
            {
              scope: "element",
              path: "slides.0.elements.0.props.data",
              message: "근거 데이터가 없어 빈 차트 자리 표시자를 생성했습니다."
            }
          ],
          presentationIssues: []
        }
      },
      error: null,
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:01.000Z"
    };
    const result = getGenerateDeckJobResult(job);

    expect(result?.deckId).toBe("deck_ai_1");
    if (!result) {
      throw new Error("Generated deck result was not parsed.");
    }
    expect(getGeneratedDeckProjectPath(result)).toBe("/project/project-a");
    expect(renderToStaticMarkup(<GeneratedDeckResult result={result} />)).toContain(
      "file_1"
    );
    expect(renderToStaticMarkup(<GeneratedDeckResult result={result} />)).toContain(
      "AI가 참고자료/주제 밀도를 기준으로 1장이 적정하다고 판단했습니다."
    );
    expect(renderToStaticMarkup(<GeneratedDeckResult result={result} />)).toContain(
      "근거 데이터가 없어 빈 차트 자리 표시자를 생성했습니다."
    );
  });
});
