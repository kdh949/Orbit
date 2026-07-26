import type {
  BriefRequirement,
  BriefRequirementInput,
  EvaluatorLensDefinition,
  PresentationBrief,
  PutPresentationBriefRequest,
} from "@orbit/shared/coaching";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconArrowLeft,
  IconCheck,
  IconSparkles,
  IconUser,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  OrbitButton,
  OrbitField,
  OrbitInput,
  OrbitStatus,
  OrbitTextarea,
} from "../../components/ui";
import {
  fetchEvaluatorLenses,
  fetchPresentationBrief,
  PresentationBriefConflictError,
  putPresentationBrief,
} from "./presentationBriefApi";
import "./presentation-brief.css";

type Audience = PutPresentationBriefRequest["audience"];
type Purpose = PutPresentationBriefRequest["purpose"];

const audienceOptions: ReadonlyArray<{ id: Audience; label: string }> = [
  { id: "novice", label: "처음 듣는 청중" },
  { id: "practitioner", label: "실무자" },
  { id: "decision-maker", label: "의사결정자" },
];

const purposeOptions: ReadonlyArray<{ id: Purpose; label: string }> = [
  { id: "inform", label: "설명" },
  { id: "persuade", label: "설득" },
  { id: "teach", label: "교육" },
  { id: "report", label: "보고" },
];

const fallbackLenses: EvaluatorLensDefinition[] = [
  { ref: { lensId: "general-novice", revision: 1 }, label: "처음 듣는 청중", description: "배경지식 없이도 핵심 흐름과 결론을 이해할 수 있는지 봅니다.", priorityOrder: ["structure", "semantic", "timing", "delivery"] },
  { ref: { lensId: "decision-maker", revision: 1 }, label: "의사결정자", description: "결정에 필요한 근거, 반론 대응, 다음 행동이 분명한지 봅니다.", priorityOrder: ["semantic", "structure", "timing", "delivery"] },
  { ref: { lensId: "strict-reviewer", revision: 1 }, label: "엄격한 검토자", description: "주장과 근거의 연결, 누락된 조건, 표현의 정확성을 우선합니다.", priorityOrder: ["semantic", "delivery", "structure", "timing"] },
];

export function PresentationBriefPage(props: { projectId: string }) {
  const queryClient = useQueryClient();
  const briefQuery = useQuery({
    queryKey: ["presentation-brief", props.projectId],
    queryFn: () => fetchPresentationBrief(props.projectId),
    retry: false,
  });
  const lensesQuery = useQuery({
    queryKey: ["evaluator-lenses"],
    queryFn: () => fetchEvaluatorLenses(),
    retry: false,
  });
  const hydratedRevision = useRef<number | null>(null);
  const [audience, setAudience] = useState<Audience>("decision-maker");
  const [purpose, setPurpose] = useState<Purpose>("persuade");
  const [lensId, setLensId] = useState("decision-maker");
  const [duration, setDuration] = useState("15");
  const [desiredOutcome, setDesiredOutcome] = useState("");
  const [mustCover, setMustCover] = useState("");
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [challengeTopics, setChallengeTopics] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const brief = briefQuery.data;
    const revision = brief?.revision ?? 0;
    if (hydratedRevision.current === revision) return;
    hydratedRevision.current = revision;
    if (!brief) return;

    setAudience(brief.audience);
    setPurpose(brief.purpose);
    setLensId(brief.evaluatorLensRef.lensId);
    setDuration(String(brief.targetDurationMinutes));
    setDesiredOutcome(brief.desiredOutcome);
    setMustCover(requirementsFor(brief, "must-cover").map((item) => item.text).join("\n"));
    setOpening(requirementsFor(brief, "opening")[0]?.text ?? "");
    setClosing(requirementsFor(brief, "closing")[0]?.text ?? "");
    setChallengeTopics(brief.challengeTopics.join("\n"));
  }, [briefQuery.data]);

  const lenses = lensesQuery.data ?? fallbackLenses;
  const selectedLens = useMemo(
    () => lenses.find((lens) => lens.ref.lensId === lensId) ?? lenses[0],
    [lensId, lenses],
  );

  async function saveBrief() {
    const targetDurationMinutes = Number(duration);
    const desired = desiredOutcome.trim();
    if (!Number.isInteger(targetDurationMinutes) || targetDurationMinutes < 1 || targetDurationMinutes > 120) {
      setError("목표 시간은 1~120분으로 입력해 주세요.");
      return;
    }
    if (!desired || !selectedLens) {
      setError("발표 후 원하는 결과와 평가 관점을 확인해 주세요.");
      return;
    }

    setSaving(true);
    setError("");
    setMessage("");
    try {
      const current = briefQuery.data;
      const saved = await putPresentationBrief(props.projectId, {
        expectedRevision: current?.revision ?? 0,
        audience,
        purpose,
        evaluatorLensRef: selectedLens.ref,
        targetDurationMinutes,
        desiredOutcome: desired,
        requirements: buildRequirementInputs(current, mustCover, opening, closing),
        terminology: current?.terminology ?? [],
        challengeTopics: toLines(challengeTopics, 3),
        approvedReferenceFileIds: current?.approvedReferences.map((item) => item.fileId) ?? [],
      });
      hydratedRevision.current = saved.revision;
      queryClient.setQueryData(["presentation-brief", props.projectId], saved);
      setMessage(`브리프 ${saved.revision}차 저장 완료`);
      window.history.pushState({}, "", `/project/${encodeURIComponent(props.projectId)}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (cause) {
      setError(
        cause instanceof PresentationBriefConflictError
          ? cause.message
          : cause instanceof Error
            ? cause.message
            : "Brief를 저장하지 못했습니다.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (briefQuery.isLoading || lensesQuery.isLoading) {
    return <BriefState title="발표 브리프를 불러오고 있어요." />;
  }

  return (
    <div className="redesign-page presentation-brief-page">
      <div className="presentation-brief-breadcrumb">
        <a href={`/project/${encodeURIComponent(props.projectId)}`}>
          <IconArrowLeft aria-hidden="true" size={17} /> 에디터
        </a>
        <span>/</span>
        <strong>발표 브리프</strong>
      </div>

      <section className="presentation-brief-heading">
        <div>
          <p className="redesign-eyebrow">Presentation brief</p>
          <h1>누구에게, 무엇을 얻기 위해<br />발표하는지 먼저 정리해요.</h1>
          <p>브리프가 생성 결과와 리허설 평가 기준을 같은 방향으로 맞춥니다.</p>
        </div>
        <OrbitStatus tone={message ? "success" : "lilac"}>{message || "약 1분"}</OrbitStatus>
      </section>

      <div className="presentation-brief-layout">
        <section className="presentation-brief-form" aria-label="발표 브리프 입력">
          <ChoiceGroup
            label="청중"
            onChange={(value) => setAudience(value as Audience)}
            options={audienceOptions}
            selected={audience}
          />
          <ChoiceGroup
            label="발표 목적"
            onChange={(value) => setPurpose(value as Purpose)}
            options={purposeOptions}
            selected={purpose}
          />
          <div className="presentation-brief-two-column">
            <OrbitField id="brief-duration" label="목표 시간">
              <OrbitInput inputMode="numeric" max="120" min="1" onChange={(event) => setDuration(event.target.value)} value={duration} />
            </OrbitField>
            <OrbitField id="brief-outcome" label="발표 후 원하는 결과">
              <OrbitInput maxLength={240} onChange={(event) => setDesiredOutcome(event.target.value)} value={desiredOutcome} />
            </OrbitField>
          </div>
          <OrbitField hint="한 줄에 하나씩, 최대 3개까지 저장합니다." id="brief-must-cover" label="반드시 전달할 내용">
            <OrbitTextarea maxLength={720} onChange={(event) => setMustCover(event.target.value)} rows={5} value={mustCover} />
          </OrbitField>
          <div className="presentation-brief-two-column">
            <OrbitField id="brief-opening" label="오프닝 조건">
              <OrbitInput maxLength={240} onChange={(event) => setOpening(event.target.value)} value={opening} />
            </OrbitField>
            <OrbitField id="brief-closing" label="클로징 조건">
              <OrbitInput maxLength={240} onChange={(event) => setClosing(event.target.value)} value={closing} />
            </OrbitField>
          </div>
          <OrbitField hint="예상 반론이나 도전 질문 주제를 한 줄에 하나씩 입력하세요." id="brief-challenges" label="예상 질문 주제">
            <OrbitTextarea maxLength={360} onChange={(event) => setChallengeTopics(event.target.value)} rows={3} value={challengeTopics} />
          </OrbitField>
        </section>

        <aside className="presentation-lens-panel">
          <header>
            <span><IconUser aria-hidden="true" size={23} /></span>
            <div><h2>평가 관점</h2><p>같은 발표에서도 먼저 볼 기준을 고릅니다.</p></div>
          </header>
          <div className="presentation-lens-list">
            {lenses.map((lens) => (
              <button
                aria-pressed={lens.ref.lensId === selectedLens?.ref.lensId}
                key={lens.ref.lensId}
                onClick={() => setLensId(lens.ref.lensId)}
                type="button"
              >
                <span>{lens.ref.lensId === selectedLens?.ref.lensId ? <IconCheck size={15} /> : null}</span>
                <strong>{lens.label}</strong>
                <small>{lens.description}</small>
              </button>
            ))}
          </div>
          <div className="presentation-brief-impact">
            <IconSparkles aria-hidden="true" size={20} />
            <span><strong>브리프가 있으면</strong>필수 메시지, 오프닝, 클로징과 예상 반론까지 분석해요.</span>
          </div>
          {briefQuery.isError || lensesQuery.isError ? <p className="presentation-brief-error" role="status">기존 설정을 불러오지 못해 기본값으로 시작합니다. 입력 내용은 그대로 저장할 수 있어요.</p> : null}
          {error ? <p className="presentation-brief-error" role="alert">{error}</p> : null}
          <OrbitButton disabled={saving} onClick={() => void saveBrief()}>
            {saving ? "저장 중" : "브리프 저장하고 계속"}
          </OrbitButton>
          <a className="presentation-brief-skip" href={`/project/${encodeURIComponent(props.projectId)}`}>에디터로 돌아가기</a>
        </aside>
      </div>
    </div>
  );
}

function ChoiceGroup(props: {
  label: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ id: string; label: string }>;
  selected: string;
}) {
  return (
    <fieldset className="presentation-brief-choice">
      <legend>{props.label}</legend>
      <div>
        {props.options.map((option) => (
          <button
            aria-pressed={props.selected === option.id}
            key={option.id}
            onClick={() => props.onChange(option.id)}
            type="button"
          >
            {props.selected === option.id ? <IconCheck aria-hidden="true" size={15} /> : null}
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function BriefState(props: { error?: boolean; title: string }) {
  return (
    <div className="redesign-page presentation-brief-page">
      <section className="presentation-brief-state" role={props.error ? "alert" : "status"}>
        <IconSparkles aria-hidden="true" size={30} />
        <h1>{props.title}</h1>
        <a href="/project">프로젝트로 돌아가기</a>
      </section>
    </div>
  );
}

function requirementsFor(brief: PresentationBrief, kind: BriefRequirement["kind"]) {
  return brief.requirements.filter((item) => item.kind === kind);
}

function buildRequirementInputs(
  brief: PresentationBrief | null | undefined,
  mustCover: string,
  opening: string,
  closing: string,
): BriefRequirementInput[] {
  const items: Array<{ kind: BriefRequirement["kind"]; text: string }> = [
    ...toLines(mustCover, 3).map((text) => ({ kind: "must-cover" as const, text })),
    ...(opening.trim() ? [{ kind: "opening" as const, text: opening.trim() }] : []),
    ...(closing.trim() ? [{ kind: "closing" as const, text: closing.trim() }] : []),
  ];
  const used = new Set<string>();
  return items.map((item) => {
    const existing = brief?.requirements.find(
      (candidate) => candidate.kind === item.kind && !used.has(candidate.requirementId),
    );
    if (existing) used.add(existing.requirementId);
    return {
      kind: item.kind,
      text: item.text,
      reviewStatus: "approved",
      ...(existing
        ? { requirementId: existing.requirementId, expectedRevision: existing.revision }
        : {}),
    };
  });
}

function toLines(value: string, max: number) {
  return value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, max);
}
