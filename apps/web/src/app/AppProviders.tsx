import type { ReactNode } from "react";

import { PptxImportProvider } from "../features/projects/PptxImportProvider";

export function AppProviders(props: { children: ReactNode }) {
  return <PptxImportProvider>{props.children}</PptxImportProvider>;
}
