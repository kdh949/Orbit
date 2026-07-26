import { demoIds } from "@orbit/shared/common";
import { lazy, Suspense } from "react";

import { OrbitButton, OrbitEmptyState } from "../../components/ui";
import {
  ActivityAudiencePreviewPage,
  ActivityResultsPage,
} from "../../features/activity-slides";
import { AiDeckGenerationPage } from "../../features/ai-ppt/AiDeckGenerationPage";
import {
  AiPptMockupPage as AiPptWizardPage,
  AiPptStyleColorPage,
} from "../../features/ai-ppt/AiPptMockupPage";
import { OrbitAuthPage } from "../../features/auth/AuthPage";
import { ProfilePage } from "../../features/auth/ProfilePage";
import type { AuthUser } from "../../features/auth/auth-session";
import { ChallengeQnaPage } from "../../features/coaching/ChallengeQnaPage";
import { FocusedPracticePage } from "../../features/coaching/FocusedPracticePage";
import { PracticePlanPage } from "../../features/coaching/PracticePlanPage";
import { PresentationBriefPage } from "../../features/coaching/PresentationBriefPage";
import { CommunityGalleryPage } from "../../features/community-templates/CommunityGalleryPage";
import { CommunityTemplateDetailPage } from "../../features/community-templates/CommunityTemplateDetailPage";
import { RedesignSystemPage } from "../../features/design-system/RedesignSystemPage";
import { DeckVersionHistoryPage } from "../../features/editor/history/DeckVersionHistoryPage";
import { OrbitMockupFlow } from "../../features/mockups/OrbitMockupFlow";
import { PresentationReportPage } from "../../features/presentation/PresentationReportPage";
import { PresentationWorkspace } from "../../features/presentation/public";
import {
  CompanionPage,
  CompanionPairingPage,
} from "../../features/presenter-companion/CompanionPage";
import { CompanionSpikeHostPanel } from "../../features/presenter-companion/spike/CompanionSpikeHostPanel";
import {
  CompanionSpikeAudiencePage,
  CompanionSpikeCapturePage,
  CompanionSpikePage,
} from "../../features/presenter-companion/spike/CompanionSpikePage";
import { isCompanionSpikeEnabled } from "../../features/presenter-companion/spike/companionSpike";
import { PresentWindow } from "../../features/presenter-shell/presenter/PresentWindow";
import { ProjectExplorerPage } from "../../features/projects/ProjectExplorerPage";
import { OrbitWorkspaceHome } from "../../features/projects/ProjectHub";
import { RehearsalProjectOverviewPage } from "../../features/rehearsal/RehearsalProjectOverviewPage";
import { RehearsalProjectPickerPage } from "../../features/rehearsal/RehearsalProjectPickerPage";
import { RehearsalReportListPage } from "../../features/rehearsal/RehearsalReportListPage";
import { RehearsalWorkspace } from "../../features/rehearsal/public";
import { RehearsalReportPage } from "../../features/rehearsal/report/RehearsalReportPage";
import { AudienceSessionPage } from "../../pages/audience/AudienceSessionPage";
import {
  EditorLoadingFallback,
  ProjectAccessGate,
  ProjectAccessRequestPage,
} from "../access/projectAccess";
import { DeckRenderPage } from "../fixtures/DeckRenderPage";
import {
  demoDeck,
  reportMockupReport,
  reportMockupRun,
  reportMockupRunId,
} from "../fixtures/reportMockup";
import type { Route } from "./appRoutes";

const EditorShell = lazy(() =>
  import("../../features/editor/shell/public").then((module) => ({
    default: module.EditorShell,
  })),
);

function AuthLoadingFallback() {
  return (
    <main className="orbit-page">
      <OrbitEmptyState
        description="로그인 상태와 작업 공간을 확인하고 있습니다."
        title="ORBIT를 준비하고 있어요."
      />
    </main>
  );
}

export function renderAppRoute(
  route: Route,
  user: AuthUser | undefined,
  navigateTo: (path: string) => void,
) {
  if (route.name === "design-system") return <RedesignSystemPage />;
  if (route.name === "mockup") {
    return <OrbitMockupFlow onNavigate={navigateTo} screen={route.screen} />;
  }
  if (route.name === "login") {
    return (
      <OrbitAuthPage
        isAuthenticated={Boolean(user)}
        mode="login"
        onNavigate={navigateTo}
      />
    );
  }
  if (route.name === "signup") {
    return (
      <OrbitAuthPage
        isAuthenticated={Boolean(user)}
        mode="register"
        onNavigate={navigateTo}
      />
    );
  }
  if (route.name === "profile") {
    return user ? (
      <ProfilePage onNavigate={navigateTo} user={user} />
    ) : (
      <AuthLoadingFallback />
    );
  }
  if (route.name === "community") {
    return <CommunityGalleryPage onNavigate={navigateTo} />;
  }
  if (route.name === "community-detail") {
    return (
      <CommunityTemplateDetailPage
        onNavigate={navigateTo}
        templateId={route.templateId}
      />
    );
  }
  if (route.name === "create-deck") return <AiPptWizardPage />;
  if (route.name === "project-list") {
    return <ProjectExplorerPage onNavigate={navigateTo} />;
  }
  if (route.name === "rehearsal-project-list") {
    return <RehearsalProjectPickerPage onNavigate={navigateTo} />;
  }
  if (route.name === "project-editor") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <Suspense fallback={<EditorLoadingFallback />}>
          <EditorShell projectId={route.projectId} />
        </Suspense>
      </ProjectAccessGate>
    );
  }
  if (route.name === "activity-preview") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <ActivityAudiencePreviewPage
          activityId={route.activityId}
          projectId={route.projectId}
        />
      </ProjectAccessGate>
    );
  }
  if (route.name === "project-brief") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <PresentationBriefPage projectId={route.projectId} />
      </ProjectAccessGate>
    );
  }
  if (route.name === "project-history") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <DeckVersionHistoryPage projectId={route.projectId} />
      </ProjectAccessGate>
    );
  }
  if (route.name === "activity-results") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <ActivityResultsPage
          projectId={route.projectId}
          sessionId={route.sessionId}
        />
      </ProjectAccessGate>
    );
  }
  if (route.name === "story-style-color") {
    return (
      <AiPptStyleColorPage jobId={route.jobId} projectId={route.projectId} />
    );
  }
  if (route.name === "ai-deck-generation") {
    return (
      <AiDeckGenerationPage jobId={route.jobId} projectId={route.projectId} />
    );
  }
  if (route.name === "project-request")
    return <ProjectAccessRequestPage projectId={route.projectId} />;
  if (route.name === "audience-session") {
    return <AudienceSessionPage sessionId={route.sessionId} />;
  }
  if (route.name === "audience-activity") {
    return (
      <AudienceSessionPage
        activityId={route.activityId}
        sessionId={route.sessionId}
      />
    );
  }
  if (route.name === "companion-spike") {
    return <CompanionSpikePage spikeId={route.spikeId} />;
  }
  if (route.name === "companion-spike-audience") {
    return <CompanionSpikeAudiencePage spikeId={route.spikeId} />;
  }
  if (route.name === "companion-spike-capture") {
    return <CompanionSpikeCapturePage spikeId={route.spikeId} />;
  }
  if (route.name === "companion-pair") {
    return <CompanionPairingPage code={route.code} />;
  }
  if (route.name === "companion") {
    return <CompanionPage sessionId={route.sessionId} />;
  }
  if (route.name === "presentation") {
    return (
      <>
        <PresentationWorkspace
          fallbackDeck={
            route.projectId === demoIds.projectId ? demoDeck : undefined
          }
          initialSlideIndex={route.presenterInitialSlideIndex}
          initialStepIndex={route.presenterInitialStepIndex}
          localWindowSessionId={route.presenterSessionId}
          presenterWindow={route.presenterWindow}
          projectId={route.projectId}
        />
        {isCompanionSpikeEnabled() ? (
          <CompanionSpikeHostPanel
            hostKind="presentation"
            projectId={route.projectId}
          />
        ) : null}
      </>
    );
  }
  if (route.name === "presentation-report") {
    return (
      <ProjectAccessGate projectId={route.projectId}>
        <PresentationReportPage
          projectId={route.projectId}
          runId={route.runId}
          sessionId={route.sessionId}
        />
      </ProjectAccessGate>
    );
  }
  if (route.name === "present") {
    return <PresentWindow deckId={route.deckId} sessionId={route.sessionId} />;
  }
  if (route.name === "rehearsal") {
    return (
      <>
        <RehearsalWorkspace
          projectId={route.projectId}
          presenterInitialSlideIndex={route.presenterInitialSlideIndex}
          presenterInitialStepIndex={route.presenterInitialStepIndex}
          presenterSessionId={route.presenterSessionId}
          presenterWindow={route.presenterWindow}
          snapshotPreparationId={route.snapshotPreparationId}
          sourceFullRunId={route.sourceFullRunId}
          sourceGoalSetId={route.sourceGoalSetId}
          preflightMode={route.preflightMode}
          fallbackDeck={
            route.projectId === demoIds.projectId ? demoDeck : undefined
          }
        />
        {isCompanionSpikeEnabled() ? (
          <CompanionSpikeHostPanel
            hostKind="rehearsal"
            projectId={route.projectId}
          />
        ) : null}
      </>
    );
  }
  if (route.name === "rehearsal-report") {
    return (
      <RehearsalReportPage
        key={`${route.projectId}:${route.runId}`}
        projectId={route.projectId}
        runId={route.runId}
      />
    );
  }
  if (route.name === "practice-plan") {
    return (
      <PracticePlanPage
        projectId={route.projectId}
        sourceFullRunId={route.sourceFullRunId}
      />
    );
  }
  if (route.name === "focused-practice") {
    return (
      <FocusedPracticePage
        projectId={route.projectId}
        goalId={route.goalId}
        sourceFullRunId={route.sourceFullRunId}
      />
    );
  }
  if (route.name === "challenge-qna") {
    return (
      <ChallengeQnaPage
        projectId={route.projectId}
        sourceFullRunId={route.sourceFullRunId}
      />
    );
  }
  if (route.name === "report-project-overview") {
    return (
      <RehearsalProjectOverviewPage
        key={route.projectId}
        projectId={route.projectId}
      />
    );
  }
  if (route.name === "report-list") {
    const projectId =
      new URLSearchParams(window.location.search).get("project") ?? undefined;
    return <RehearsalReportListPage projectId={projectId} />;
  }
  if (route.name === "report-mockup") {
    return (
      <RehearsalReportPage
        initialDeck={demoDeck}
        initialReport={reportMockupReport}
        initialRun={reportMockupRun}
        projectId={demoIds.projectId}
        runId={reportMockupRunId}
      />
    );
  }
  if (route.name === "deck-render") {
    return <DeckRenderPage />;
  }
  if (route.name === "not-found") {
    return (
      <OrbitEmptyState
        action={
          <>
            <OrbitButton onClick={() => navigateTo("/")}>홈으로</OrbitButton>
            <OrbitButton
              onClick={() => navigateTo("/project")}
              variant="secondary"
            >
              프로젝트 보기
            </OrbitButton>
          </>
        }
        description="주소가 바뀌었거나 존재하지 않는 페이지입니다."
        title="페이지를 찾을 수 없습니다."
      />
    );
  }
  if (route.name === "home") {
    return (
      <OrbitWorkspaceHome
        onNavigate={navigateTo}
        userName={user?.displayName}
      />
    );
  }
  return null;
}
