import type { Deck } from "@orbit/shared";
import { deckSchema } from "@orbit/shared";

import { createDemoDeck } from "../fixtures";

export const privateTemplateMarker = "PRIVATE_TEMPLATE_MARKER_9f31";
export const privateTemplateUrl = "https://private.example/internal";
export const privateTemplateFileId = "file_private_123";

export function createPrivateCommunityTemplateDeck(): Deck {
  const source = structuredClone(createDemoDeck()) as unknown as Record<
    string,
    unknown
  >;
  const slides = source.slides as Array<Record<string, unknown>>;
  const firstSlide = slides[0]!;
  const secondSlide = slides[1]!;

  source.title = privateTemplateMarker;
  source.metadata = {
    language: "ko",
    locale: "ko-KR",
    sourceType: "import",
    createdFrom: {
      topic: privateTemplateMarker,
      references: [{ fileId: privateTemplateFileId }],
      designReferences: [{ fileId: privateTemplateFileId }],
    },
  };
  const theme = source.theme as Record<string, unknown>;
  theme.name = privateTemplateMarker;
  theme.fontFamily = privateTemplateMarker;
  (theme.typography as Record<string, unknown>).headingFontFamily =
    privateTemplateMarker;
  (theme.typography as Record<string, unknown>).bodyFontFamily =
    privateTemplateMarker;

  firstSlide.ooxmlOrigin = "imported";
  firstSlide.ooxmlSourceSlidePart = "ppt/slides/slide9.xml";
  firstSlide.ooxmlMotionCapabilities = {
    transitionWritable: true,
    importedMainSequenceCoverage: "complete",
  };
  firstSlide.title = privateTemplateMarker;
  firstSlide.thumbnailUrl = privateTemplateUrl;
  firstSlide.speakerNotes = `${privateTemplateMarker} ${privateTemplateUrl}`;
  firstSlide.transition = { type: "fade", durationMs: 300 };
  firstSlide.style = {
    layout: "title-content",
    fontFamily: privateTemplateMarker,
    backgroundColor: "#f8fbff",
    textColor: "#0f172a",
    accentColor: "#2563eb",
    backgroundImage: {
      src: privateTemplateUrl,
      alt: privateTemplateMarker,
      fit: "cover",
      opacity: 0.5,
    },
  };
  firstSlide.keywords = [
    {
      keywordId: `kw_${privateTemplateMarker}`,
      text: privateTemplateMarker,
      synonyms: [`${privateTemplateMarker}_synonym`],
      abbreviations: [`${privateTemplateMarker}_abbreviation`],
    },
  ];
  firstSlide.animations = [
    {
      animationId: `anim_${privateTemplateMarker}`,
      elementId: "el_1",
      type: "fade-in",
      order: 1,
      durationMs: 400,
      delayMs: 0,
      easing: "ease-out",
    },
  ];
  firstSlide.actions = [
    {
      actionId: `act_${privateTemplateMarker}`,
      trigger: { kind: "cue", cue: privateTemplateMarker },
      effect: {
        kind: "play-animation",
        animationId: `anim_${privateTemplateMarker}`,
      },
    },
  ];
  firstSlide.semanticCues = [
    {
      cueId: `scue_${privateTemplateMarker}`,
      slideId: "slide_1",
      meaning: privateTemplateMarker,
      reportLabel: privateTemplateMarker,
      presenterTag: privateTemplateMarker,
      nliHypotheses: [privateTemplateMarker],
      sourceFingerprint: privateTemplateMarker,
      sourceRefs: [
        {
          kind: "speaker-notes",
          refId: privateTemplateMarker,
          sourceHash: privateTemplateMarker,
        },
      ],
      candidateKeywords: [privateTemplateMarker],
      requiredConcepts: [privateTemplateMarker],
      negativeHints: [privateTemplateMarker],
      targetElementIds: ["el_1"],
      triggerActionIds: [`act_${privateTemplateMarker}`],
    },
  ];
  firstSlide.aiNotes = {
    emphasisPoints: [privateTemplateMarker],
    sourceEvidence: [
      {
        fileId: privateTemplateFileId,
        quote: privateTemplateMarker,
        note: privateTemplateMarker,
        confidence: 1,
      },
    ],
    visualPlan: {
      visualType: privateTemplateMarker,
      imageNeeded: true,
      imageSourcePolicy: privateTemplateMarker,
      reason: privateTemplateMarker,
      imagePrompt: privateTemplateMarker,
      imageAlt: privateTemplateMarker,
      imagePlacement: privateTemplateMarker,
      asset: {
        fileId: privateTemplateFileId,
        provider: privateTemplateMarker,
        sourceUrl: privateTemplateUrl,
        sourceAssetUrl: privateTemplateUrl,
      },
    },
    sourceLedger: [
      {
        claim: privateTemplateMarker,
        source: privateTemplateMarker,
        sourceType: "web",
        sourceId: privateTemplateMarker,
        fileId: privateTemplateFileId,
        chunkId: privateTemplateMarker,
        url: privateTemplateUrl,
        title: privateTemplateMarker,
        confidence: 1,
        usedInSlideId: "slide_1",
      },
    ],
    compositionPlan: {
      compositionId: "hero-split",
      variant: privateTemplateMarker,
      backgroundMode: "image",
      focalType: privateTemplateMarker,
      primaryFocalElementId: "el_1",
      assetRole: "evidence",
      requiredAsset: true,
    },
  };

  firstSlide.elements = [
    {
      elementId: "el_1",
      type: "text",
      role: "title",
      x: 120,
      y: 96,
      width: 640,
      height: 120,
      ooxmlOrigin: "imported",
      ooxmlEditCapabilities: {
        richText: "full",
        crop: "none",
        tableCellText: true,
        imageSource: true,
      },
      props: {
        text: privateTemplateMarker,
        runs: [
          { text: privateTemplateMarker, fontFamily: privateTemplateMarker },
        ],
        paragraphs: [
          {
            text: privateTemplateMarker,
            runs: [{ text: privateTemplateMarker }],
            bullet: {
              enabled: true,
              character: privateTemplateMarker,
              indent: 20,
            },
          },
        ],
        fontFamily: privateTemplateMarker,
        fontSize: 56,
        fontWeight: "bold",
        color: "#111827",
        bullet: { enabled: true, character: privateTemplateMarker, indent: 20 },
      },
    },
    {
      elementId: "el_image_private",
      type: "image",
      role: "media",
      x: 800,
      y: 100,
      width: 320,
      height: 240,
      props: {
        src: privateTemplateUrl,
        alt: privateTemplateMarker,
        fit: "cover",
      },
    },
    {
      elementId: "el_svg_private",
      type: "svg",
      role: "media",
      x: 1140,
      y: 100,
      width: 320,
      height: 240,
      props: {
        src: `data:image/svg+xml,${privateTemplateMarker}`,
        alt: privateTemplateMarker,
        fit: "contain",
      },
    },
    {
      elementId: "el_pattern_private",
      type: "rect",
      role: "decoration",
      x: 120,
      y: 300,
      width: 200,
      height: 100,
      props: {
        fill: {
          type: "pattern",
          preset: privateTemplateMarker,
          foreground: "#111827",
          background: "#ffffff",
        },
      },
    },
    {
      elementId: "el_custom_private",
      type: "customShape",
      role: "highlight",
      x: 340,
      y: 300,
      width: 200,
      height: 100,
      props: {
        pathData: privateTemplateMarker,
        viewBoxWidth: 200,
        viewBoxHeight: 100,
        fill: "#ffffff",
        stroke: "#111827",
        nodes: [{ x: 0, y: 0, mode: "corner" }],
      },
    },
    {
      elementId: "el_table_private",
      type: "table",
      role: "table",
      x: 560,
      y: 380,
      width: 520,
      height: 240,
      props: {
        rows: [
          [
            { text: privateTemplateMarker, fontFamily: privateTemplateMarker },
            { text: privateTemplateUrl, fontFamily: privateTemplateMarker },
          ],
          [{ text: privateTemplateFileId }, { text: privateTemplateMarker }],
        ],
        columnWidths: [260, 260],
        rowHeights: [120, 120],
      },
    },
    {
      elementId: "el_group_private",
      type: "group",
      role: "decoration",
      x: 800,
      y: 100,
      width: 660,
      height: 240,
      props: { childElementIds: ["el_image_private", "el_svg_private"] },
    },
    {
      elementId: "el_empty_group_private",
      type: "group",
      x: 10,
      y: 10,
      width: 10,
      height: 10,
      props: { childElementIds: [] },
    },
  ];

  const chartTypes = ["bar", "line", "pie", "doughnut", "scatter"] as const;
  secondSlide.elements = chartTypes.map((type, index) => ({
    elementId: `el_chart_${type}`,
    type: "chart",
    role: "chart",
    x: 100 + index * 250,
    y: 200,
    width: 220,
    height: 320,
    props: {
      type,
      title: privateTemplateMarker,
      style: {
        colors: ["#2563eb"],
        fontFamily: privateTemplateMarker,
        xAxisTitle: privateTemplateMarker,
        yAxisTitle: privateTemplateMarker,
        unit: privateTemplateMarker,
      },
      data:
        type === "scatter"
          ? [{ label: privateTemplateMarker, x: 9283, y: 7129 }]
          : [
              {
                label: privateTemplateMarker,
                series: privateTemplateMarker,
                value: 9283,
              },
            ],
    },
  }));

  return deckSchema.parse(source);
}
