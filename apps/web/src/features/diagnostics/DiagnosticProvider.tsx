import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { OrbitDiagnosticRecorder } from "./diagnosticRecorder";
import { DiagnosticWorkerWriter } from "./diagnosticStore";
import { DiagnosticDrawer } from "./DiagnosticDrawer";
import type {
  DiagnosticMode,
  DiagnosticRecorderSnapshot,
  DiagnosticSessionMetadata,
  DiagnosticSessionSurface,
  DiagnosticSink
} from "./diagnosticTypes";

type DiagnosticLocation = {
  pathname: string;
  search: string;
};

type DiagnosticContextValue = {
  diagnostics: DiagnosticSink;
  snapshot: DiagnosticRecorderSnapshot;
  start: (
    mode?: Exclude<DiagnosticMode, "off">,
    surface?: DiagnosticSessionSurface
  ) => void;
  stop: (reason?: string) => Promise<void>;
  updateSessionMetadata: (metadata: DiagnosticSessionMetadata) => void;
};

const offDiagnosticSink: DiagnosticSink = {
  mode: "off",
  sessionId: null,
  createTriggerTraceId: () => null,
  emit: () => null
};

const initialSnapshot: DiagnosticRecorderSnapshot = {
  activeSession: null,
  mode: "off",
  recentEvents: [],
  storageWarning: null
};

const defaultContext: DiagnosticContextValue = {
  diagnostics: offDiagnosticSink,
  snapshot: initialSnapshot,
  start() {},
  async stop() {},
  updateSessionMetadata() {}
};

const DiagnosticContext =
  createContext<DiagnosticContextValue>(defaultContext);

let defaultRecorder: OrbitDiagnosticRecorder | null = null;

export function DiagnosticProvider(props: {
  children: ReactNode;
  recorder?: OrbitDiagnosticRecorder;
}) {
  const recorder = props.recorder ?? getDefaultDiagnosticRecorder();
  const [location, setLocation] = useState<DiagnosticLocation>(
    getBrowserDiagnosticLocation
  );
  const [snapshot, setSnapshot] = useState(() => recorder.snapshot());
  const autoStartControllerRef = useRef(
    new DiagnosticAutoStartController()
  );
  const locationKey = getDiagnosticLocationKey(location);
  const surface = getDiagnosticSurface(location.pathname);
  const shouldAutoStart =
    surface !== null && hasAnimationDebugOptIn(location.search);

  const autoStartAction = autoStartControllerRef.current.reconcile({
    locationKey,
    mode: recorder.mode,
    shouldAutoStart
  });
  if (autoStartAction === "stop") {
    void recorder.stop("route-boundary");
  }
  if (autoStartAction === "start") {
    recorder.start({
      mode: "full",
      surface: surface ?? "unknown",
      metadata: getDefaultSessionMetadata()
    });
  }

  useEffect(() => recorder.subscribe(setSnapshot), [recorder]);

  useEffect(() => {
    const handleLocationChange = () =>
      setLocation(getBrowserDiagnosticLocation());
    const handlePageHide = () => {
      void recorder.stop("pagehide");
    };
    window.addEventListener("popstate", handleLocationChange);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("popstate", handleLocationChange);
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [recorder]);

  const start = useCallback(
    (
      mode: Exclude<DiagnosticMode, "off"> = "full",
      requestedSurface?: DiagnosticSessionSurface
    ) => {
      autoStartControllerRef.current.markStarted(locationKey);
      recorder.start({
        mode,
        surface: requestedSurface ?? surface ?? "unknown",
        metadata: getDefaultSessionMetadata()
      });
    },
    [locationKey, recorder, surface]
  );
  const stop = useCallback(
    async (reason = "manual") => {
      autoStartControllerRef.current.block(locationKey);
      await recorder.stop(reason);
    },
    [locationKey, recorder]
  );
  const updateSessionMetadata = useCallback(
    (metadata: DiagnosticSessionMetadata) => {
      recorder.updateSessionMetadata(metadata);
    },
    [recorder]
  );
  const value = useMemo<DiagnosticContextValue>(
    () => ({
      diagnostics: recorder,
      snapshot,
      start,
      stop,
      updateSessionMetadata
    }),
    [recorder, snapshot, start, stop, updateSessionMetadata]
  );

  return (
    <DiagnosticContext.Provider value={value}>
      {props.children}
      {shouldAutoStart && surface ? (
        <DiagnosticDrawer
          flush={() => recorder.flush()}
          snapshot={snapshot}
          start={start}
          stop={stop}
          surface={surface}
        />
      ) : null}
    </DiagnosticContext.Provider>
  );
}

export function useDiagnostics() {
  return useContext(DiagnosticContext);
}

export function getDiagnosticSurface(
  pathname: string
): DiagnosticSessionSurface | null {
  if (pathname.startsWith("/presentation/")) {
    return "presentation";
  }
  if (pathname.startsWith("/rehearsal/")) {
    return "rehearsal";
  }
  if (pathname.startsWith("/project/")) {
    return "editor-partial-rehearsal";
  }
  return null;
}

export function hasAnimationDebugOptIn(search: string) {
  return new URLSearchParams(search).get("animationDebug") === "1";
}

export function hashDiagnosticIdentifier(value: string) {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export class DiagnosticAutoStartController {
  private activeLocation: string | null = null;
  private blockedLocation: string | null = null;
  private lastLocation: string | null = null;

  reconcile(input: {
    locationKey: string;
    mode: DiagnosticMode;
    shouldAutoStart: boolean;
  }): "start" | "stop" | null {
    if (
      this.lastLocation !== null &&
      this.lastLocation !== input.locationKey
    ) {
      this.blockedLocation = null;
    }
    this.lastLocation = input.locationKey;
    if (input.mode !== "off") {
      if (!input.shouldAutoStart || (
        this.activeLocation !== null &&
        this.activeLocation !== input.locationKey
      )) {
        this.activeLocation = null;
        return "stop";
      }
      this.activeLocation = input.locationKey;
      return null;
    }
    if (
      input.shouldAutoStart &&
      this.blockedLocation !== input.locationKey
    ) {
      this.activeLocation = input.locationKey;
      return "start";
    }
    return null;
  }

  block(locationKey: string) {
    this.activeLocation = null;
    this.blockedLocation = locationKey;
    this.lastLocation = locationKey;
  }

  markStarted(locationKey: string) {
    this.activeLocation = locationKey;
    this.blockedLocation = null;
    this.lastLocation = locationKey;
  }
}

function getDefaultDiagnosticRecorder() {
  if (defaultRecorder) {
    return defaultRecorder;
  }
  try {
    defaultRecorder = new OrbitDiagnosticRecorder({
      writer: new DiagnosticWorkerWriter()
    });
  } catch (cause) {
    defaultRecorder = new OrbitDiagnosticRecorder();
    defaultRecorder.reportStorageWarning(cause);
  }
  return defaultRecorder;
}

function getBrowserDiagnosticLocation(): DiagnosticLocation {
  if (typeof window === "undefined") {
    return { pathname: "/", search: "" };
  }
  return {
    pathname: window.location.pathname,
    search: window.location.search
  };
}

function getDiagnosticLocationKey(location: DiagnosticLocation) {
  return `${location.pathname}${location.search}`;
}

function getDefaultSessionMetadata(): DiagnosticSessionMetadata {
  return {
    appVersion: import.meta.env.VITE_APP_VERSION ?? "development",
    browser:
      typeof navigator === "undefined" ? "unknown" : navigator.userAgent
  };
}
