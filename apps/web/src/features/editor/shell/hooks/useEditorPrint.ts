import type { Deck, Slide } from "@orbit/shared";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { flushSync } from "react-dom";

import { waitForDeckFonts } from "../../../fonts/fontRegistry";
import {
  waitForAnimationFrame,
  waitForSlideAssets,
} from "../utils/slideRenderUtils";

export const printPreparationTimeoutMs = 2_000;

type PrintAssetWaitOptions = {
  loadDeckFonts?: (deck: Deck) => Promise<unknown>;
  loadSlideAssets?: (slide: Slide) => Promise<number>;
  timeoutMs?: number;
};

export function isPrintKeyboardShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">,
) {
  return (
    !event.altKey &&
    !event.shiftKey &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "p"
  );
}

export async function waitForDeckPrintAssets(
  deck: Deck,
  options: PrintAssetWaitOptions = {},
) {
  const {
    loadDeckFonts = waitForDeckFonts,
    loadSlideAssets = waitForSlideAssets,
    timeoutMs = printPreparationTimeoutMs,
  } = options;
  await waitForPromiseOrTimeout(
    Promise.all([
      loadDeckFonts(deck),
      ...deck.slides.map((slide) => loadSlideAssets(slide)),
    ]),
    timeoutMs,
  );
}

export function useEditorPrint(args: {
  workingDeckRef: MutableRefObject<Deck>;
}) {
  const [isPrintPreparing, setIsPrintPreparing] = useState(false);
  const [printDeck, setPrintDeck] = useState<Deck | null>(null);
  const activeRequestRef = useRef(false);
  const printDeckRef = useRef<Deck | null>(null);
  const renderReadyResolverRef = useRef<(() => void) | null>(null);

  const clearPrintDeck = useCallback(() => {
    activeRequestRef.current = false;
    printDeckRef.current = null;
    renderReadyResolverRef.current = null;
    setIsPrintPreparing(false);
    setPrintDeck(null);
  }, []);

  const handlePrintDeckReady = useCallback(() => {
    renderReadyResolverRef.current?.();
    renderReadyResolverRef.current = null;
  }, []);

  const requestPrint = useCallback(async () => {
    if (activeRequestRef.current) return;

    activeRequestRef.current = true;
    setIsPrintPreparing(true);
    await finishActiveInlineTextEditing();

    const nextPrintDeck = structuredClone(args.workingDeckRef.current);
    const renderReady = new Promise<void>((resolve) => {
      renderReadyResolverRef.current = resolve;
    });
    printDeckRef.current = nextPrintDeck;
    setPrintDeck(nextPrintDeck);

    try {
      await Promise.all([
        waitForDeckPrintAssets(nextPrintDeck),
        waitForPromiseOrTimeout(renderReady, printPreparationTimeoutMs),
      ]);
      await waitForAnimationFrame();
      await waitForAnimationFrame();
      setIsPrintPreparing(false);
      window.print();
    } catch {
      clearPrintDeck();
    }
  }, [args.workingDeckRef, clearPrintDeck]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!isPrintKeyboardShortcut(event)) return;
      event.preventDefault();
      void requestPrint();
    }

    function handleBeforePrint() {
      if (printDeckRef.current) return;

      activeRequestRef.current = true;
      const nextPrintDeck = structuredClone(args.workingDeckRef.current);
      printDeckRef.current = nextPrintDeck;
      flushSync(() => setPrintDeck(nextPrintDeck));
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("beforeprint", handleBeforePrint);
    window.addEventListener("afterprint", clearPrintDeck);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("beforeprint", handleBeforePrint);
      window.removeEventListener("afterprint", clearPrintDeck);
      activeRequestRef.current = false;
      printDeckRef.current = null;
      renderReadyResolverRef.current = null;
    };
  }, [args.workingDeckRef, clearPrintDeck, requestPrint]);

  return {
    handlePrintDeckReady,
    isPrintPreparing,
    printDeck,
    requestPrint,
  };
}

async function finishActiveInlineTextEditing() {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLElement &&
    activeElement.classList.contains("inline-text-editor")
  ) {
    activeElement.blur();
    await Promise.resolve();
    await Promise.resolve();
  }
}

async function waitForPromiseOrTimeout(
  promise: Promise<unknown>,
  timeoutMs: number,
) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}
