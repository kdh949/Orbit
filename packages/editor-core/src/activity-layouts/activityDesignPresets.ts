import { deckElementSchema } from "@orbit/shared/deck";
import type {
  ActivityAppearance,
  Deck,
  DeckElement,
  Slide,
} from "@orbit/shared/deck";

export const activityDesignPresetIds = [
  "spotlight",
  "split",
  "editorial",
  "essentials",
  "blank"
] as const;

export type ActivityDesignPresetId =
  (typeof activityDesignPresetIds)[number];

export const activityDesignPresetLabels: Record<
  ActivityDesignPresetId,
  string
> = {
  spotlight: "Spotlight",
  split: "Split",
  editorial: "Editorial",
  essentials: "Essentials",
  blank: "Blank"
};

export type ActivityDesignPreset = {
  activityAppearance: ActivityAppearance;
  style: Slide["style"];
  elements: DeckElement[];
};

type Frame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ElementFactory = ReturnType<typeof createElementFactory>;

export function createActivityDesignPreset(
  deck: Deck,
  activityId: string,
  presetId: ActivityDesignPresetId
): ActivityDesignPreset {
  const element = createElementFactory(deck);
  const baseStyle = {
    backgroundColor: "#F7F7F2",
    textColor: "#171917",
    accentColor: "#C7FF35",
    fontFamily: "Pretendard"
  };

  if (presetId === "blank") {
    return {
      activityAppearance: { mode: "editable" },
      style: baseStyle,
      elements: []
    };
  }

  const elements =
    presetId === "spotlight"
      ? createSpotlightElements(element, activityId)
      : presetId === "split"
        ? createSplitElements(element, activityId)
        : presetId === "editorial"
          ? createEditorialElements(element, activityId)
          : createEssentialsElements(element, activityId);

  return {
    activityAppearance: { mode: "editable" },
    style:
      presetId === "essentials"
        ? baseStyle
        : {
            ...baseStyle,
            backgroundImage: {
              src: `/activity-presets/${presetId}-background.png`,
              alt: `${activityDesignPresetLabels[presetId]} 참여 장표 배경`,
              fit: "stretch" as const,
              opacity: 1
            }
          },
    elements
  };
}

function createSpotlightElements(
  element: ElementFactory,
  activityId: string
) {
  return [
    element.text(
      { x: 830, y: 187, width: 261, height: 32 },
      "LIVE ACTIVITY",
      {
        fontSize: 28,
        fontWeight: "bold",
        letterSpacing: 2,
        color: "#52651F",
        align: "center",
        verticalAlign: "middle"
      },
      "subtitle"
    ),
    element.shape(
      "rect",
      { x: 892, y: 247, width: 136, height: 6 },
      {
        fill: {
          type: "linear-gradient",
          angle: 0,
          stops: [
            { offset: 0, color: "#C7F32D", opacity: 1 },
            { offset: 0.58, color: "#B6E84D", opacity: 1 },
            { offset: 1, color: "#4761B9", opacity: 1 }
          ]
        },
        borderRadius: 3
      },
      "decoration"
    ),
    element.copy(
      { x: 400, y: 298, width: 1120, height: 116 },
      activityId,
      "title",
      {
        fontSize: 76,
        fontWeight: "bold",
        align: "center",
        verticalAlign: "middle",
        autoFit: "shrink-text",
        lineHeight: 1.15
      },
      "title"
    ),
    element.copy(
      { x: 620, y: 430, width: 680, height: 58 },
      activityId,
      "description",
      {
        fontSize: 34,
        fontWeight: "medium",
        color: "#3F423D",
        align: "center",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "subtitle"
    ),
    element.shape(
      "rect",
      { x: 489, y: 538, width: 342, height: 342 },
      {
        fill: "#FFFFFF",
        borderRadius: 24,
        shadow: {
          color: "#65704A",
          blur: 28,
          offsetX: 0,
          offsetY: 10,
          opacity: 0.08
        }
      },
      "decoration"
    ),
    element.qr({ x: 508, y: 557, width: 304, height: 304 }, activityId),
    element.shape(
      "rect",
      { x: 914, y: 542, width: 2, height: 334 },
      { fill: "#D8DBD3" },
      "decoration"
    ),
    element.shape(
      "rect",
      { x: 1102, y: 571, width: 235, height: 58 },
      {
        fill: "#D8F05A",
        borderRadius: 29
      },
      "decoration"
    ),
    element.text(
      { x: 1102, y: 571, width: 235, height: 58 },
      "입장 코드",
      {
        fontSize: 30,
        fontWeight: "bold",
        color: "#101210",
        align: "center",
        verticalAlign: "middle"
      },
      "caption"
    ),
    element.passcode(
      { x: 992, y: 664, width: 453, height: 125 },
      {
        label: "",
        codeTextStyle: {
          fontSize: 42,
          fontWeight: "bold",
          letterSpacing: 15,
          align: "center",
          verticalAlign: "middle"
        },
        fill: "#FFFFFF",
        borderRadius: 18
      }
    ),
    element.text(
      { x: 1077, y: 830, width: 345, height: 28 },
      "발표 시작 후 코드가 표시됩니다.",
      {
        fontSize: 21,
        color: "#6A6D67",
        align: "center",
        verticalAlign: "middle"
      },
      "caption"
    ),
    element.image(
      { x: 588, y: 962, width: 120, height: 52 },
      "/brand/orbit-logo.png",
      "ORBIT"
    ),
    element.shape(
      "rect",
      { x: 728, y: 970, width: 1, height: 42 },
      { fill: "#D8DBD3" },
      "decoration"
    ),
    element.text(
      { x: 766, y: 975, width: 600, height: 40 },
      "휴대폰 카메라로 QR을 스캔하거나 입장 코드를 입력해 주세요.",
      {
        fontSize: 20,
        color: "#555853",
        align: "left",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "footer"
    )
  ];
}

function createSplitElements(element: ElementFactory, activityId: string) {
  return [
    element.text(
      { x: 112, y: 264, width: 268, height: 33 },
      "LIVE ACTIVITY",
      {
        fontSize: 28,
        fontWeight: "bold",
        letterSpacing: 2,
        color: "#6B8B20",
        verticalAlign: "middle"
      },
      "subtitle"
    ),
    element.copy(
      { x: 111, y: 343, width: 926, height: 228 },
      activityId,
      "title",
      {
        fontSize: 76,
        fontWeight: "bold",
        verticalAlign: "middle",
        autoFit: "shrink-text",
        lineHeight: 1.15
      },
      "title"
    ),
    element.copy(
      { x: 112, y: 622, width: 610, height: 48 },
      activityId,
      "description",
      {
        fontSize: 34,
        fontWeight: "medium",
        color: "#4D504B",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "subtitle"
    ),
    element.shape(
      "rect",
      { x: 1313, y: 195, width: 407, height: 407 },
      {
        fill: "#FFFFFF",
        borderRadius: 24,
        shadow: {
          color: "#000000",
          blur: 36,
          offsetX: 0,
          offsetY: 14,
          opacity: 0.18
        }
      },
      "decoration"
    ),
    element.qr({ x: 1343, y: 225, width: 347, height: 347 }, activityId),
    element.text(
      { x: 1427, y: 682, width: 168, height: 54 },
      "입장 코드",
      {
        fontSize: 42,
        fontWeight: "bold",
        color: "#F7F7F2",
        align: "center",
        verticalAlign: "middle"
      },
      "caption"
    ),
    element.passcode(
      { x: 1267, y: 760, width: 497, height: 130 },
      {
        label: "",
        codeTextStyle: {
          fontSize: 42,
          fontWeight: "bold",
          letterSpacing: 16,
          color: "#D9EF60",
          align: "center",
          verticalAlign: "middle"
        },
        fill: "#34393D",
        borderRadius: 18
      }
    )
  ];
}

function createEditorialElements(
  element: ElementFactory,
  activityId: string
) {
  return [
    element.image(
      { x: 64, y: 42, width: 164, height: 72 },
      "/brand/orbit-logo.png",
      "ORBIT"
    ),
    element.text(
      { x: 142, y: 279, width: 491, height: 29 },
      "AUDIENCE PARTICIPATION",
      {
        fontSize: 27,
        fontWeight: "bold",
        letterSpacing: 4,
        color: "#4E611D",
        verticalAlign: "middle"
      },
      "subtitle"
    ),
    element.copy(
      { x: 139, y: 344, width: 833, height: 263 },
      activityId,
      "title",
      {
        fontSize: 92,
        fontWeight: "bold",
        verticalAlign: "middle",
        autoFit: "shrink-text",
        lineHeight: 1.18
      },
      "title"
    ),
    element.shape(
      "rect",
      { x: 142, y: 662, width: 98, height: 10 },
      { fill: "#C8E53C" },
      "decoration"
    ),
    element.copy(
      { x: 142, y: 715, width: 649, height: 47 },
      activityId,
      "description",
      {
        fontSize: 34,
        fontWeight: "medium",
        color: "#30332F",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "subtitle"
    ),
    element.shape(
      "rect",
      { x: 1251, y: 243, width: 522, height: 411 },
      {
        fill: "#FFFFFF",
        borderRadius: 24,
        shadow: {
          color: "#72804E",
          blur: 34,
          offsetX: 0,
          offsetY: 12,
          opacity: 0.08
        }
      },
      "decoration"
    ),
    element.qr({ x: 1361, y: 297, width: 302, height: 302 }, activityId),
    element.shape(
      "rect",
      { x: 1251, y: 673, width: 522, height: 128 },
      { fill: "#FFFFFF", borderRadius: 20 },
      "decoration"
    ),
    element.text(
      { x: 1301, y: 718, width: 133, height: 36 },
      "입장 코드",
      {
        fontSize: 30,
        fontWeight: "bold",
        color: "#171917",
        verticalAlign: "middle"
      },
      "caption"
    ),
    element.shape(
      "rect",
      { x: 1492, y: 709, width: 1, height: 54 },
      { fill: "#C9CEC5" },
      "decoration"
    ),
    element.passcode(
      { x: 1520, y: 689, width: 220, height: 96 },
      {
        label: "",
        codeTextStyle: {
          fontSize: 36,
          fontWeight: "bold",
          letterSpacing: 14,
          align: "center",
          verticalAlign: "middle"
        },
        fill: "transparent"
      }
    ),
    element.shape(
      "ellipse",
      { x: 143, y: 931, width: 108, height: 108 },
      { fill: "#E4F26D" },
      "decoration"
    ),
    element.image(
      { x: 171, y: 959, width: 52, height: 52 },
      "/activity-presets/icons/message.svg",
      "참여 안내"
    ),
    element.text(
      { x: 278, y: 969, width: 822, height: 46 },
      "실시간 설문 · 의견제출 · 만족도 조사에 참여해 주세요!",
      {
        fontSize: 31,
        fontWeight: "medium",
        color: "#111311",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "footer"
    ),
    element.shape(
      "rect",
      { x: 1225, y: 952, width: 1, height: 76 },
      { fill: "#899839" },
      "decoration"
    ),
    element.image(
      { x: 1325, y: 959, width: 54, height: 54 },
      "/activity-presets/icons/clock.svg",
      "발표 중 참여 가능"
    ),
    element.text(
      { x: 1405, y: 976, width: 377, height: 33 },
      "발표 중 언제든 참여할 수 있습니다.",
      {
        fontSize: 22,
        fontWeight: "medium",
        color: "#171917",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "footer"
    )
  ];
}

function createEssentialsElements(
  element: ElementFactory,
  activityId: string
) {
  return [
    element.qr({ x: 510, y: 280, width: 420, height: 420 }, activityId),
    element.passcode(
      { x: 1030, y: 350, width: 440, height: 260 },
      {
        fill: "#FFFFFF",
        stroke: "#C9CEC5",
        strokeWidth: 2,
        borderRadius: 24
      }
    )
  ];
}

function createElementFactory(deck: Deck) {
  const allocateId = createElementIdAllocator(deck);
  let zIndex = 0;

  function base(frame: Frame, role?: DeckElement["role"]) {
    return {
      elementId: allocateId(),
      ...frame,
      rotation: 0,
      opacity: 1,
      zIndex: zIndex++,
      locked: false,
      visible: true,
      ...(role ? { role } : {})
    };
  }

  return {
    text(
      frame: Frame,
      text: string,
      props: Record<string, unknown>,
      role?: DeckElement["role"]
    ) {
      return deckElementSchema.parse({
        ...base(frame, role),
        type: "text",
        props: { text, ...props }
      });
    },
    copy(
      frame: Frame,
      activityId: string,
      field: "title" | "description",
      textStyle: Record<string, unknown>,
      role?: DeckElement["role"]
    ) {
      return deckElementSchema.parse({
        ...base(frame, role),
        type: "activity-copy",
        props: {
          activityId,
          field,
          fallbackText:
            field === "title"
              ? "질문을 입력해 주세요"
              : "참여 안내를 입력해 주세요",
          textStyle
        }
      });
    },
    qr(frame: Frame, activityId: string) {
      return deckElementSchema.parse({
        ...base(frame, "media"),
        type: "activity-qr",
        props: { activityId }
      });
    },
    passcode(frame: Frame, props: Record<string, unknown>) {
      return deckElementSchema.parse({
        ...base(frame, "highlight"),
        type: "presentation-passcode",
        props
      });
    },
    image(frame: Frame, src: string, alt: string) {
      return deckElementSchema.parse({
        ...base(frame, "media"),
        type: "image",
        props: {
          src,
          alt,
          fit: "contain",
          focusX: 0.5,
          focusY: 0.5
        }
      });
    },
    shape(
      type: "rect" | "ellipse",
      frame: Frame,
      props: Record<string, unknown>,
      role?: DeckElement["role"]
    ) {
      return deckElementSchema.parse({
        ...base(frame, role),
        type,
        props
      });
    }
  };
}

function createElementIdAllocator(deck: Deck) {
  const used = new Set(
    deck.slides.flatMap((slide) =>
      slide.elements.map((element) => element.elementId)
    )
  );
  let index = 1;

  return () => {
    while (used.has(`el_${index}`)) index += 1;
    const id = `el_${index}`;
    used.add(id);
    index += 1;
    return id;
  };
}
