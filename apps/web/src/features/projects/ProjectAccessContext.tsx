import type {
  ProjectMemberRole,
  ProjectMemberStatus,
} from "@orbit/shared/projects";
import { createContext, useContext, type ReactNode } from "react";

export type ProjectAccessMembership = {
  role: ProjectMemberRole;
  status: ProjectMemberStatus;
};

const ProjectAccessContext = createContext<ProjectAccessMembership | null>(null);

export function ProjectAccessProvider(props: {
  children: ReactNode;
  membership: ProjectAccessMembership;
}) {
  return (
    <ProjectAccessContext.Provider value={props.membership}>
      {props.children}
    </ProjectAccessContext.Provider>
  );
}

export function useProjectAccessMembership() {
  const membership = useContext(ProjectAccessContext);
  if (!membership || membership.status !== "accepted") {
    throw new Error("Accepted project access is required");
  }
  return membership;
}

export function canMutateProjectDeck(membership: ProjectAccessMembership) {
  return (
    membership.status === "accepted" &&
    (membership.role === "owner" || membership.role === "editor")
  );
}
