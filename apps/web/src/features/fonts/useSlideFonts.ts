import type { Deck, Slide } from "@orbit/shared";
import { useEffect, useState } from "react";

import { waitForSlideFonts } from "./fontRegistry";

export function useSlideFontRevision(deck: Deck, slide: Slide) {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void waitForSlideFonts(deck, slide).then(() => {
      if (!cancelled) setRevision((current) => current + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [deck, slide]);

  return revision;
}
