import type { ReactNode, Ref } from "react";

export type PresenterScriptListRow = {
  content: ReactNode;
  id: string;
  label?: string;
  status: "covered" | "current" | "next" | "paraphrased" | "pending" | "unmatchable";
};

export function PresenterScriptList(props: {
  emptyLabel: string;
  getRowRef?: (row: PresenterScriptListRow) => Ref<HTMLLIElement> | undefined;
  rows: readonly PresenterScriptListRow[];
}) {
  if (props.rows.length === 0) {
    return <p className="presenter-script-list-empty">{props.emptyLabel}</p>;
  }

  return (
    <ol className="presenter-script-list">
      {props.rows.map((row, index) => (
        <li
          aria-current={row.status === "current" ? "true" : undefined}
          className={[
            "presenter-script-row",
            row.status === "current" ? "presenter-script-row--current" : "",
            row.status === "next" ? "presenter-script-row--next" : "",
            row.status === "covered" ? "presenter-script-row--covered" : "",
            row.status === "paraphrased" ? "presenter-script-row--paraphrased" : "",
            row.status === "unmatchable" ? "presenter-script-row--unmatchable" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          data-script-row-status={row.status}
          key={row.id}
          ref={props.getRowRef?.(row)}
        >
          <span>{index + 1}</span>
          <p>{row.content}</p>
          {row.label ? <em>{row.label}</em> : null}
        </li>
      ))}
    </ol>
  );
}
