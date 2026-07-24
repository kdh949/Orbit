import { loadOrbitConfig } from "@orbit/config";
import { config as loadDotenv } from "dotenv";
import { DataSource, DataSourceOptions } from "typeorm";
import { SavedDesignPackEntity } from "../saved-design-packs/saved-design-pack.entity";
import { DesignAgentMessageEntity } from "../design-agent/design-agent-message.entity";
import { DesignAgentProposalEntity } from "../design-agent/design-agent-proposal.entity";
import { SmartArtLayoutEntity } from "../smart-art-layouts/smart-art-layout.entity";
import { ProjectAssetEntity } from "../files/project-asset.entity";
import { ProjectEntity } from "../projects/project.entity";
import { ProjectMemberEntity } from "../projects/project-member.entity";
import { RehearsalRunEntity } from "../rehearsals/rehearsal-run.entity";
import { PresentationRunEntity } from "../presentation-sessions/presentation-run.entity";
import { AddPresentationDetailedReport2026072002000 } from "./migrations/2026072002000-AddPresentationDetailedReport";
import { AddSlidePracticeContentHash2026072101000 } from "./migrations/2026072101000-AddSlidePracticeContentHash";
import { CreateDeckPersistenceTables2026062701000 } from "./migrations/2026062701000-CreateDeckPersistenceTables";
import { CreateAuthUsers2026062702000 } from "./migrations/2026062702000-CreateAuthUsers";
import { CreateMigrationCommandCheck2026062700000 } from "./migrations/2026062700000-CreateMigrationCommandCheck";
import { CreateJobs2026062700200 } from "./migrations/2026062700200-CreateJobs";
import { CreateProjectsAndProjectAssets2026062703000 } from "./migrations/2026062703000-CreateProjectsAndProjectAssets";
import { CreateReferenceChunks2026062700100 } from "./migrations/2026062700100-CreateReferenceChunks";
import { CreateRehearsalRuns2026062901000 } from "./migrations/2026062901000-CreateRehearsalRuns";
import { CreateAiSuggestions2026062902000 } from "./migrations/2026062902000-CreateAiSuggestions";
import { AddRehearsalReportColumns2026062903000 } from "./migrations/2026062903000-AddRehearsalReportColumns";
import { CreateProjectMembers2026063001000 } from "./migrations/2026063001000-CreateProjectMembers";
import { CreatePresentationSessions2026070201000 } from "./migrations/2026070201000-CreatePresentationSessions";
import { AddUniqueOpenPresentationSession2026070202000 } from "./migrations/2026070202000-AddUniqueOpenPresentationSession";
import { AddRehearsalRunMetaJson2026070301000 } from "./migrations/2026070301000-AddRehearsalRunMetaJson";
import { CreateTemplateBlueprints2026070301000 } from "./migrations/2026070301000-CreateTemplateBlueprints";
import { CreateProjectRehearsalSummaries2026070801000 } from "./migrations/2026070801000-CreateProjectRehearsalSummaries";
import { ReplaceRehearsalSummaryWithProjectComment2026070802000 } from "./migrations/2026070802000-ReplaceRehearsalSummaryWithProjectComment";
import { CreateSavedDesignPacks2026071101000 } from "./migrations/2026071101000-CreateSavedDesignPacks";
import { CreateOrganizationsAndBrandKits2026071102000 } from "./migrations/2026071102000-CreateOrganizationsAndBrandKits";
import { AddImageAssetProvenance2026071103000 } from "./migrations/2026071103000-AddImageAssetProvenance";
import { AddOfficialImageAssetProvenance2026071201000 } from "./migrations/2026071201000-AddOfficialImageAssetProvenance";
import { CreateDesignAgentTables2026071101000 } from "./migrations/2026071101000-CreateDesignAgentTables";
import { AddRehearsalEvaluationSnapshot2026071001000 } from "./migrations/2026071001000-AddRehearsalEvaluationSnapshot";
import { DropAiSuggestions2026071102000 } from "./migrations/2026071102000-DropAiSuggestions";
import { CreateAdaptiveCoachingCore2026071103000 } from "./migrations/2026071103000-CreateAdaptiveCoachingCore";
import { CreateFocusedPractice2026071104000 } from "./migrations/2026071104000-CreateFocusedPractice";
import { CreateChallengeQna2026071105000 } from "./migrations/2026071105000-CreateChallengeQna";
import { BackfillFallbackPracticeGoals2026071201000 } from "./migrations/2026071201000-BackfillFallbackPracticeGoals";
import { CreateP0CoachingContracts2026071301000 } from "./migrations/2026071301000-CreateP0CoachingContracts";
import { DropOrganizationsAndBrandKits2026071401000 } from "./migrations/2026071401000-DropOrganizationsAndBrandKits";
import { BackfillFocusedPracticeGoalSetRef2026071501000 } from "./migrations/2026071501000-BackfillFocusedPracticeGoalSetRef";
import { CreateAiDeckGenerationStages2026071502000 } from "./migrations/2026071502000-CreateAiDeckGenerationStages";
import { CreateAiDeckReferenceExtractionArtifacts2026071503000 } from "./migrations/2026071503000-CreateAiDeckReferenceExtractionArtifacts";
import { CreateAiDeckPlanningArtifacts2026071601000 } from "./migrations/2026071601000-CreateAiDeckPlanningArtifacts";
import { ExpandAiDeckStageDispatchRecovery2026071601100 } from "./migrations/2026071601100-ExpandAiDeckStageDispatchRecovery";
import { CreateAiDeckExecutionArtifacts2026071602000 } from "./migrations/2026071602000-CreateAiDeckExecutionArtifacts";
import { AddRehearsalAudioRetention2026071603000 } from "./migrations/2026071603000-AddRehearsalAudioRetention";
import { AddRehearsalTranscriptArtifacts2026071603000 } from "./migrations/2026071603000-AddRehearsalTranscriptArtifacts";
import { ExpandPresentationSessionsForActivities2026071701000 } from "./migrations/2026071701000-ExpandPresentationSessionsForActivities";
import { CreateActivityRuntime2026071702000 } from "./migrations/2026071702000-CreateActivityRuntime";
import { CreatePresentationSessionAudienceRegistry2026071703000 } from "./migrations/2026071703000-CreatePresentationSessionAudienceRegistry";
import { CreateAiDeckStoryReviews2026071604000 } from "./migrations/2026071604000-CreateAiDeckStoryReviews";
import { CreateSlidePracticeAndQuestionGuides2026071701000 } from "./migrations/2026071701000-CreateSlidePracticeAndQuestionGuides";
import { AddSlideQuestionGuideWebResearch2026071702000 } from "./migrations/2026071702000-AddSlideQuestionGuideWebResearch";
import { CreateSlidePracticeAudioAnalyses2026071703000 } from "./migrations/2026071703000-CreateSlidePracticeAudioAnalyses";
import { CreateSmartArtLayouts2026071701000 } from "./migrations/2026071701000-CreateSmartArtLayouts";
import { AddSmartArtTemplateLayouts2026071702000 } from "./migrations/2026071702000-AddSmartArtTemplateLayouts";
import { IncreaseSmartArtTypography2026071703000 } from "./migrations/2026071703000-IncreaseSmartArtTypography";
import { RepairActivityRetentionPrivacy2026071704000 } from "./migrations/2026071704000-RepairActivityRetentionPrivacy";
import { CenterSmartArtCardText2026071705000 } from "./migrations/2026071705000-CenterSmartArtCardText";
import { ReplaceStoryReviewWithCoverPreview2026071706000 } from "./migrations/2026071706000-ReplaceStoryReviewWithCoverPreview";
import { AddProjectMemberPins2026071801000 } from "./migrations/2026071801000-AddProjectMemberPins";
import { CreatePresentationRuns2026072001000 } from "./migrations/2026072001000-CreatePresentationRuns";
import { CreateCommunityTemplates2026072101000 } from "./migrations/2026072101000-CreateCommunityTemplates";
import { AddProfileAvatars2026072101000 } from "./migrations/2026072101000-AddProfileAvatars";
import { AddProjectTags2026072102000 } from "./migrations/2026072102000-AddProjectTags";
import { AddUserProjectTagsAndPinnedAt2026072103000 } from "./migrations/2026072103000-AddUserProjectTagsAndPinnedAt";
import { AddUserDisplayNames2026072104000 } from "./migrations/2026072104000-AddUserDisplayNames";
import { AddCommunityTemplateEngagement2026072105000 } from "./migrations/2026072105000-AddCommunityTemplateEngagement";
import { AddCommunityTemplateGovernance2026072106000 } from "./migrations/2026072106000-AddCommunityTemplateGovernance";
import { AddCommunityCategoriesAndTags2026072107000 } from "./migrations/2026072107000-AddCommunityCategoriesAndTags";
import { AddPresentationSessionPurposeAndAudienceAccess2026072301000 } from "./migrations/2026072301000-AddPresentationSessionPurposeAndAudienceAccess";

loadDotenv({ path: "../../.env.local" });
loadDotenv({ path: ".env.local" });
loadDotenv();

const config = loadOrbitConfig(process.env, { service: "api" });

export const databaseOptions: DataSourceOptions = {
  type: "postgres",
  url: config.DATABASE_URL,
  entities: [
    ProjectEntity,
    ProjectMemberEntity,
    ProjectAssetEntity,
    RehearsalRunEntity,
    PresentationRunEntity,
    SavedDesignPackEntity,
    DesignAgentMessageEntity,
    DesignAgentProposalEntity,
    SmartArtLayoutEntity,
  ],
  migrations: [
    CreateMigrationCommandCheck2026062700000,
    CreateJobs2026062700200,
    CreateReferenceChunks2026062700100,
    CreateDeckPersistenceTables2026062701000,
    CreateAuthUsers2026062702000,
    CreateProjectsAndProjectAssets2026062703000,
    CreateRehearsalRuns2026062901000,
    CreateAiSuggestions2026062902000,
    AddRehearsalReportColumns2026062903000,
    CreateProjectMembers2026063001000,
    CreatePresentationSessions2026070201000,
    AddUniqueOpenPresentationSession2026070202000,
    AddRehearsalRunMetaJson2026070301000,
    CreateTemplateBlueprints2026070301000,
    CreateProjectRehearsalSummaries2026070801000,
    ReplaceRehearsalSummaryWithProjectComment2026070802000,
    AddRehearsalEvaluationSnapshot2026071001000,
    CreateSavedDesignPacks2026071101000,
    CreateDesignAgentTables2026071101000,
    CreateOrganizationsAndBrandKits2026071102000,
    DropAiSuggestions2026071102000,
    AddImageAssetProvenance2026071103000,
    CreateAdaptiveCoachingCore2026071103000,
    CreateFocusedPractice2026071104000,
    CreateChallengeQna2026071105000,
    AddOfficialImageAssetProvenance2026071201000,
    BackfillFallbackPracticeGoals2026071201000,
    CreateP0CoachingContracts2026071301000,
    DropOrganizationsAndBrandKits2026071401000,
    BackfillFocusedPracticeGoalSetRef2026071501000,
    CreateAiDeckGenerationStages2026071502000,
    CreateAiDeckReferenceExtractionArtifacts2026071503000,
    CreateAiDeckPlanningArtifacts2026071601000,
    ExpandAiDeckStageDispatchRecovery2026071601100,
    CreateAiDeckExecutionArtifacts2026071602000,
    AddRehearsalAudioRetention2026071603000,
    AddRehearsalTranscriptArtifacts2026071603000,
    CreateAiDeckStoryReviews2026071604000,
    CreateSlidePracticeAndQuestionGuides2026071701000,
    CreateSmartArtLayouts2026071701000,
    ExpandPresentationSessionsForActivities2026071701000,
    AddSlideQuestionGuideWebResearch2026071702000,
    CreateActivityRuntime2026071702000,
    AddSmartArtTemplateLayouts2026071702000,
    CreateSlidePracticeAudioAnalyses2026071703000,
    CreatePresentationSessionAudienceRegistry2026071703000,
    IncreaseSmartArtTypography2026071703000,
    RepairActivityRetentionPrivacy2026071704000,
    CenterSmartArtCardText2026071705000,
    ReplaceStoryReviewWithCoverPreview2026071706000,
    AddProjectMemberPins2026071801000,
    CreatePresentationRuns2026072001000,
    AddPresentationDetailedReport2026072002000,
    CreateCommunityTemplates2026072101000,
    AddProfileAvatars2026072101000,
    AddSlidePracticeContentHash2026072101000,
    AddProjectTags2026072102000,
    AddUserProjectTagsAndPinnedAt2026072103000,
    AddUserDisplayNames2026072104000,
    AddCommunityTemplateEngagement2026072105000,
    AddCommunityTemplateGovernance2026072106000,
    AddCommunityCategoriesAndTags2026072107000,
    AddPresentationSessionPurposeAndAudienceAccess2026072301000,
  ],
  migrationsTableName: "typeorm_migrations",
  synchronize: false,
  logging: false,
};

export default new DataSource(databaseOptions);
