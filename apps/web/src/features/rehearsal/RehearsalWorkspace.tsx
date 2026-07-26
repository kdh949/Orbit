import {
  RehearsalWorkspaceController,
  type RehearsalWorkspaceProps as ControllerProps,
} from "./RehearsalWorkspaceController";

export type RehearsalWorkspaceProps = ControllerProps;

export function RehearsalWorkspace(props: RehearsalWorkspaceProps) {
  return <RehearsalWorkspaceController {...props} />;
}
