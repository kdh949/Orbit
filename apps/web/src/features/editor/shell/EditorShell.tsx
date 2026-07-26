import EditorShellController, {
  type EditorShellProps,
} from "./EditorShellController";

export * from "./EditorShellController";

export function EditorShell(props: EditorShellProps) {
  return <EditorShellController {...props} />;
}
