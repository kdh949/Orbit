import type {
  DeckColorCustomizationResponse,
  GenerateDeckFontOption,
  GenerateDeckMediaPolicy,
  GenerateDeckRequest,
  GenerateDeckReferencePolicy,
  Job,
  AiDeckDesignSelectionResponse,
} from "@orbit/shared";
import { demoIds, recommendGenerateDeckFonts } from "@orbit/shared";
import {
  IconArrowRight,
  IconBolt,
  IconBriefcase2,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconFileUpload,
  IconFileText,
  IconFileDescription,
  IconListDetails,
  IconLoader2,
  IconMessageCircle,
  IconMessageCircleHeart,
  IconPaperclip,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconPresentationAnalytics,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconUsers,
} from "@tabler/icons-react";
import type { DragEvent, ReactNode, Ref } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import strategyImage from "../../assets/ai-ppt/orbit-ai-strategy.png";
import roadmapImage from "../../assets/ai-ppt/orbit-ai-roadmap.png";
import { WorkspaceContainer } from "../../components/patterns";
import {
  DropdownMenu,
  DropdownMenuItem,
  GradientButton,
  OrbitButton,
  OrbitField,
  OrbitIconLabel,
  OrbitIconButton,
  OrbitInput,
  OrbitTextarea,
} from "../../components/ui";
import {
  createProjectWithoutDeck,
  deleteProject,
  uploadProjectAsset,
} from "../projects/ProjectAssetWorkspace";
import {
  generationPath,
  requestDesignSelection,
  saveDesignSelection,
  styleColorPath,
} from "./design-selection-api";
import "./ai-ppt-mockup.css";

type Tone = "professional" | "friendly" | "confident" | "concise";
type PaletteOverride = NonNullable<
  GenerateDeckRequest["design"]["paletteOverride"]
>;

export type PaletteOption = {
  optionId: string;
  name: string;
  rationale: string;
  palette: Required<PaletteOverride>;
};

export type AiPptWizardState = {
  topic: string;
  content: string;
  audience: string;
  tone: Tone;
  referencePolicy: GenerateDeckReferencePolicy;
  mediaPolicy: GenerateDeckMediaPolicy;
};

type PolicyChoiceOption<T extends string> = {
  value: T;
  label: string;
  description: string;
};

const stylePackId = "brandlogy-modern";
const defaultFontMood = "professional trustworthy Korean sans font";
const flowSteps = [
  { label: "내용 입력" },
  { label: "Style & Color" },
];

type UploadState = {
  status: "uploading" | "uploaded" | "failed";
  fileId?: string;
  error?: string;
};
const toneOptions: Array<{
  value: Tone;
  label: string;
  description: string;
}> = [
  {
    value: "professional",
    label: "전문적인",
    description: "객관적이고 구조적인 문장",
  },
  {
    value: "confident",
    label: "자신감 있는",
    description: "단정적이고 힘 있는 문장",
  },
  {
    value: "friendly",
    label: "친근한",
    description: "부드럽고 대화하듯 자연스러운 문장",
  },
];

export const referencePolicyOptions = [
  {
    value: "user-input-only",
    label: "사용자 입력만",
    description:
      "발표 주제와 Brief 입력만 사용합니다. 첨부 파일 분석과 웹 검색은 실행하지 않습니다.",
  },
  {
    value: "references-first",
    label: "참고자료 우선",
    description:
      "첨부 자료를 중심으로 구성하고 웹 출처로 보완합니다. 분석 가능한 첨부가 1개 이상 필요하며, 웹 검색 실패 시 첨부 자료만으로 계속합니다.",
  },
  {
    value: "references-only",
    label: "참고자료만 사용",
    description:
      "첨부한 모든 자료에서 분석 가능한 텍스트를 확보해야 합니다. 웹 검색 없이 첨부 자료만 근거로 생성합니다.",
  },
  {
    value: "research-first",
    label: "웹 리서치 우선",
    description:
      "웹 리서치를 중심으로 구성하고 첨부 자료는 방향 보정에 사용합니다. 출처가 부족해도 검증 가능한 범위에서 초안을 생성합니다.",
  },
] satisfies readonly PolicyChoiceOption<GenerateDeckReferencePolicy>[];

export const mediaPolicyOptions = [
  {
    value: "minimal",
    label: "이미지 최소화",
    description: "이미지 슬롯을 만들지 않고 도형과 타이포 중심으로 구성합니다.",
  },
  {
    value: "provided-only",
    label: "첨부 이미지만",
    description:
      "첨부 이미지에 사용 가능한 source가 있을 때만 사용합니다. source가 없으면 이미지 슬롯을 만들지 않습니다.",
  },
  {
    value: "public-assets",
    label: "공개 이미지 구조",
    description:
      "공개 이미지 사용을 전제로 visual plan과 교체 가능한 placeholder만 만듭니다. 현재는 이미지 검색, 라이선스 확인, 다운로드를 하지 않습니다.",
  },
  {
    value: "ai-generated",
    label: "AI 이미지 구조",
    description:
      "AI 이미지 생성을 전제로 이미지 계획과 교체 가능한 placeholder만 만듭니다. 현재 실제 이미지 파일은 생성하지 않습니다.",
  },
  {
    value: "hybrid",
    label: "공식 + AI 이미지",
    description:
      "공식 이미지를 근거 자료로 우선 사용하고, 분위기 연출이 필요한 장면만 AI 이미지 구조로 보완합니다.",
  },
] satisfies readonly PolicyChoiceOption<GenerateDeckMediaPolicy>[];

export const defaultPaletteOptions: PaletteOption[] = [
  {
    optionId: "brandlogy-blue",
    name: "ORBIT Lilac",
    rationale: "ORBIT의 Lilac과 Ink 대비를 사용하는 선명한 기본 팔레트입니다.",
    palette: {
      primary: "#6846D8",
      secondary: "#1F1D3D",
      background: "#F7F7F5",
      surface: "#FFFFFF",
      muted: "#F1ECFF",
      border: "#E6E6E6",
      text: "#090909",
      accentColor: "#C5B0F4",
    },
  },
  {
    optionId: "executive-slate",
    name: "이그제큐티브 슬레이트",
    rationale: "임원 의사결정 회의에 어울리는 절제된 고대비 팔레트입니다.",
    palette: {
      primary: "#334155",
      secondary: "#64748B",
      background: "#FFFFFF",
      surface: "#F8FAFC",
      muted: "#E2E8F0",
      border: "#CBD5E1",
      text: "#111827",
      accentColor: "#0891B2",
    },
  },
  {
    optionId: "modern-violet",
    name: "모던 바이올렛",
    rationale: "AI와 제품 발표에 어울리는 선명한 바이올렛 팔레트입니다.",
    palette: {
      primary: "#7C3AED",
      secondary: "#4F46E5",
      background: "#FAF5FF",
      surface: "#FFFFFF",
      muted: "#EDE9FE",
      border: "#DDD6FE",
      text: "#18181B",
      accentColor: "#EC4899",
    },
  },
  {
    optionId: "resort-blue",
    name: "리조트 블루",
    rationale: "여행과 휴양 주제에 어울리는 편안한 블루 팔레트입니다.",
    palette: {
      primary: "#0EA5E9",
      secondary: "#0369A1",
      background: "#F0F9FF",
      surface: "#FFFFFF",
      muted: "#E0F2FE",
      border: "#BAE6FD",
      text: "#0F172A",
      accentColor: "#F472B6",
    },
  },
  {
    optionId: "calm-green",
    name: "캄 그린",
    rationale: "교육과 지속가능성 주제에 어울리는 안정적인 팔레트입니다.",
    palette: {
      primary: "#059669",
      secondary: "#0F766E",
      background: "#F0FDF4",
      surface: "#FFFFFF",
      muted: "#DCFCE7",
      border: "#BBF7D0",
      text: "#052E16",
      accentColor: "#2563EB",
    },
  },
  {
    optionId: "energetic-coral",
    name: "에너제틱 코랄",
    rationale: "출시와 피치 발표에 어울리는 활기찬 팔레트입니다.",
    palette: {
      primary: "#F97316",
      secondary: "#DB2777",
      background: "#FFF7ED",
      surface: "#FFFFFF",
      muted: "#FFEDD5",
      border: "#FED7AA",
      text: "#111827",
      accentColor: "#2563EB",
    },
  },
  {
    optionId: "warm-amber",
    name: "웜 앰버",
    rationale: "따뜻하고 설득력 있는 이야기에 어울리는 앰버 팔레트입니다.",
    palette: {
      primary: "#D97706",
      secondary: "#92400E",
      background: "#FFFBEB",
      surface: "#FFFFFF",
      muted: "#FEF3C7",
      border: "#FDE68A",
      text: "#1C1917",
      accentColor: "#2563EB",
    },
  },
  {
    optionId: "editorial-rose",
    name: "에디토리얼 로즈",
    rationale: "콘텐츠와 브랜드 메시지에 어울리는 세련된 로즈 팔레트입니다.",
    palette: {
      primary: "#BE123C",
      secondary: "#9D174D",
      background: "#FFF1F2",
      surface: "#FFFFFF",
      muted: "#FFE4E6",
      border: "#FECDD3",
      text: "#1F1720",
      accentColor: "#0F766E",
    },
  },
  {
    optionId: "graphite-night",
    name: "그래파이트 나이트",
    rationale: "기술과 프리미엄 발표에 어울리는 어두운 고대비 팔레트입니다.",
    palette: {
      primary: "#38BDF8",
      secondary: "#A78BFA",
      background: "#0F172A",
      surface: "#1E293B",
      muted: "#334155",
      border: "#475569",
      text: "#F8FAFC",
      accentColor: "#F59E0B",
    },
  },
];

type PaletteSlideKind =
  | "cover"
  | "metrics"
  | "timeline"
  | "quote"
  | "comparison"
  | "roadmap"
  | "chart"
  | "agenda"
  | "matrix";

export type PaletteMockupPreset = {
  category: string;
  kind: PaletteSlideKind;
  eyebrow: string;
  title: string;
  subtitle: string;
  role: string;
  version: string;
  image?: string;
};

/** 고정된 디자인 샘플 데이터. 팔레트 선택과 무관하게 같은 목업 구조를 재현한다. */
export const paletteMockupPresets: Record<string, PaletteMockupPreset> = {
  "brandlogy-blue": {
    category: "PRIMARY",
    kind: "cover",
    eyebrow: "ORBIT / 2026",
    title: "우리가 만드는 다음 장면",
    subtitle: "선명한 대비로 제품 전략의 시작점을 만듭니다.",
    role: "--color-primary-main",
    version: "v2.1.0",
    image: strategyImage,
  },
  "executive-slate": {
    category: "FUNCTIONAL",
    kind: "metrics",
    eyebrow: "임원 브리프",
    title: "데이터로 결정하는 다음 우선순위",
    subtitle: "핵심 지표와 결론을 한 화면에 정리합니다.",
    role: "--color-neutral-dark",
    version: "v1.4.2",
  },
  "modern-violet": {
    category: "CREATIVE",
    kind: "timeline",
    eyebrow: "제품 스토리",
    title: "아이디어를 제품으로",
    subtitle: "발견부터 확장까지 실행의 흐름을 보여줍니다.",
    role: "--color-secondary-main",
    version: "v1.8.0",
  },
  "resort-blue": {
    category: "ATMOSPHERE",
    kind: "quote",
    eyebrow: "현장 인사이트 / 04",
    title: "더 가벼운 다음 단계",
    subtitle: "고객의 목소리를 중심에 둔 스토리 슬라이드입니다.",
    role: "--color-sky-accent",
    version: "v1.2.6",
  },
  "calm-green": {
    category: "IMPACT",
    kind: "comparison",
    eyebrow: "임팩트 리포트",
    title: "작은 변화가 만드는 실제 성과",
    subtitle: "전후의 차이와 다음 행동을 나란히 비교합니다.",
    role: "--color-success-main",
    version: "v2.0.1",
  },
  "energetic-coral": {
    category: "LAUNCH",
    kind: "roadmap",
    eyebrow: "런치 플랜",
    title: "출시의 순간을 설계하다",
    subtitle: "출시 단계와 팀의 역할을 빠르게 공유합니다.",
    role: "--color-coral-accent",
    version: "v0.9.8",
  },
  "warm-amber": {
    category: "EDITORIAL",
    kind: "chart",
    eyebrow: "인사이트 / 2026",
    title: "성장의 신호가 보입니다",
    subtitle: "숫자의 흐름을 따뜻한 시선으로 해석합니다.",
    role: "--color-amber-main",
    version: "v1.6.3",
  },
  "editorial-rose": {
    category: "BRAND",
    kind: "agenda",
    eyebrow: "브랜드 시스템",
    title: "이야기가 느껴지게",
    subtitle: "콘텐츠의 순서와 감정을 하나의 리듬으로 묶습니다.",
    role: "--color-brand-rose",
    version: "v2.3.1",
  },
  "graphite-night": {
    category: "EXPERIMENTAL",
    kind: "matrix",
    eyebrow: "AI / 시스템",
    title: "복잡함 너머를 보다",
    subtitle: "복잡한 기술 이야기를 구조와 대비로 단순화합니다.",
    role: "--color-accent-ai",
    version: "v0.9.5-beta",
    image: roadmapImage,
  },
};

export const initialAiPptWizardState: AiPptWizardState = {
  topic: "",
  content: "",
  audience: "",
  tone: "professional",
  referencePolicy: "user-input-only",
  mediaPolicy: "minimal",
};

export function mergeAiPptContentFormData(
  state: AiPptWizardState,
  formData: Pick<FormData, "get">,
) {
  const nextState = { ...state };
  for (const fieldName of ["topic", "content", "audience"] as const) {
    const value = formData.get(fieldName);
    if (typeof value === "string") nextState[fieldName] = value;
  }
  return nextState;
}

export function getAiPptWizardValidationMessage(
  state: AiPptWizardState,
  referenceFiles: File[] = [],
) {
  if (!state.topic.trim()) return "발표 주제를 입력하세요.";
  if (!state.content.trim()) return "발표 내용을 입력하세요.";
  if (!state.audience.trim()) return "청중을 입력하세요.";
  if (state.referencePolicy === "references-only" && referenceFiles.length === 0) {
    return "참고자료만으로 구성하려면 파일을 1개 이상 첨부하세요.";
  }
  if (state.referencePolicy === "references-first" && referenceFiles.length === 0) {
    return "참고자료 우선 구성에는 파일을 1개 이상 첨부하세요.";
  }
  return "";
}

export function buildAiPptGenerateDeckPayload(
  state: AiPptWizardState,
  paletteOption: PaletteOption,
  referenceFileIds: string[] = [],
  selectedFont = recommendGenerateDeckFonts(defaultFontMood)[0],
): GenerateDeckRequest {
  const timing = inferAiPptTimingFromContent(state.content);
  return {
    topic: state.topic.trim(),
    prompt: state.content.trim(),
    designPrompt: [
      `tone=${state.tone}`,
      `palette=${paletteOption.optionId}`,
      `font=${selectedFont.name}`,
      `mediaPolicy=${state.mediaPolicy}`,
      `base=${stylePackId}`,
    ].join("; "),
    brief: {
      audienceText: state.audience.trim(),
      durationMinutes: timing.targetDurationMinutes,
      referencePolicy: state.referencePolicy,
    },
    targetDurationMinutes: timing.targetDurationMinutes,
    slideCountRange: timing.slideCountRange,
    template: "default",
    metadata: {
      audience: "general",
      purpose: "inform",
      tone: state.tone,
    },
    design: {
      stylePackId,
      visualRhythm: "clean",
      densityTarget: "medium",
      mediaPolicy: state.mediaPolicy,
      layoutDiversity: "varied",
      paletteOverride: paletteOption.palette,
      fontOverride: fontOverrideFromOption(selectedFont),
      referencePolicy: state.referencePolicy,
    },
    visualPlanPolicy: { mediaPolicy: state.mediaPolicy },
    referencePolicy: state.referencePolicy,
    referenceFileIds,
    references: referenceFileIds.map((fileId) => ({ fileId })),
    referenceKeywords: [],
    referenceContext: [],
    coachingContext: {
      briefRef: { mode: "generic" },
      evaluatorLensRef: { lensId: "general-novice", revision: 1 },
    },
  };
}

export function inferAiPptTimingFromContent(content: string): Pick<
  GenerateDeckRequest,
  "targetDurationMinutes" | "slideCountRange"
> {
  const durationMatch = content.match(/(?:발표\s*시간(?:은|이)?\s*)?(\d{1,3})\s*분(?:짜리|간)?/u);
  const slideMatch = content.match(
    /(\d{1,2})\s*(?:[-~～–]\s*(\d{1,2}))?\s*(?:장|페이지|슬라이드)/u,
  );
  const duration = durationMatch ? Number(durationMatch[1]) : 10;
  const firstSlideCount = slideMatch ? Number(slideMatch[1]) : 5;
  const secondSlideCount = slideMatch?.[2] ? Number(slideMatch[2]) : undefined;
  const validDuration = Number.isInteger(duration) && duration >= 1 && duration <= 120
    ? duration
    : 10;
  const validSlideCounts = [firstSlideCount, secondSlideCount]
    .filter(
      (value): value is number =>
        typeof value === "number" && Number.isInteger(value),
    )
    .filter((value) => value >= 1 && value <= 20);
  if (slideMatch && validSlideCounts.length > 0) {
    return {
      targetDurationMinutes: validDuration,
      slideCountRange: {
        min: Math.min(...validSlideCounts),
        max: Math.max(...validSlideCounts),
      },
    };
  }
  return {
    targetDurationMinutes: validDuration,
    slideCountRange: { min: 5, max: 8 },
  };
}

export function AiPptMockupPage() {
  const [form, setForm] = useState(initialAiPptWizardState);
  const [referenceFiles, setReferenceFiles] = useState<File[]>([]);
  const [uploadStates, setUploadStates] = useState<Record<string, UploadState>>({});
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const contentFormRef = useRef<HTMLFormElement>(null);
  const projectPromiseRef = useRef<ReturnType<typeof createProjectWithoutDeck> | null>(null);
  const projectIdRef = useRef<string | null>(null);
  const referenceFilesRef = useRef<File[]>([]);
  const generationStartedRef = useRef(false);
  const showStyleLoadingPreview =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("preview") ===
      "style-loading";

  useEffect(() => {
    return () => {
      const projectId = projectIdRef.current;
      if (projectId && !generationStartedRef.current) {
        void deleteProject(projectId).catch(() => undefined);
      }
    };
  }, []);

  async function ensureProject() {
    if (!projectPromiseRef.current) {
      const projectPromise = createProjectWithoutDeck(
        getProjectTitle(form.topic),
      ).then((project) => {
        projectIdRef.current = project.projectId;
        return project;
      });
      projectPromiseRef.current = projectPromise;
      void projectPromise.catch(() => {
        if (projectPromiseRef.current === projectPromise) {
          projectPromiseRef.current = null;
          projectIdRef.current = null;
        }
      });
    }
    return projectPromiseRef.current;
  }

  async function cleanupTemporaryProjectIfUnused(projectId = projectIdRef.current) {
    if (
      !projectId ||
      projectIdRef.current !== projectId ||
      generationStartedRef.current ||
      referenceFilesRef.current.length > 0
    ) {
      return;
    }
    projectIdRef.current = null;
    projectPromiseRef.current = null;
    await deleteProject(projectId).catch(() => undefined);
  }

  async function uploadReference(file: File) {
    const key = referenceFileKey(file);
    setUploadStates((current) => ({ ...current, [key]: { status: "uploading" } }));
    try {
      const project = await ensureProject();
      const uploaded = await uploadProjectAsset(project.projectId, file, "reference-material");
      if (!referenceFilesRef.current.some((candidate) => referenceFileKey(candidate) === key)) {
        await deleteUploadedAsset(project.projectId, uploaded.fileId).catch(() => undefined);
        await cleanupTemporaryProjectIfUnused(project.projectId);
        return;
      }
      setUploadStates((current) => ({
        ...current,
        [key]: { status: "uploaded", fileId: uploaded.fileId },
      }));
    } catch (cause) {
      if (!referenceFilesRef.current.some((candidate) => referenceFileKey(candidate) === key)) {
        await cleanupTemporaryProjectIfUnused();
        return;
      }
      setUploadStates((current) => ({
        ...current,
        [key]: {
          status: "failed",
          error: cause instanceof Error ? cause.message : "업로드하지 못했습니다.",
        },
      }));
    }
  }

  function changeReferenceFiles(nextFiles: File[]) {
    const previous = referenceFilesRef.current;
    referenceFilesRef.current = nextFiles;
    setReferenceFiles(nextFiles);
    const nextKeys = new Set(nextFiles.map(referenceFileKey));
    const removedFiles = previous.filter(
      (file) => !nextKeys.has(referenceFileKey(file)),
    );
    for (const removed of removedFiles) {
      const key = referenceFileKey(removed);
      const state = uploadStates[key];
      if (projectIdRef.current && state?.fileId) {
        const projectId = projectIdRef.current;
        void deleteUploadedAsset(projectId, state.fileId)
          .catch(() => undefined)
          .then(() => cleanupTemporaryProjectIfUnused(projectId));
      }
      setUploadStates((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    const cleanupContinuesAfterUpload = removedFiles.some((file) => {
      const state = uploadStates[referenceFileKey(file)];
      return state?.status === "uploading" || Boolean(state?.fileId);
    });
    if (nextFiles.length === 0 && !cleanupContinuesAfterUpload) {
      void cleanupTemporaryProjectIfUnused();
    }
    const previousKeys = new Set(previous.map(referenceFileKey));
    for (const added of nextFiles.filter((file) => !previousKeys.has(referenceFileKey(file)))) {
      void uploadReference(added);
    }
  }

  function updateForm<K extends keyof AiPptWizardState>(
    key: K,
    value: AiPptWizardState[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitGeneration() {
    const nextForm = contentFormRef.current
      ? mergeAiPptContentFormData(form, new FormData(contentFormRef.current))
      : form;
    setForm(nextForm);
    const validationMessage = getAiPptWizardValidationMessage(
      nextForm,
      referenceFiles,
    );
    if (validationMessage) {
      setError(validationMessage);
      return;
    }

    setIsGenerating(true);
    setError("");
    setStatus("프로젝트 생성 중...");
    let createdProjectId: string | null = null;
    let generationStarted = false;

    try {
      const project = await ensureProject();
      createdProjectId = project.projectId;
      await updateProjectTitle(project.projectId, getProjectTitle(nextForm.topic));
      const referenceFileIds = referenceFiles.map(
        (file) => uploadStates[referenceFileKey(file)]?.fileId,
      );
      if (referenceFileIds.some((fileId) => !fileId)) {
        throw new Error("첨부파일 업로드가 완료된 후 계속할 수 있습니다.");
      }

      setStatus("발표 구성 생성 중...");
      const response = await fetch(
        `/api/v1/projects/${encodeURIComponent(project.projectId)}/jobs/generate-deck`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          credentials: "include",
          body: JSON.stringify(
            buildAiPptGenerateDeckPayload(
              nextForm,
              defaultPaletteOptions[0],
              referenceFileIds as string[],
            ),
          ),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readResponseText(
            response,
            "AI PPT 생성을 시작하지 못했습니다.",
          ),
        );
      }

      const data = (await response.json()) as { job: Job };
      generationStarted = true;
      generationStartedRef.current = true;
      navigateToPath(styleColorPath(project.projectId, data.job.jobId));
    } catch (submitError) {
      if (createdProjectId && !generationStarted) {
        await deleteProject(createdProjectId).catch(() => undefined);
        projectIdRef.current = null;
        projectPromiseRef.current = null;
      }
      setError(
        submitError instanceof Error
          ? submitError.message
          : "AI PPT 생성에 실패했습니다.",
      );
      setStatus("");
    } finally {
      setIsGenerating(false);
    }
  }

  if (isGenerating || showStyleLoadingPreview) {
    return <AiPptStyleStartingPage />;
  }

  return (
    <WorkspaceContainer as="section" className="ai-ppt-page" width="content">
      <div className="ai-ppt-layout">
        <WizardSteps activeIndex={0} />

        <main className="ai-ppt-workspace ai-ppt-workspace-single">
          <section className="ai-ppt-panel">
            <ContentStep
              files={referenceFiles}
              form={form}
              formRef={contentFormRef}
              onChange={updateForm}
              onFilesChange={changeReferenceFiles}
              onRetryUpload={(file) => void uploadReference(file)}
              uploadStates={uploadStates}
              nextAction={
                <GradientButton
                  className="ai-ppt-next-action"
                  disabled={
                    isGenerating ||
                    Object.values(uploadStates).some(
                      (item) => item.status !== "uploaded",
                    )
                  }
                  type="button"
                  onClick={() => void submitGeneration()}
                >
                  {referenceFiles.some(
                    (file) =>
                      uploadStates[referenceFileKey(file)]?.status !== "uploaded",
                  ) ? (
                    <>
                      <IconUpload size={17} /> 업로드 완료 후 계속
                    </>
                  ) : (
                    <>
                      다음 단계 <IconArrowRight size={18} />
                    </>
                  )}
                </GradientButton>
              }
            />
            {error ? (
              <p className="ai-ppt-error" role="alert">
                {error}
              </p>
            ) : null}
            {status ? (
              <p className="ai-ppt-status" role="status">
                {status}
              </p>
            ) : null}
          </section>
        </main>
      </div>
    </WorkspaceContainer>
  );
}

function AiPptStyleStartingPage() {
  return (
    <WorkspaceContainer as="section" className="ai-ppt-page" width="content">
      <div className="ai-ppt-layout">
        <WizardSteps activeIndex={1} />
        <main className="ai-ppt-workspace ai-ppt-loading-workspace">
          <section className="ai-ppt-panel ai-ppt-loading-panel" aria-busy="true">
            <p className="ai-ppt-status" role="status">
              프로젝트를 확정하고 발표 구성을 백그라운드에서 시작하는 중입니다.
            </p>
            <IconLoader2
              aria-hidden="true"
              className="ai-ppt-style-loader"
              size={48}
            />
          </section>
        </main>
      </div>
    </WorkspaceContainer>
  );
}

export function AiPptStyleColorPage(props: {
  jobId: string;
  projectId: string;
}) {
  const [designState, setDesignState] = useState<AiDeckDesignSelectionResponse | null>(null);
  const [selectedPaletteId, setSelectedPaletteId] = useState(
    defaultPaletteOptions[0].optionId,
  );
  const [selectedFontId, setSelectedFontId] = useState(
    recommendGenerateDeckFonts(defaultFontMood)[0].fontId,
  );
  const [customPalette, setCustomPalette] = useState<PaletteOption | null>(
    null,
  );
  const [palettePrompt, setPalettePrompt] = useState("");
  const [isAiPaletteOpen, setIsAiPaletteOpen] = useState(false);
  const [isCustomizingPalette, setIsCustomizingPalette] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [status, setStatus] = useState("스타일 정보를 불러오는 중...");
  const [error, setError] = useState("");
  const paletteOptions = useMemo(
    () =>
      customPalette
        ? [...defaultPaletteOptions, customPalette]
        : defaultPaletteOptions,
    [customPalette],
  );
  const selectedPalette =
    paletteOptions.find((option) => option.optionId === selectedPaletteId) ??
    defaultPaletteOptions[0];
  const fontOptions = useMemo(
    () =>
      recommendGenerateDeckFonts(
        `${designState?.styleContext.topic ?? ""} ${designState?.styleContext.tone ?? "professional"} ${defaultFontMood}`,
      ),
    [designState?.styleContext.tone, designState?.styleContext.topic],
  );
  const selectedFont =
    fontOptions.find((font) => font.fontId === selectedFontId) ??
    fontOptions[0];

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const next = await requestDesignSelection(props.projectId, props.jobId);
        if (cancelled) return;
        setDesignState(next);
        if (next.selection) {
          navigateToPath(generationPath(next.projectId, next.jobId));
          return;
        }
        setStatus("");
      } catch (cause) {
        if (!cancelled) {
          setError(
            cause instanceof Error
              ? cause.message
              : "스타일 정보를 불러오지 못했습니다.",
          );
          setStatus("");
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [props.jobId, props.projectId]);

  async function customizePalette() {
    const instruction = palettePrompt.trim();
    const styleContext = designState?.styleContext;
    if (!instruction || !styleContext) {
      setError("원하는 색감이나 변경할 요소를 입력하세요.");
      return;
    }
    setIsCustomizingPalette(true);
    setError("");
    try {
      const response = await fetchDeckColorCustomization({
        topic: styleContext.topic,
        instruction,
        basePalette: selectedPalette.palette,
        stylePackId,
        tone: styleContext.tone,
      });
      const option = { ...response.option, optionId: "ai-custom" };
      setCustomPalette(option);
      setSelectedPaletteId(option.optionId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "AI 팔레트를 만들지 못했습니다. 현재 선택은 유지됩니다.",
      );
    } finally {
      setIsCustomizingPalette(false);
    }
  }

  async function approveAndGenerate() {
    if (!designState || !selectedFont) {
      setError("스타일을 적용할 발표 정보를 불러오지 못했습니다.");
      return;
    }
    setIsGenerating(true);
    setError("");
    setStatus("선택한 스타일을 적용하는 중...");
    try {
      const next = await saveDesignSelection(
        props.projectId,
        props.jobId,
        {
          paletteOptionId: selectedPalette.optionId,
          paletteOverride: selectedPalette.palette,
          fontOverride: fontOverrideFromOption(selectedFont),
          ...(palettePrompt.trim() ? { designPrompt: palettePrompt.trim() } : {}),
        },
      );
      setDesignState(next);
      navigateToPath(generationPath(next.projectId, next.jobId));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "AI PPT 생성에 실패했습니다.",
      );
      setStatus("");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <WorkspaceContainer as="section" className="ai-ppt-page" width="content">
      <div className="ai-ppt-layout">
        <WizardSteps activeIndex={1} />
        <main className="ai-ppt-workspace ai-ppt-workspace-single ai-ppt-context-panel">
          <section className="ai-ppt-panel">
            <StyleColorStep
              isAiPaletteOpen={isAiPaletteOpen}
              customPalette={customPalette}
              fontOptions={fontOptions}
              isCustomizing={isCustomizingPalette}
              onCustomize={() => void customizePalette()}
              onOpenAiPalette={() => setIsAiPaletteOpen((isOpen) => !isOpen)}
              onFontSelect={setSelectedFontId}
              onPalettePromptChange={setPalettePrompt}
              onSelectPalette={setSelectedPaletteId}
              palettePrompt={palettePrompt}
              selectedFontId={selectedFont?.fontId ?? ""}
              selectedPaletteId={selectedPalette.optionId}
            />
            {error ? (
              <p className="ai-ppt-error" role="alert">
                {error}
              </p>
            ) : null}
            {status ? (
              <p className="ai-ppt-status" role="status">
                {status}
              </p>
            ) : null}
          </section>
        </main>
      </div>
      <footer className="ai-ppt-footer">
        <OrbitButton
          disabled={isGenerating}
          icon={<IconChevronLeft size={17} />}
          type="button"
          onClick={() =>
            navigateToPath("/createdeck")
          }
          variant="secondary"
        >
          이전
        </OrbitButton>
        <GradientButton
          disabled={
            isGenerating || isCustomizingPalette || !designState?.styleContext
          }
          type="button"
          onClick={() => void approveAndGenerate()}
        >
          <IconPlayerPlay size={17} />
          {isGenerating ? "생성 중" : "슬라이드 생성"}
        </GradientButton>
      </footer>
    </WorkspaceContainer>
  );
}

function WizardSteps({ activeIndex }: { activeIndex: number }) {
  return (
    <aside className="ai-ppt-steps" aria-label="AI PPT 생성 단계">
      {flowSteps.map((step, index) => (
        <div
          aria-current={index === activeIndex ? "step" : undefined}
          className={[
            "ai-ppt-step",
            index === activeIndex ? "active" : "",
            index < activeIndex ? "done" : "",
          ].join(" ")}
          key={step.label}
        >
          <span className="ai-ppt-step-marker">
            {index < activeIndex ? <IconCheck size={18} /> : `0${index + 1}`}
          </span>
          <span className="ai-ppt-step-copy">
            <strong>{step.label}</strong>
          </span>
        </div>
      ))}
    </aside>
  );
}

function ContentStep(props: {
  files: File[];
  form: AiPptWizardState;
  formRef: Ref<HTMLFormElement>;
  onChange: <K extends keyof AiPptWizardState>(
    key: K,
    value: AiPptWizardState[K],
  ) => void;
  onFilesChange: (files: File[]) => void;
  onRetryUpload: (file: File) => void;
  uploadStates: Record<string, UploadState>;
  nextAction: ReactNode;
}) {
  return (
    <div className="ai-ppt-content-layout">
      <section className="ai-ppt-context-panel" aria-label="발표 자료 내용 입력">
        <form
          ref={props.formRef}
          aria-label="발표 내용 입력"
          className="ai-ppt-field-grid"
          onSubmit={(event) => event.preventDefault()}
        >
          <TextField
            name="topic"
            label={
              <OrbitIconLabel
                icon={<IconPresentationAnalytics size={17} />}
              >
                발표 주제
              </OrbitIconLabel>
            }
            placeholder="예: 2026년 하반기 제품 전략"
            value={props.form.topic}
            onChange={(value) => props.onChange("topic", value)}
          />
          <TextField
            name="audience"
            label={
              <OrbitIconLabel icon={<IconUsers size={17} />}>
                타깃 청중
              </OrbitIconLabel>
            }
            placeholder="예: 제품·개발 리드와 경영진"
            value={props.form.audience}
            onChange={(value) => props.onChange("audience", value)}
          />
          <TextAreaField
            name="content"
            label={
              <OrbitIconLabel icon={<IconListDetails size={17} />}>
                상세 내용 및 컨텍스트
              </OrbitIconLabel>
            }
            placeholder="발표에 포함되어야 할 핵심 데이터, 논점과 구체적인 배경을 입력하세요."
            value={props.form.content}
            onChange={(value) => props.onChange("content", value)}
          />
        </form>
        <div className="ai-ppt-policy-select-grid">
          <PolicySelect
            icon={<IconFileDescription />}
            label="내용 구성"
            options={referencePolicyOptions}
            value={props.form.referencePolicy}
            onChange={(value) => props.onChange("referencePolicy", value)}
          />
          <PolicySelect
            icon={<IconPhoto size={17} />}
            label="이미지 구성"
            options={mediaPolicyOptions}
            value={props.form.mediaPolicy}
            onChange={(value) => props.onChange("mediaPolicy", value)}
          />
        </div>
        <AttachmentField
          files={props.files}
          onFilesChange={props.onFilesChange}
          onRetryUpload={props.onRetryUpload}
          uploadStates={props.uploadStates}
        />
        <fieldset className="ai-ppt-tone-field">
          <legend>
            <OrbitIconLabel icon={<IconMessageCircle />}>
              대본 톤
            </OrbitIconLabel>
          </legend>
          <div className="ai-ppt-tone-cards">
            {toneOptions.map((tone) => {
              const selected = props.form.tone === tone.value;
              const ToneIcon =
                tone.value === "professional"
                  ? IconBriefcase2
                  : tone.value === "confident"
                    ? IconBolt
                    : IconMessageCircleHeart;
              return (
                <button
                  aria-pressed={selected}
                  className={selected ? "selected" : ""}
                  key={tone.value}
                  onClick={() => props.onChange("tone", tone.value)}
                  type="button"
                >
                  <span className="ai-ppt-tone-icon" aria-hidden="true">
                    <ToneIcon size={24} stroke={1.7} />
                  </span>
                  <span className="ai-ppt-tone-card-copy">
                    <strong>{tone.label}</strong>
                    <small>{tone.description}</small>
                  </span>
                  {selected ? (
                    <span aria-hidden="true" className="ai-ppt-tone-check">
                      <IconCheck size={16} />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="ai-ppt-content-action">{props.nextAction}</div>
      </section>
    </div>
  );
}

function PolicySelect<T extends string>(props: {
  icon: ReactNode;
  label: string;
  onChange: (value: T) => void;
  options: readonly PolicyChoiceOption<T>[];
  value: T;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedOption = props.options.find(
    (option) => option.value === props.value,
  );

  useEffect(() => {
    if (!isOpen) return;

    function closeOnPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="ai-ppt-policy-select" ref={menuRef}>
      <OrbitIconLabel id={`${menuId}-label`} icon={props.icon}>
        {props.label}
      </OrbitIconLabel>
      <OrbitButton
        aria-describedby={`${menuId}-description`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-labelledby={`${menuId}-label ${menuId}-value`}
        className="ai-ppt-policy-trigger"
        id={`${menuId}-value`}
        onClick={() => setIsOpen((current) => !current)}
        title={selectedOption?.description}
        type="button"
        variant="quiet"
      >
        <span>{selectedOption?.label}</span>
        <IconChevronDown aria-hidden="true" size={16} />
      </OrbitButton>
      <small className="ai-ppt-policy-description" id={`${menuId}-description`}>
        {selectedOption?.description}
      </small>
      {isOpen ? (
        <DropdownMenu
          align="start"
          aria-label={`${props.label} 선택`}
          className="ai-ppt-policy-dropdown"
          variant="white"
        >
          {props.options.map((option) => (
            <DropdownMenuItem
              aria-checked={option.value === props.value}
              icon={
                option.value === props.value ? (
                  <IconCheck aria-hidden="true" size={16} />
                ) : (
                  <span className="ai-ppt-policy-icon-spacer" />
                )
              }
              key={option.value}
              onClick={() => {
                props.onChange(option.value);
                setIsOpen(false);
              }}
              role="menuitemradio"
              title={option.description}
            >
              {option.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function StyleColorStep(props: {
  isAiPaletteOpen: boolean;
  customPalette: PaletteOption | null;
  fontOptions: GenerateDeckFontOption[];
  isCustomizing: boolean;
  onCustomize: () => void;
  onOpenAiPalette: () => void;
  onFontSelect: (fontId: string) => void;
  onPalettePromptChange: (value: string) => void;
  onSelectPalette: (optionId: string) => void;
  palettePrompt: string;
  selectedFontId: string;
  selectedPaletteId: string;
}) {
  return (
    <>
      <fieldset className="ai-ppt-style-fieldset">
        <legend>폰트</legend>
        <div className="ai-ppt-font-grid" role="list">
          {props.fontOptions.map((font) => (
            <button
              aria-pressed={props.selectedFontId === font.fontId}
              key={font.fontId}
              className={props.selectedFontId === font.fontId ? "selected" : ""}
              type="button"
              onClick={() => props.onFontSelect(font.fontId)}
            >
              <span className="ai-ppt-font-card-topline">
                <span className="ai-ppt-font-check" aria-hidden="true">
                  {props.selectedFontId === font.fontId ? <IconCheck size={14} /> : null}
                </span>
              </span>
              <span
                aria-hidden="true"
                className="ai-ppt-font-glyph"
                style={{ fontFamily: font.headingFontFamily }}
              >
                Aa
              </span>
              <strong style={{ fontFamily: font.headingFontFamily }}>
                {font.name}
              </strong>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="ai-ppt-style-fieldset">
        <legend>컬러 팔레트</legend>
        <div className="ai-ppt-palette-grid ai-ppt-palette-grid-expanded" role="list">
          {defaultPaletteOptions.map((option) => (
            <PaletteButton
              key={option.optionId}
              option={option}
              selected={props.selectedPaletteId === option.optionId}
              onSelect={props.onSelectPalette}
            />
          ))}
        </div>
        <div className="ai-ppt-ai-palette-flow">
          <button
            aria-controls="ai-ppt-ai-palette-panel"
            aria-expanded={props.isAiPaletteOpen}
            className="workspace-home-create ai-ppt-ai-palette-create"
            type="button"
            onClick={props.onOpenAiPalette}
          >
            <span aria-hidden="true" className="workspace-home-create-icon">
              <IconPlus size={22} stroke={1.8} />
            </span>
            <strong>AI로 컬러 팔레트 만들기</strong>
            <small>
              선택한 팔레트를 수정하거나
              <br />
              새로운 컬러를 추천 받으세요.
            </small>
          </button>
          {props.isAiPaletteOpen ? (
            <section
              aria-live="polite"
              className={[
                "ai-ppt-ai-palette-panel",
                props.customPalette ? "has-result" : "",
                props.selectedPaletteId === "ai-custom" ? "selected" : "",
              ].join(" ")}
              id="ai-ppt-ai-palette-panel"
            >
              {props.customPalette ? (
                <button
                  aria-pressed={props.selectedPaletteId === "ai-custom"}
                  className="ai-ppt-ai-palette-result"
                  type="button"
                  onClick={() => props.onSelectPalette("ai-custom")}
                >
                  <span className="ai-ppt-ai-palette-result-topline">
                    <PaletteSwatches palette={props.customPalette.palette} />
                    <span className="ai-ppt-palette-selected-mark" aria-hidden="true">
                      {props.selectedPaletteId === "ai-custom" ? (
                        <IconCheck size={14} />
                      ) : null}
                    </span>
                  </span>
                  <strong>{props.customPalette.name}</strong>
                  <span>{props.customPalette.rationale}</span>
                </button>
              ) : (
                <div className="ai-ppt-ai-palette-heading">
                  <IconSparkles size={18} />
                  <strong>AI 팔레트</strong>
                </div>
              )}
              <textarea
                aria-label="AI 팔레트 요청"
                placeholder="예: 배경은 유지하고 포인트 컬러만 더 따뜻하게"
                value={props.palettePrompt}
                onChange={(event) =>
                  props.onPalettePromptChange(event.target.value)
                }
              />
              <OrbitButton
                className="ai-ppt-ai-palette-action"
                loading={props.isCustomizing}
                type="button"
                onClick={props.onCustomize}
              >
                {props.customPalette ? "다시 생성하기" : "AI로 생성하기"}
              </OrbitButton>
            </section>
          ) : null}
        </div>
      </fieldset>
    </>
  );
}

function PaletteButton(props: {
  option: PaletteOption;
  selected: boolean;
  onSelect: (optionId: string) => void;
}) {
  return (
    <button
      aria-label={`${props.option.name} ${props.selected ? "선택됨" : "선택"}`}
      aria-pressed={props.selected}
      className={props.selected ? "selected" : ""}
      type="button"
      onClick={() => props.onSelect(props.option.optionId)}
    >
      <PaletteSwatches palette={props.option.palette} />
      <PaletteMockupSlide option={props.option} />
      <span className="ai-ppt-palette-card-meta">
        <span className="ai-ppt-palette-card-heading">
          <strong>{props.option.name}</strong>
          <span className="ai-ppt-palette-selected-mark" aria-hidden="true">
            {props.selected ? <IconCheck size={14} /> : null}
          </span>
        </span>
        <small>{props.option.rationale}</small>
      </span>
    </button>
  );
}

function PaletteMockupSlide(props: { option: PaletteOption; large?: boolean }) {
  const { option } = props;
  const preset = paletteMockupPresets[option.optionId] ?? {
    category: "CUSTOM",
    kind: "cover" as const,
    eyebrow: "사용자 정의 스타일",
    title: "다음 이야기를 시작하세요",
    subtitle: "선택한 색상으로 만든 사용자 정의 슬라이드입니다.",
    role: "--color-custom",
    version: "v1.0.0",
  };
  const colors = [
    option.palette.primary,
    option.palette.secondary,
    option.palette.accentColor,
  ];
  const mockupClass = [
    "ai-ppt-palette-mockup",
    `ai-ppt-palette-mockup-${preset.kind}`,
    props.large ? "ai-ppt-palette-mockup-large" : "",
  ].join(" ");

  return (
    <span
      aria-hidden="true"
      className={mockupClass}
      style={{
        background: option.palette.background,
        borderColor: option.palette.border,
        color: option.palette.text,
      }}
    >
      <span className="ai-ppt-palette-mockup-content">
        <strong style={{ color: option.palette.primary }}>{preset.title}</strong>
        <span>{preset.subtitle}</span>
        {preset.image ? (
          <span className="ai-ppt-mockup-image">
            <img alt="" src={preset.image} />
          </span>
        ) : null}
        <PaletteMockupBody kind={preset.kind} colors={colors} palette={option.palette} />
      </span>
    </span>
  );
}

function PaletteMockupBody(props: {
  colors: string[];
  kind: PaletteSlideKind;
  palette: Required<PaletteOverride>;
}) {
  const [primary, secondary, accent] = props.colors;
  const surfaceStyle = { background: props.palette.surface, borderColor: props.palette.border };
  if (props.kind === "metrics") {
    return (
      <span className="ai-ppt-mockup-metrics">
        {["+42%", "8.4k", "92.6"].map((value, index) => (
          <span key={value} style={surfaceStyle}>
            <strong style={{ color: props.colors[index] }}>{value}</strong>
            <span>{["재방문율", "활성 사용자", "확신도"][index]}</span>
          </span>
        ))}
      </span>
    );
  }
  if (props.kind === "timeline" || props.kind === "roadmap") {
    return (
      <span className="ai-ppt-mockup-steps">
        {["발견", "정의", "실행", "확장"].map((label, index) => (
          <span key={label}>
            <i style={{ background: props.colors[index % props.colors.length] }} />
            <strong>{label}</strong>
            <span>{String(index + 1).padStart(2, "0")}</span>
          </span>
        ))}
      </span>
    );
  }
  if (props.kind === "quote") {
    return (
      <span className="ai-ppt-mockup-quote" style={surfaceStyle}>
        <strong style={{ color: accent }}>“</strong>
        <span>좋은 디자인은 더 많이 보여주는 일이 아니라, 중요한 것을 남기는 일입니다.</span>
        <small>— ORBIT design team</small>
      </span>
    );
  }
  if (props.kind === "comparison") {
    return (
      <span className="ai-ppt-mockup-comparison">
        <span style={{ background: props.palette.muted, borderColor: props.palette.border }}>
          <strong>이전</strong><i style={{ background: secondary }} /><i style={{ background: props.palette.border }} />
        </span>
        <span style={{ background: props.palette.surface, borderColor: props.palette.border }}>
          <strong style={{ color: primary }}>지금</strong><i style={{ background: primary }} /><i style={{ background: accent }} />
        </span>
      </span>
    );
  }
  if (props.kind === "chart") {
    return (
      <span className="ai-ppt-mockup-chart" style={surfaceStyle}>
        {[44, 62, 52, 84, 72, 96].map((height, index) => (
          <i key={height} style={{ background: props.colors[index % props.colors.length], height: `${height}%` }} />
        ))}
      </span>
    );
  }
  if (props.kind === "agenda") {
    return (
      <span className="ai-ppt-mockup-agenda">
        {["배경", "변화", "다음 액션"].map((label, index) => (
          <span key={label} style={{ borderColor: props.palette.border }}>
            <strong style={{ color: props.colors[index] }}>{`0${index + 1}`}</strong><span>{label}</span><i style={{ background: props.colors[index] }} />
          </span>
        ))}
      </span>
    );
  }
  if (props.kind === "matrix") {
    return (
      <span className="ai-ppt-mockup-matrix">
        {[
          ["신호", primary],
          ["확장", accent],
          ["리스크", secondary],
          ["집중", props.palette.text],
        ].map(([label, color]) => (
          <span key={label} style={{ background: props.palette.surface, borderColor: props.palette.border }}>
            <i style={{ background: color }} /><strong>{label}</strong>
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className="ai-ppt-mockup-cover-art" style={{ background: props.palette.muted, borderColor: props.palette.border }}>
      <i style={{ background: primary }} />
      <i style={{ background: secondary }} />
      <i style={{ background: accent }} />
      <span>제품 전략 · 2026</span>
    </span>
  );
}

function PaletteSwatches(props: { palette: Required<PaletteOverride> }) {
  return (
    <span className="ai-ppt-palette-swatches" aria-hidden="true">
      {[
        props.palette.primary,
        props.palette.secondary,
        props.palette.background,
        props.palette.accentColor,
      ].map((color, index) => (
        <i key={`${color}-${index}`} style={{ background: color }} />
      ))}
    </span>
  );
}

export function miniSlideFontStyles(
  font: Pick<
    GenerateDeckFontOption,
    "headingFontFamily" | "bodyFontFamily" | "fallbackFamily"
  >,
) {
  const stack = (family: string) =>
    `"${family.replaceAll('"', "")}", ${font.fallbackFamily}, sans-serif`;
  return {
    heading: { fontFamily: stack(font.headingFontFamily) },
    body: { fontFamily: stack(font.bodyFontFamily) },
  };
}

function AttachmentField(props: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  onRetryUpload: (file: File) => void;
  uploadStates: Record<string, UploadState>;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragPreviewNames, setDragPreviewNames] = useState<string[]>([]);
  const dragDepthRef = useRef(0);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  function addFiles(files: FileList | File[]) {
    props.onFilesChange(mergeReferenceFiles(props.files, Array.from(files)));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    setDragPreviewNames([]);
    addFiles(event.dataTransfer.files);
  }

  function handleDragEnter(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
    setDragPreviewNames(getDraggedFileNames(event.dataTransfer));
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current > 0) return;
    setIsDragging(false);
    setDragPreviewNames([]);
  }

  return (
    <section
      className="ai-ppt-attachments"
      aria-labelledby="ai-ppt-attachments-title"
    >
      <h3 id="ai-ppt-attachments-title">
        <OrbitIconLabel icon={<IconPaperclip size={18} />}>
          참고 자료
        </OrbitIconLabel>
      </h3>
      <div
        aria-label="참고 자료 파일 업로드"
        className={[
          "ai-ppt-reference-drop",
          isDragging ? "is-dragging" : "",
          props.files.length ? "has-files" : "",
        ].join(" ")}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDrop={handleDrop}
        role="group"
      >
        <span className="ai-ppt-drop-idle">
          <span className="ai-ppt-reference-icon" aria-hidden="true">
            <IconFileUpload size={22} />
          </span>
          <span className="ai-ppt-drop-copy">
            <strong>참고 자료를 여기에 놓으세요</strong>
            <span>PDF, PPTX, DOCX, JPG, PNG, WEBP</span>
          </span>
        </span>
        <OrbitButton
          className="ai-ppt-reference-select"
          icon={<IconUpload aria-hidden="true" size={16} />}
          onClick={() => attachmentInputRef.current?.click()}
          size="compact"
          variant="secondary"
        >
          파일 선택
        </OrbitButton>
        <span aria-hidden="true" className="ai-ppt-drop-preview">
          <span className="ai-ppt-drop-preview-icon">
            <IconFileUpload size={25} />
          </span>
          <strong>
            {dragPreviewNames.length
              ? `${dragPreviewNames.length}개 파일을 놓아 미리보기`
              : "여기에 놓아 미리보기"}
          </strong>
          {dragPreviewNames.length ? (
            <span className="ai-ppt-drop-preview-names">
              {dragPreviewNames.slice(0, 3).map((name) => (
                <span key={name}>{name}</span>
              ))}
              {dragPreviewNames.length > 3 ? (
                <span>+{dragPreviewNames.length - 3}</span>
              ) : null}
            </span>
          ) : null}
        </span>
        <input
          className="ai-ppt-reference-input"
          hidden
          ref={attachmentInputRef}
          type="file"
          multiple
          accept=".pdf,.pptx,.docx,.jpg,.jpeg,.png,.webp"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {props.files.length ? (
        <ul aria-label="첨부 파일 미리보기" className="ai-ppt-attachment-preview-grid">
          {props.files.map((file) => {
            const upload = props.uploadStates[referenceFileKey(file)];
            return (
              <li
                className="ai-ppt-attachment-preview-card"
                data-status={upload?.status ?? "uploading"}
                key={referenceFileKey(file)}
              >
                <ReferenceFilePreview file={file} />
                <OrbitIconButton
                  aria-label={`${file.name} 제거`}
                  className="ai-ppt-attachment-remove"
                  onClick={() =>
                    props.onFilesChange(
                      props.files.filter(
                        (candidate) =>
                          referenceFileKey(candidate) !== referenceFileKey(file),
                      ),
                    )
                  }
                  variant="surface"
                >
                  <IconTrash aria-hidden="true" size={16} />
                </OrbitIconButton>
                <div className="ai-ppt-attachment-preview-meta">
                  <strong title={file.name}>{file.name}</strong>
                  <span>
                    {referenceFileTypeLabel(file)} · {formatReferenceFileSize(file.size)}
                  </span>
                  <small className="ai-ppt-attachment-upload-status">
                    {upload?.status === "uploaded"
                      ? "업로드 완료"
                      : upload?.status === "failed"
                        ? upload.error ?? "업로드 실패"
                        : "업로드 중"}
                  </small>
                  {upload?.status === "failed" ? (
                    <OrbitButton
                      onClick={() => props.onRetryUpload(file)}
                      size="compact"
                      variant="quiet"
                    >
                      다시 시도
                    </OrbitButton>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function ReferenceFilePreview(props: { file: File }) {
  const [previewUrl, setPreviewUrl] = useState("");
  const isImage = isReferenceImage(props.file);

  useEffect(() => {
    if (!isImage) {
      setPreviewUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(props.file);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [isImage, props.file]);

  return (
    <div
      className="ai-ppt-attachment-preview-media"
      data-preview-kind={isImage ? "image" : "document"}
    >
      {previewUrl ? (
        <img alt={`${props.file.name} 미리보기`} src={previewUrl} />
      ) : (
        <span className="ai-ppt-document-cover" aria-hidden="true">
          {isImage ? <IconPhoto size={28} /> : <IconFileText size={28} />}
          <strong>{referenceFileExtension(props.file)}</strong>
        </span>
      )}
    </div>
  );
}

function getDraggedFileNames(dataTransfer: DataTransfer) {
  const files = Array.from(dataTransfer.files);
  if (files.length) return files.map((file) => file.name);
  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile()?.name)
    .filter((name): name is string => Boolean(name));
}

function isReferenceImage(file: Pick<File, "name" | "type">) {
  return file.type.startsWith("image/") || /\.(?:jpe?g|png|webp)$/i.test(file.name);
}

function referenceFileExtension(file: Pick<File, "name">) {
  return file.name.split(".").pop()?.toUpperCase() || "FILE";
}

function referenceFileTypeLabel(file: Pick<File, "name" | "type">) {
  return isReferenceImage(file) ? "이미지" : referenceFileExtension(file);
}

function formatReferenceFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function TextField(props: {
  label: ReactNode;
  name: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <OrbitField id={`ai-ppt-${props.name}`} label={props.label}>
      <OrbitInput
        name={props.name}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </OrbitField>
  );
}

function TextAreaField(props: {
  label: ReactNode;
  name: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <OrbitField
      className="ai-ppt-field-wide"
      id={`ai-ppt-${props.name}`}
      label={props.label}
    >
      <OrbitTextarea
        name={props.name}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </OrbitField>
  );
}

export async function fetchDeckColorCustomization(input: {
  topic: string;
  instruction: string;
  basePalette: Required<PaletteOverride>;
  stylePackId: string;
  tone: Tone;
}) {
  const response = await fetch("/api/v1/ai/deck-color-customization", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      await readResponseText(
        response,
        "AI 팔레트를 만들지 못했습니다. 현재 선택은 유지됩니다.",
      ),
    );
  }
  return (await response.json()) as DeckColorCustomizationResponse;
}

export async function pollJob(jobId: string, onUpdate?: (job: Job) => void) {
  for (;;) {
    const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`, {
      credentials: "include",
    });
    if (!response.ok) {
      throw new Error(await readResponseText(response, "Job 조회 실패"));
    }
    const job = (await response.json()) as Job;
    onUpdate?.(job);
    if (job.status === "succeeded" || job.status === "failed") return job;
    await new Promise((resolve) => window.setTimeout(resolve, 1_200));
  }
}

export function mergeReferenceFiles(
  currentFiles: File[],
  incomingFiles: File[],
) {
  const filesByKey = new Map(
    currentFiles.map((file) => [referenceFileKey(file), file]),
  );
  for (const file of incomingFiles)
    filesByKey.set(referenceFileKey(file), file);
  return [...filesByKey.values()];
}

function referenceFileKey(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function fontOverrideFromOption(option: GenerateDeckFontOption) {
  return {
    fontId: option.fontId,
    name: option.name,
    headingFontFamily: option.headingFontFamily,
    bodyFontFamily: option.bodyFontFamily,
    fallbackFamily: option.fallbackFamily,
    weights: option.weights,
    supportsKorean: option.supportsKorean,
    pptxEmbeddable: option.pptxEmbeddable,
    moodTags: option.moodTags,
    license: option.license,
    sourceUrl: option.sourceUrl,
    recommendedTitleSize: option.recommendedTitleSize,
    recommendedBodySize: option.recommendedBodySize,
    lineHeight: option.lineHeight,
    widthFactor: option.widthFactor,
    overflowRisk: option.overflowRisk,
  };
}

function getProjectTitle(topic: string) {
  return topic.trim().slice(0, 80) || "AI PPT";
}

function navigateToPath(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

async function updateProjectTitle(projectId: string, title: string) {
  const response = await fetch(
    `/api/v1/workspaces/${encodeURIComponent(demoIds.workspaceId)}/projects/${encodeURIComponent(projectId)}`,
    {
    method: "PATCH",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title }),
    },
  );
  if (!response.ok) {
    throw new Error(await readResponseText(response, "프로젝트 제목을 저장하지 못했습니다."));
  }
}

async function deleteUploadedAsset(projectId: string, fileId: string) {
  const response = await fetch(
    `/api/v1/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(fileId)}`,
    { method: "DELETE", credentials: "include" },
  );
  if (!response.ok) {
    throw new Error(await readResponseText(response, "첨부파일을 제거하지 못했습니다."));
  }
}

async function readResponseText(response: Response, fallback: string) {
  const message = await response.text();
  return message || fallback;
}
