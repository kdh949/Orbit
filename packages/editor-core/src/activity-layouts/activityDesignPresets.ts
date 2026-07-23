import { deckElementSchema } from "@orbit/shared";
import type {
  ActivityAppearance,
  Deck,
  DeckElement,
  Slide
} from "@orbit/shared";

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
  const style = {
    backgroundColor: "#F7F7F2",
    textColor: "#171917",
    accentColor: "#C7FF35"
  };

  if (presetId === "blank") {
    return {
      activityAppearance: { mode: "editable" },
      style,
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
    style,
    elements
  };
}

function createSpotlightElements(
  element: ElementFactory,
  activityId: string
) {
  return [
    element.text(
      { x: 660, y: 118, width: 600, height: 40 },
      "LIVE ACTIVITY",
      { fontSize: 20, fontWeight: "semibold", align: "center" },
      "subtitle"
    ),
    element.copy(
      { x: 300, y: 205, width: 1320, height: 150 },
      activityId,
      "title",
      {
        fontSize: 92,
        fontWeight: "bold",
        align: "center",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "title"
    ),
    element.copy(
      { x: 500, y: 365, width: 920, height: 58 },
      activityId,
      "description",
      {
        fontSize: 30,
        color: "#62675F",
        align: "center",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "subtitle"
    ),
    element.qr({ x: 430, y: 500, width: 360, height: 360 }, activityId),
    element.shape(
      "rect",
      { x: 930, y: 520, width: 2, height: 300 },
      { fill: "#C9CEC5" },
      "decoration"
    ),
    element.passcode(
      { x: 1040, y: 535, width: 470, height: 270 },
      {
        labelTextStyle: { fontSize: 22, color: "#62675F" },
        codeTextStyle: {
          fontSize: 68,
          fontWeight: "bold",
          letterSpacing: 12,
          align: "center",
          verticalAlign: "middle"
        },
        fill: "#FFFFFF",
        stroke: "#C9CEC5",
        strokeWidth: 2,
        borderRadius: 24
      }
    ),
    element.shape(
      "rect",
      { x: 430, y: 875, width: 360, height: 12 },
      { fill: "#C7FF35", borderRadius: 6 },
      "decoration"
    ),
    element.text(
      { x: 600, y: 935, width: 720, height: 34 },
      "휴대폰으로 QR을 스캔해 참여해 주세요",
      { fontSize: 22, color: "#62675F", align: "center" },
      "footer"
    )
  ];
}

function createSplitElements(element: ElementFactory, activityId: string) {
  return [
    element.shape(
      "rect",
      { x: 1110, y: 0, width: 810, height: 1080 },
      { fill: "#171917" },
      "background"
    ),
    element.shape(
      "ellipse",
      { x: -180, y: 830, width: 430, height: 430 },
      { fill: "#C7FF35" },
      "decoration"
    ),
    element.text(
      { x: 110, y: 150, width: 820, height: 40 },
      "LIVE ACTIVITY",
      { fontSize: 20, fontWeight: "semibold" },
      "subtitle"
    ),
    element.copy(
      { x: 110, y: 245, width: 880, height: 270 },
      activityId,
      "title",
      {
        fontSize: 88,
        fontWeight: "bold",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "title"
    ),
    element.copy(
      { x: 110, y: 570, width: 840, height: 110 },
      activityId,
      "description",
      {
        fontSize: 30,
        color: "#62675F",
        autoFit: "shrink-text"
      },
      "subtitle"
    ),
    element.qr({ x: 1320, y: 145, width: 360, height: 360 }, activityId),
    element.passcode(
      { x: 1250, y: 600, width: 500, height: 250 },
      {
        labelTextStyle: { fontSize: 22, color: "#F7F7F2" },
        codeTextStyle: {
          fontSize: 68,
          fontWeight: "bold",
          letterSpacing: 12,
          color: "#F7F7F2",
          align: "center",
          verticalAlign: "middle"
        },
        fill: "transparent",
        stroke: "#62675F",
        strokeWidth: 2,
        borderRadius: 24
      }
    ),
    element.text(
      { x: 1250, y: 920, width: 500, height: 56 },
      "QR을 스캔하거나 입장 코드를 입력해 주세요",
      { fontSize: 20, color: "#F7F7F2", align: "center" },
      "footer"
    )
  ];
}

function createEditorialElements(
  element: ElementFactory,
  activityId: string
) {
  return [
    element.text(
      { x: 140, y: 165, width: 900, height: 40 },
      "AUDIENCE CHECK-IN",
      { fontSize: 20, fontWeight: "semibold" },
      "subtitle"
    ),
    element.copy(
      { x: 140, y: 275, width: 900, height: 280 },
      activityId,
      "title",
      {
        fontSize: 96,
        fontWeight: "bold",
        verticalAlign: "middle",
        autoFit: "shrink-text"
      },
      "title"
    ),
    element.shape(
      "rect",
      { x: 140, y: 600, width: 125, height: 10 },
      { fill: "#C7FF35", borderRadius: 5 },
      "decoration"
    ),
    element.copy(
      { x: 140, y: 645, width: 860, height: 105 },
      activityId,
      "description",
      { fontSize: 30, color: "#62675F", autoFit: "shrink-text" },
      "subtitle"
    ),
    element.shape(
      "ellipse",
      { x: 1460, y: 50, width: 540, height: 540 },
      { fill: "#C7FF35" },
      "decoration"
    ),
    element.shape(
      "rect",
      { x: 1240, y: 135, width: 520, height: 445 },
      { fill: "#FFFFFF", borderRadius: 30 },
      "decoration"
    ),
    element.qr({ x: 1310, y: 175, width: 380, height: 380 }, activityId),
    element.passcode(
      { x: 1240, y: 620, width: 520, height: 170 },
      {
        codeTextStyle: {
          fontSize: 58,
          fontWeight: "bold",
          letterSpacing: 12,
          align: "center",
          verticalAlign: "middle"
        },
        stroke: "#171917",
        strokeWidth: 2,
        borderRadius: 20
      }
    ),
    element.shape(
      "rect",
      { x: 0, y: 880, width: 1920, height: 200 },
      { fill: "#C7FF35" },
      "background"
    ),
    element.text(
      { x: 140, y: 930, width: 1640, height: 56 },
      "휴대폰으로 참여하고, 결과는 다음 장표에서 함께 확인합니다",
      {
        fontSize: 28,
        fontWeight: "semibold",
        verticalAlign: "middle"
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
