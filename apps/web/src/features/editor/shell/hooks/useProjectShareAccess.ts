import { useEffect, useState } from "react";
import type { ProjectMembersResponse } from "@orbit/shared/projects";
import {
  fetchProjectMembers,
  inviteProjectMember,
  removeProjectMember,
  updateProjectMemberRole,
  updateProjectMemberStatus,
  type ShareRole
} from "../api/projectMembersApi";
import type {
  LocalShareMember,
  LocalShareRequest,
  ShareAccessTab
} from "../components/ShareAccessModal";

function toShareInviteErrorMessage(message: string) {
  if (
    message.includes("Invalid email") ||
    message.includes("Invalid request body") ||
    message.includes("User not found")
  ) {
    return "해당 유저를 찾을 수 없습니다.";
  }

  return message;
}

export function useProjectShareAccess(args: {
  projectId: string;
  toErrorMessage: (error: unknown) => string;
  workspaceId: string;
}) {
  const { projectId, toErrorMessage, workspaceId } = args;
  const [isSharePanelOpen, setIsSharePanelOpen] = useState(false);
  const [shareAccessTab, setShareAccessTab] = useState<ShareAccessTab>("status");
  const [shareInviteEmail, setShareInviteEmail] = useState("");
  const [shareInviteRole, setShareInviteRole] = useState<Exclude<ShareRole, "owner">>("viewer");
  const [shareMembers, setShareMembers] = useState<LocalShareMember[]>([]);
  const [shareRequests, setShareRequests] = useState<LocalShareRequest[]>([]);
  const [shareActionError, setShareActionError] = useState("");
  const [shareActionLabel, setShareActionLabel] = useState("");
  const [isShareLoading, setIsShareLoading] = useState(false);
  const [canManageShare, setCanManageShare] = useState(false);
  const [isSharePermissionLoading, setIsSharePermissionLoading] = useState(false);

  function applyShareResponse(response: ProjectMembersResponse) {
    setShareMembers(response.members);
    setShareRequests(
      response.requests.filter(
        (request): request is LocalShareRequest => request.role !== "owner"
      )
    );
  }

  useEffect(() => {
    let isCancelled = false;

    setIsSharePermissionLoading(true);
    setCanManageShare(false);
    fetchProjectMembers(workspaceId, projectId)
      .then((response) => {
        if (isCancelled) {
          return;
        }
        applyShareResponse(response);
        setCanManageShare(true);
      })
      .catch(() => {
        if (isCancelled) {
          return;
        }
        setCanManageShare(false);
        setShareMembers([]);
        setShareRequests([]);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsSharePermissionLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [projectId, workspaceId]);

  useEffect(() => {
    if (!isSharePanelOpen) {
      return;
    }

    void loadShareMembers();
  }, [isSharePanelOpen, projectId, workspaceId]);

  async function loadShareMembers() {
    setIsShareLoading(true);
    setShareActionError("");
    try {
      applyShareResponse(await fetchProjectMembers(workspaceId, projectId));
    } catch (error) {
      setShareActionError(toErrorMessage(error));
    } finally {
      setIsShareLoading(false);
    }
  }

  async function handleShareInvite() {
    const email = shareInviteEmail.trim();

    setShareActionError("");
    if (!email) {
      setShareActionError("추가할 사용자의 이메일을 입력하세요.");
      return;
    }

    setIsShareLoading(true);
    try {
      applyShareResponse(
        await inviteProjectMember(workspaceId, projectId, email, shareInviteRole)
      );
      setShareInviteEmail("");
      setShareActionLabel("사용자를 추가했습니다.");
    } catch (error) {
      setShareActionError(toShareInviteErrorMessage(toErrorMessage(error)));
    } finally {
      setIsShareLoading(false);
    }
  }

  async function handleShareMemberRoleChange(email: string, role: ShareRole) {
    if (
      role === "owner" &&
      !window.confirm(
        "owner 권한을 넘기면 현재 owner는 editor로 변경됩니다. 계속 진행할까요?"
      )
    ) {
      return;
    }

    const member = shareMembers.find((candidate) => candidate.email === email);
    if (!member) {
      return;
    }

    setShareActionError("");
    setIsShareLoading(true);
    try {
      applyShareResponse(
        await updateProjectMemberRole(workspaceId, projectId, member.userId, role)
      );
      setShareActionLabel("사용자 권한을 수정했습니다.");
    } catch (error) {
      setShareActionError(toErrorMessage(error));
    } finally {
      setIsShareLoading(false);
    }
  }

  async function handleShareMemberRemoval(email: string) {
    const member = shareMembers.find((candidate) => candidate.email === email);
    if (!member) {
      return;
    }

    setShareActionError("");
    setIsShareLoading(true);
    try {
      applyShareResponse(
        await removeProjectMember(workspaceId, projectId, member.userId)
      );
      setShareActionLabel("사용자 권한을 회수했습니다.");
    } catch (error) {
      setShareActionError(toErrorMessage(error));
    } finally {
      setIsShareLoading(false);
    }
  }

  async function handleShareRequestStatus(
    email: string,
    status: "accepted" | "rejected"
  ) {
    const request = shareRequests.find((candidate) => candidate.email === email);
    if (!request) {
      return;
    }

    setShareActionError("");
    setIsShareLoading(true);
    try {
      applyShareResponse(
        await updateProjectMemberStatus(
          workspaceId,
          projectId,
          request.userId,
          status
        )
      );
      setShareActionLabel(
        status === "accepted" ? "요청을 승인했습니다." : "요청을 거절했습니다."
      );
    } catch (error) {
      setShareActionError(toErrorMessage(error));
    } finally {
      setIsShareLoading(false);
    }
  }

  function openSharePanel() {
    setIsSharePanelOpen(true);
    setShareActionError("");
    setShareActionLabel("");
  }

  return {
    canManageShare,
    handleShareInvite,
    handleShareMemberRemoval,
    handleShareMemberRoleChange,
    handleShareRequestStatus,
    isShareLoading,
    isSharePanelOpen,
    isSharePermissionLoading,
    openSharePanel,
    setIsSharePanelOpen,
    setShareAccessTab,
    setShareInviteEmail,
    setShareInviteRole,
    shareAccessTab,
    shareActionError,
    shareActionLabel,
    shareInviteEmail,
    shareInviteRole,
    shareMembers,
    shareRequests
  };
}
