import type { PptxImportPreference } from "@orbit/shared/deck";
import type { Job } from "@orbit/shared/jobs";
import type { Project, ProjectListItem } from "@orbit/shared/projects";
import { useQueryClient } from "@tanstack/react-query";
import {
  IconBell,
  IconChevronDown,
  IconFileDescription,
  IconLoader2,
  IconMinus,
  IconX,
} from "@tabler/icons-react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { uploadAndImportPptxTemplate } from "../editor/shell/api/editorJobApi";
import { getPptxImportValidationMessage } from "../editor/shell/utils/editorFileValidation";
import {
  createProjectWithoutDeck,
  deleteProject,
} from "./ProjectAssetWorkspace";
import "./pptx-import-background.css";

export type PptxImportOperation = {
  fileName: string;
  jobId: string | null;
  message: string;
  progress: number | null;
  project: Project;
  stage: "uploading" | "importing" | Job["status"];
};

type PptxImportContextValue = {
  dismiss: () => void;
  isImporting: boolean;
  operation: PptxImportOperation | null;
  startImport: (
    file: File,
    importPreference: PptxImportPreference,
  ) => Promise<Project>;
};

const missingPptxImportContext: PptxImportContextValue = {
  dismiss: () => undefined,
  isImporting: false,
  operation: null,
  startImport: async () => {
    throw new Error("PPTX 가져오기 컨텍스트를 사용할 수 없습니다.");
  },
};

const PptxImportContext = createContext<PptxImportContextValue>(
  missingPptxImportContext,
);

export function PptxImportProvider(props: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const inFlightRef = useRef(false);
  const [operation, setOperation] = useState<PptxImportOperation | null>(null);

  async function refreshProjects() {
    await queryClient.invalidateQueries({ queryKey: ["projects"] });
  }

  async function startImport(
    file: File,
    importPreference: PptxImportPreference,
  ) {
    const validationMessage = getPptxImportValidationMessage(file);
    if (validationMessage) throw new Error(validationMessage);
    if (inFlightRef.current) {
      throw new Error("진행 중인 PPTX 가져오기가 끝난 뒤 다시 시도해 주세요.");
    }

    inFlightRef.current = true;
    let project: Project | null = null;
    try {
      project = await createProjectWithoutDeck(projectTitleFromFile(file.name));
      setOperation({
        fileName: file.name,
        jobId: null,
        message: "파일을 업로드하고 있습니다.",
        progress: null,
        project,
        stage: "uploading",
      });
      await refreshProjects();

      await uploadAndImportPptxTemplate(project.projectId, file, {
        importPreference,
        onJob: (job) => {
          setOperation({
            fileName: file.name,
            jobId: job.jobId,
            message:
              job.message ||
              (job.status === "queued"
                ? "변환 작업을 준비하고 있습니다."
                : "발표자 노트와 레이아웃을 정리하고 있습니다."),
            progress: job.progress,
            project: project as Project,
            stage: job.status,
          });
          void refreshProjects();
        },
        onPhase: (phase) => {
          if (phase !== "importing") return;
          setOperation((current) =>
            current
              ? {
                  ...current,
                  message: "변환 작업을 준비하고 있습니다.",
                  progress: 0,
                  stage: "importing",
                }
              : current,
          );
        },
      });

      setOperation((current) =>
        current
          ? {
              ...current,
              message: "프로젝트를 편집할 준비가 끝났습니다.",
              progress: 100,
              stage: "succeeded",
            }
          : current,
      );
      await refreshProjects();
      return project;
    } catch (cause) {
      if (project) {
        setOperation((current) =>
          current
            ? {
                ...current,
                message:
                  cause instanceof Error
                    ? cause.message
                    : "PPTX를 가져오지 못했습니다.",
                stage: "failed",
              }
            : current,
        );
        try {
          await deleteProject(project.projectId);
          await refreshProjects();
        } catch {
          // The original import failure remains the actionable error.
        }
      }
      throw cause;
    } finally {
      inFlightRef.current = false;
    }
  }

  const value = useMemo<PptxImportContextValue>(
    () => ({
      dismiss: () => setOperation(null),
      isImporting: Boolean(
        operation &&
          operation.stage !== "succeeded" &&
          operation.stage !== "failed",
      ),
      operation,
      startImport,
    }),
    [operation],
  );

  return (
    <PptxImportContext.Provider value={value}>
      {props.children}
      <PptxImportBackgroundTray
        onDismiss={value.dismiss}
        operation={operation}
      />
    </PptxImportContext.Provider>
  );
}

export function usePptxImport() {
  return useContext(PptxImportContext);
}

export function mergePptxImportProject(
  projects: ProjectListItem[],
  operation: PptxImportOperation | null,
) {
  if (!operation || operation.stage === "failed") return projects;
  if (projects.some((project) => project.projectId === operation.project.projectId)) {
    return projects;
  }
  return [
    {
      ...operation.project,
      generation: null,
      isPinned: false,
      pinnedAt: null,
      tags: [],
    },
    ...projects,
  ];
}

function PptxImportBackgroundTray(props: {
  onDismiss: () => void;
  operation: PptxImportOperation | null;
}) {
  const [hidden, setHidden] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const operationKey = props.operation
    ? `${props.operation.project.projectId}:${props.operation.jobId ?? "upload"}`
    : null;

  useEffect(() => {
    setHidden(false);
  }, [operationKey]);

  if (!props.operation || hidden) return null;

  const complete = props.operation.stage === "succeeded";
  const failed = props.operation.stage === "failed";
  const active = !complete && !failed;
  const progressLabel =
    props.operation.progress === null
      ? "업로드 중"
      : `${complete ? "변환 완료" : failed ? "변환 실패" : "변환 중"} ${props.operation.progress}%`;

  return (
    <aside
      aria-label="백그라운드 작업"
      className={`pptx-background-tray${minimized ? " is-minimized" : ""}`}
    >
      <header>
        <div>
          {active ? (
            <IconLoader2 aria-hidden="true" className="pptx-tray-spinner" size={18} />
          ) : (
            <IconBell aria-hidden="true" size={18} />
          )}
          <strong>
            {complete
              ? "백그라운드 작업 완료"
              : failed
                ? "백그라운드 작업 실패"
                : "백그라운드 작업 1개"}
          </strong>
        </div>
        <div className="pptx-background-tray-controls">
          <button
            aria-label={minimized ? "작업 트레이 펼치기" : "작업 트레이 접기"}
            onClick={() => setMinimized((current) => !current)}
            type="button"
          >
            {minimized ? (
              <IconChevronDown aria-hidden="true" size={18} />
            ) : (
              <IconMinus aria-hidden="true" size={18} />
            )}
          </button>
          <button
            aria-label="작업 트레이 닫기"
            onClick={() => {
              setHidden(true);
              if (!active) props.onDismiss();
            }}
            type="button"
          >
            <IconX aria-hidden="true" size={18} />
          </button>
        </div>
      </header>
      {!minimized ? (
        <div className="pptx-background-tray-body">
          <div className="pptx-background-tray-file">
            <span aria-hidden="true">
              <IconFileDescription size={20} />
            </span>
            <div>
              <strong>{props.operation.fileName}</strong>
              <small>{progressLabel}</small>
            </div>
          </div>
          <progress
            aria-label={`${props.operation.project.title} PPTX 변환 진행률`}
            max="100"
            value={props.operation.progress ?? undefined}
          >
            {props.operation.progress ?? 0}%
          </progress>
          <p>
            <IconBell aria-hidden="true" size={15} />
            {complete
              ? "프로젝트를 편집할 수 있어요."
              : failed
                ? "오류를 확인한 뒤 다시 업로드해 주세요."
                : "완료되면 이 작업 트레이에서 알려드릴게요."}
          </p>
        </div>
      ) : null}
    </aside>
  );
}

function projectTitleFromFile(fileName: string) {
  return fileName.replace(/\.pptx$/i, "").trim() || "PPTX 프로젝트";
}
