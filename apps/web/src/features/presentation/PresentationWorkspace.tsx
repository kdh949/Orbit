import {
  PresentationWorkspaceController,
  type PresentationWorkspaceProps,
} from "./PresentationWorkspaceController";

export type { PresentationWorkspaceProps };

export function PresentationWorkspace(props: PresentationWorkspaceProps) {
  return <PresentationWorkspaceController {...props} />;
}
