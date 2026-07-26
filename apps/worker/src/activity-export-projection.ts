import {
  activityAnswerSchema,
  activityDefinitionSchema,
  activityPresenterResultSchema,
  activityRetentionSnapshotSchema,
  buildActivityAggregates,
  calculateActivityResponseRate,
  type ActivityAnswer,
  type ActivityPresenterResult,
} from "@orbit/shared/activities";
import {
  deckSchema,
  type Deck,
  type DeckElement,
  type TextElementProps,
} from "@orbit/shared/deck";
import type { DataSource } from "typeorm";

type QueryExecutor = Pick<DataSource, "query">;
type ExportRunRow = {
  activity_run_id: string;
  activity_id: string;
  definition_snapshot: unknown;
  status: "draft" | "open" | "closed" | "results";
  revision: number;
  response_count: number;
  participant_count: number;
  aggregate_json: unknown | null;
  raw_responses_deleted_at: Date | string | null;
};
type ResponseRow = { answers_json: unknown };
type TextRow = {
  entry_id: string;
  question_id: string;
  text_value: string;
  answered_at: Date | string | null;
  updated_at: Date | string;
};

type LoadedActivityExportResult = {
  aggregateOnly: boolean;
  result: ActivityPresenterResult;
};

export async function projectActivityDeckForStaticExport(
  dataSource: QueryExecutor,
  projectId: string,
  deck: Deck,
  presentationSessionId?: string,
): Promise<Deck> {
  const projected = deckSchema.parse(deck);
  const sourceActivities = new Map(
    projected.slides
      .filter((slide) => slide.kind === "activity")
      .map((slide) => [slide.activity.activityId, slide.activity]),
  );

  for (const [index, slide] of projected.slides.entries()) {
    if (slide.kind === "content") {
      projected.slides[index] = {
        ...slide,
        elements: staticRuntimeElements(slide.elements, sourceActivities),
      };
      continue;
    }
    if (slide.kind === "activity") {
      const { kind: _kind, activity, ...base } = slide;
      projected.slides[index] = {
        ...base,
        kind: "content",
        speakerNotes: "",
        elements:
          slide.activityAppearance.mode === "editable"
            ? staticRuntimeElements(
                slide.elements,
                new Map([[activity.activityId, activity]]),
              )
            : staticActivityElements(slide.slideId, activity),
      };
      continue;
    }
    if (slide.kind !== "activity-results") continue;

    const { kind: _kind, activityResult, ...base } = slide;
    const source = sourceActivities.get(slide.activityResult.sourceActivityId);
    if (!source) {
      projected.slides[index] = {
        ...base,
        kind: "content",
        speakerNotes: "",
        elements: staticMessageElements(
          slide.slideId,
          slide.title || "참여 결과",
          "연결된 참여 장표를 찾을 수 없습니다.",
        ),
      };
      continue;
    }
    if (!presentationSessionId) {
      projected.slides[index] = {
        ...base,
        kind: "content",
        speakerNotes: "",
        elements: staticMessageElements(
          slide.slideId,
          source.title,
          "발표 세션을 선택하면 결과를 포함할 수 있습니다",
        ),
      };
      continue;
    }

    const result = await loadActivityExportResult(
      dataSource,
      projectId,
      projected.deckId,
      presentationSessionId,
      source.activityId,
    );
    projected.slides[index] = {
      ...base,
      kind: "content",
      speakerNotes: "",
      elements: result
        ? staticResultElements(
            slide.slideId,
            source,
            result.result,
            activityResult.layout,
            result.aggregateOnly,
          )
        : staticMessageElements(
            slide.slideId,
            source.title,
            "선택한 발표 세션에 결과가 없습니다.",
          ),
    };
  }

  return deckSchema.parse(projected);
}

function staticRuntimeElements(
  elements: DeckElement[],
  definitions: Map<
    string,
    ReturnType<typeof activityDefinitionSchema.parse>
  >,
): DeckElement[] {
  return elements.map((element) => {
    if (element.type === "activity-copy") {
      const definition = definitions.get(element.props.activityId);
      const text =
        (element.props.field === "title"
          ? definition?.title
          : definition?.description) || element.props.fallbackText;
      return runtimeTextElement(element, text, element.props.textStyle);
    }
    if (
      element.type === "activity-qr" ||
      element.type === "presentation-passcode"
    ) {
      return runtimeTextElement(
        element,
        element.type === "activity-qr"
          ? "참여 QR 코드는 라이브 발표에서 표시됩니다."
          : "입장 코드는 라이브 발표에서 표시됩니다.",
        {
          color:
            element.type === "presentation-passcode"
              ? element.props.codeTextStyle.color
              : "#475467",
          fontFamily:
            element.type === "presentation-passcode"
              ? element.props.codeTextStyle.fontFamily
              : "Arial",
          fontSize:
            element.type === "presentation-passcode"
              ? element.props.codeTextStyle.fontSize
              : 24,
          fontWeight:
            element.type === "presentation-passcode"
              ? element.props.codeTextStyle.fontWeight
              : "normal",
          align: "center",
          verticalAlign: "middle",
          lineHeight: 1.2,
        },
      );
    }
    return element;
  });
}

function runtimeTextElement(
  element: DeckElement,
  text: string,
  style: Partial<TextElementProps>,
): DeckElement {
  return {
    ...element,
    role: element.role ?? "body",
    type: "text",
    props: {
      ...style,
      text,
      fontSize: style.fontSize ?? 24,
      fontWeight: style.fontWeight ?? "normal",
      align: style.align ?? "left",
      verticalAlign: style.verticalAlign ?? "middle",
      lineHeight: style.lineHeight ?? 1.2,
    },
  } as DeckElement;
}

async function loadActivityExportResult(
  dataSource: QueryExecutor,
  projectId: string,
  deckId: string,
  sessionId: string,
  activityId: string,
): Promise<LoadedActivityExportResult | null> {
  const runs = readQueryRows<ExportRunRow>(
    await dataSource.query(
      `
        SELECT runs.activity_run_id, runs.activity_id, runs.definition_snapshot,
               runs.status, runs.revision, runs.response_count,
               (SELECT COUNT(*)::int
                FROM presentation_session_audiences AS audiences
                WHERE audiences.project_id = runs.project_id
                  AND audiences.session_id = runs.session_id) AS participant_count,
               snapshots.aggregate_json, sessions.raw_responses_deleted_at
        FROM activity_runs AS runs
        INNER JOIN presentation_sessions AS sessions
          ON sessions.project_id = runs.project_id
         AND sessions.session_id = runs.session_id
        LEFT JOIN activity_result_snapshots AS snapshots
          ON snapshots.project_id = runs.project_id
         AND snapshots.activity_run_id = runs.activity_run_id
        WHERE runs.project_id = $1 AND runs.session_id = $2
          AND runs.activity_id = $3
          AND sessions.deck_id = $4
          AND sessions.results_deleted_at IS NULL
        ORDER BY runs.is_current DESC, runs.version DESC
        LIMIT 1
      `,
      [projectId, sessionId, activityId, deckId],
    ),
  );
  const run = runs[0];
  if (!run) return null;
  if (run.aggregate_json !== null) {
    return {
      aggregateOnly: true,
      result: activityRetentionSnapshotSchema.parse(run.aggregate_json),
    };
  }
  if (run.raw_responses_deleted_at) return null;

  const [responses, approvedText] = await Promise.all([
    dataSource.query(
      `
        SELECT answers_json
        FROM activity_responses
        WHERE project_id = $1 AND activity_run_id = $2
        ORDER BY submitted_at ASC
      `,
      [projectId, run.activity_run_id],
    ),
    dataSource.query(
      `
        SELECT entries.entry_id, entries.question_id, entries.text_value,
               entries.answered_at, entries.updated_at
        FROM activity_text_entries AS entries
        INNER JOIN activity_responses AS responses
          ON responses.project_id = entries.project_id
         AND responses.response_id = entries.response_id
        WHERE entries.project_id = $1
          AND responses.activity_run_id = $2
          AND entries.moderation_status = 'approved'
        ORDER BY entries.updated_at ASC
      `,
      [projectId, run.activity_run_id],
    ),
  ]);
  const definition = activityDefinitionSchema.parse(run.definition_snapshot);
  const answers = readQueryRows<ResponseRow>(responses).map((row) =>
    activityAnswerSchema.array().parse(row.answers_json),
  );
  return {
    aggregateOnly: false,
    result: activityPresenterResultSchema.parse({
      activityRunId: run.activity_run_id,
      activityId: run.activity_id,
      status: run.status,
      revision: run.revision,
      responseCount: run.response_count,
      participantCount: run.participant_count,
      responseRate: calculateActivityResponseRate(
        run.response_count,
        run.participant_count,
      ),
      aggregates: buildActivityAggregates(
        definition,
        answers as ActivityAnswer[][],
      ),
      textEntries: readQueryRows<TextRow>(approvedText).map((entry) => ({
        entryId: entry.entry_id,
        questionId: entry.question_id,
        text: entry.text_value,
        displayName: null,
        moderationStatus: "approved" as const,
        answeredAt: toOptionalIso(entry.answered_at),
        updatedAt: toIso(entry.updated_at),
      })),
    }),
  };
}

function staticActivityElements(
  slideId: string,
  definition: ReturnType<typeof activityDefinitionSchema.parse>,
) {
  const questions = definition.questions
    .map((question, index) => `${index + 1}. ${question.prompt}`)
    .join("\n");
  return [
    textElement(
      slideId,
      "eyebrow",
      "참여 장표",
      120,
      100,
      1680,
      70,
      30,
      "semibold",
    ),
    textElement(
      slideId,
      "title",
      definition.title,
      120,
      200,
      1680,
      150,
      62,
      "bold",
    ),
    textElement(
      slideId,
      "questions",
      questions,
      120,
      410,
      1680,
      330,
      30,
      "normal",
    ),
    textElement(
      slideId,
      "notice",
      "실시간 참여는 발표 중 제공됩니다.",
      120,
      850,
      1680,
      80,
      26,
      "semibold",
    ),
  ];
}

function staticMessageElements(
  slideId: string,
  title: string,
  message: string,
) {
  return [
    textElement(slideId, "title", title, 160, 220, 1600, 150, 58, "bold"),
    textElement(slideId, "message", message, 160, 470, 1600, 160, 34, "normal"),
  ];
}

function staticResultElements(
  slideId: string,
  definition: ReturnType<typeof activityDefinitionSchema.parse>,
  result: ActivityPresenterResult,
  layout: "summary" | "chart" | "approved-text",
  aggregateOnly: boolean,
) {
  if (layout === "approved-text") {
    return staticApprovedTextResultElements(
      slideId,
      definition,
      result,
      aggregateOnly,
    );
  }
  if (layout === "chart") {
    return staticChartResultElements(slideId, definition, result);
  }
  return staticSummaryResultElements(slideId, definition, result);
}

function staticSummaryResultElements(
  slideId: string,
  definition: ReturnType<typeof activityDefinitionSchema.parse>,
  result: ActivityPresenterResult,
) {
  const aggregateLines = result.aggregates.map((aggregate) => {
    const question = definition.questions.find(
      (candidate) => candidate.questionId === aggregate.questionId,
    );
    const label = question?.prompt ?? aggregate.questionId;
    if (aggregate.type === "rating") {
      return `${label}: ${aggregate.average?.toFixed(1) ?? "–"} / 5`;
    }
    if (
      (question?.type === "single-choice" ||
        question?.type === "multiple-choice") &&
      aggregate.choices.length > 0
    ) {
      const top = [...aggregate.choices].sort(
        (left, right) => right.count - left.count,
      )[0];
      const option = question.options.find(
        (candidate) => candidate.optionId === top?.optionId,
      );
      return `${label}: ${option?.label ?? "–"} (${top?.count ?? 0}명)`;
    }
    return `${label}: ${aggregate.responseCount}개 의견`;
  });
  return [
    textElement(
      slideId,
      "eyebrow",
      "발표 결과",
      120,
      90,
      1680,
      65,
      28,
      "semibold",
    ),
    textElement(
      slideId,
      "title",
      definition.title,
      120,
      170,
      1680,
      120,
      56,
      "bold",
    ),
    textElement(
      slideId,
      "count",
      `${result.responseCount}명 응답`,
      120,
      310,
      1680,
      80,
      30,
      "semibold",
    ),
    textElement(
      slideId,
      "aggregates",
      aggregateLines.join("\n"),
      120,
      430,
      1680,
      450,
      28,
      "normal",
    ),
  ];
}

function staticChartResultElements(
  slideId: string,
  definition: ReturnType<typeof activityDefinitionSchema.parse>,
  result: ActivityPresenterResult,
) {
  const rows = definition.questions.flatMap((question) => {
    const aggregate = result.aggregates.find(
      (candidate) => candidate.questionId === question.questionId,
    );
    if (!aggregate) return [];
    if (question.type === "single-choice" || question.type === "multiple-choice") {
      return question.options.map((option) => {
        const choice = aggregate.choices.find(
          (candidate) => candidate.optionId === option.optionId,
        );
        return {
          label: `${question.prompt} · ${option.label}`,
          ratio: choice?.ratio ?? 0,
          value: `${Math.round((choice?.ratio ?? 0) * 100)}%`,
        };
      });
    }
    if (question.type === "rating") {
      const average = aggregate.average ?? 0;
      return [{
        label: question.prompt,
        ratio: average / 5,
        value: `${aggregate.average?.toFixed(1) ?? "–"} / 5`,
      }];
    }
    return [{
      label: question.prompt,
      ratio: result.responseCount === 0 ? 0 : aggregate.responseCount / result.responseCount,
      value: `${aggregate.responseCount}개`,
    }];
  }).slice(0, 7);
  const elements: DeckElement[] = staticResultHeaderElements(
    slideId,
    definition.title,
    result.responseCount,
  );
  rows.forEach((row, index) => {
    const y = 430 + index * 76;
    elements.push(
      textElement(slideId, `chart_label_${index}`, row.label, 120, y, 420, 54, 20, "semibold"),
      rectElement(slideId, `chart_track_${index}`, 570, y + 12, 980, 28, "#E5E7EB", 1),
    );
    if (row.ratio > 0) {
      elements.push(rectElement(
        slideId,
        `chart_value_${index}`,
        570,
        y + 12,
        980 * Math.min(1, row.ratio),
        28,
        "#8B5CF6",
        2,
      ));
    }
    elements.push(
      textElement(slideId, `chart_count_${index}`, row.value, 1580, y, 220, 54, 22, "bold"),
    );
  });
  return elements;
}

function staticApprovedTextResultElements(
  slideId: string,
  definition: ReturnType<typeof activityDefinitionSchema.parse>,
  result: ActivityPresenterResult,
  aggregateOnly: boolean,
) {
  const approved = result.textEntries
    .filter((entry) => entry.moderationStatus === "approved")
    .slice(0, 8)
    .map((entry) => `• ${entry.text.replace(/\s+/g, " ").slice(0, 180)}`);
  const message = aggregateOnly
    ? "원문 보존 기간이 종료되어 승인 의견을 표시할 수 없습니다."
    : approved.length > 0
      ? approved.join("\n")
      : "승인된 의견이 없습니다.";
  return [
    ...staticResultHeaderElements(slideId, definition.title, result.responseCount),
    textElement(slideId, "approved", message, 120, 430, 1680, 450, 28, "normal"),
  ];
}

function staticResultHeaderElements(
  slideId: string,
  title: string,
  responseCount: number,
) {
  return [
    textElement(slideId, "eyebrow", "발표 결과", 120, 90, 1680, 65, 28, "semibold"),
    textElement(slideId, "title", title, 120, 170, 1680, 120, 56, "bold"),
    textElement(slideId, "count", `${responseCount}명 응답`, 120, 310, 1680, 80, 30, "semibold"),
  ];
}

function rectElement(
  slideId: string,
  suffix: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fill: string,
  zIndex: number,
) {
  return {
    elementId: `el_export_${slideId}_${suffix}`,
    type: "rect" as const,
    role: "decoration" as const,
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    zIndex,
    locked: true,
    visible: true,
    props: {
      fill,
      stroke: "transparent",
      strokeWidth: 0,
      borderRadius: 14,
    },
  };
}

function textElement(
  slideId: string,
  suffix: string,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  fontWeight: "normal" | "semibold" | "bold",
) {
  return {
    elementId: `el_export_${slideId}_${suffix}`,
    type: "text" as const,
    role: suffix === "title" ? ("title" as const) : ("body" as const),
    x,
    y,
    width,
    height,
    rotation: 0,
    opacity: 1,
    zIndex: 1,
    locked: true,
    visible: true,
    props: {
      text,
      fontSize,
      fontWeight,
      color: "#111827",
      align: "left" as const,
      verticalAlign: "middle" as const,
      lineHeight: 1.25,
    },
  };
}

function readQueryRows<T>(queryResult: unknown): T[] {
  if (!Array.isArray(queryResult)) return [];
  if (Array.isArray(queryResult[0])) return queryResult[0] as T[];
  return queryResult as T[];
}

function toIso(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toOptionalIso(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}
