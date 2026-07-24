import type { PresentationChannelIdentity } from "./presentationChannel";

export const audienceStreamBridgeKey = "__orbitAudienceStreamBridgeV1";

export type AudienceStreamBridgeFailureCode =
  | "window-closed"
  | "bridge-unavailable"
  | "bridge-conflict"
  | "identity-mismatch"
  | "access-denied"
  | "attach-failed";

export type AudienceStreamBridgeResult =
  | { ok: true }
  | { code: AudienceStreamBridgeFailureCode; ok: false };

export type ActiveAudienceStream = {
  shareEpochId: string;
  stream: MediaStream;
};

export type AudienceStreamBridge = {
  attach: (input: {
    identity: PresentationChannelIdentity;
    shareEpochId: string;
    stream: MediaStream;
  }) => AudienceStreamBridgeResult;
  detach: (input: {
    identity: PresentationChannelIdentity;
  }) => AudienceStreamBridgeResult;
  observe?: (input: {
    identity: PresentationChannelIdentity;
    onChange: (active: ActiveAudienceStream | null) => void;
  }) =>
    | { ok: true; unsubscribe: () => void }
    | { code: AudienceStreamBridgeFailureCode; ok: false };
  version: 1;
};

export type AudienceStreamBridgeWindow = {
  closed?: boolean;
  [key: string]: unknown;
};

export type AudienceStreamBridgeRegistration = {
  detach: () => void;
  unregister: () => void;
};

export type AudienceStreamBridgeObservation =
  | { ok: true; unsubscribe: () => void }
  | { code: AudienceStreamBridgeFailureCode; ok: false };

export function registerAudienceStreamBridge(args: {
  identity: PresentationChannelIdentity;
  onAttach: (stream: MediaStream) => void;
  onDetach: () => void;
  targetWindow?: AudienceStreamBridgeWindow;
}):
  | ({ ok: true } & AudienceStreamBridgeRegistration)
  | { code: AudienceStreamBridgeFailureCode; ok: false } {
  const targetWindow = args.targetWindow ?? readCurrentWindow();
  if (!targetWindow) {
    return { code: "bridge-unavailable", ok: false };
  }

  let activeStream: ActiveAudienceStream | null = null;
  const observers = new Set<
    (active: ActiveAudienceStream | null) => void
  >();
  const notifyObservers = () => {
    for (const observer of observers) observer(activeStream);
  };
  const bridge: AudienceStreamBridge = {
    attach: ({ identity, shareEpochId, stream }) => {
      if (!matchesIdentity(identity, args.identity)) {
        return { code: "identity-mismatch", ok: false };
      }
      try {
        args.onAttach(stream);
        activeStream = { shareEpochId, stream };
        notifyObservers();
        return { ok: true };
      } catch {
        return { code: "attach-failed", ok: false };
      }
    },
    detach: ({ identity }) => {
      if (!matchesIdentity(identity, args.identity)) {
        return { code: "identity-mismatch", ok: false };
      }
      if (activeStream) {
        activeStream = null;
        args.onDetach();
        notifyObservers();
      }
      return { ok: true };
    },
    observe: ({ identity, onChange }) => {
      if (!matchesIdentity(identity, args.identity)) {
        return { code: "identity-mismatch", ok: false };
      }
      observers.add(onChange);
      onChange(activeStream);
      return {
        ok: true,
        unsubscribe: () => {
          observers.delete(onChange);
        },
      };
    },
    version: 1,
  };

  try {
    const host = targetWindow as Record<string, unknown>;
    if (host[audienceStreamBridgeKey]) {
      return { code: "bridge-conflict", ok: false };
    }
    Object.defineProperty(host, audienceStreamBridgeKey, {
      configurable: true,
      enumerable: false,
      value: bridge,
      writable: false,
    });
  } catch {
    return { code: "access-denied", ok: false };
  }

  const detach = () => {
    if (!activeStream) return;
    activeStream = null;
    args.onDetach();
    notifyObservers();
  };

  return {
    detach,
    ok: true,
    unregister: () => {
      detach();
      observers.clear();
      try {
        const host = targetWindow as Record<string, unknown>;
        if (host[audienceStreamBridgeKey] === bridge) {
          delete host[audienceStreamBridgeKey];
        }
      } catch {
        // A closing window can become inaccessible during cleanup.
      }
    },
  };
}

export function attachAudienceStreamToWindow(args: {
  identity: PresentationChannelIdentity;
  shareEpochId: string;
  stream: MediaStream;
  targetWindow: AudienceStreamBridgeWindow | null;
}): AudienceStreamBridgeResult {
  const bridgeResult = readAudienceStreamBridge(args.targetWindow);
  if (!bridgeResult.ok) return bridgeResult;

  try {
    return bridgeResult.bridge.attach({
      identity: args.identity,
      shareEpochId: args.shareEpochId,
      stream: args.stream,
    });
  } catch {
    return { code: "attach-failed", ok: false };
  }
}

export function observeAudienceStreamInWindow(args: {
  identity: PresentationChannelIdentity;
  onChange: (active: ActiveAudienceStream | null) => void;
  targetWindow: AudienceStreamBridgeWindow | null;
}): AudienceStreamBridgeObservation {
  const bridgeResult = readAudienceStreamBridge(args.targetWindow);
  if (!bridgeResult.ok) return bridgeResult;
  if (!bridgeResult.bridge.observe) {
    return { code: "bridge-unavailable", ok: false };
  }

  try {
    return bridgeResult.bridge.observe({
      identity: args.identity,
      onChange: args.onChange,
    });
  } catch {
    return { code: "access-denied", ok: false };
  }
}

export function detachAudienceStreamFromWindow(args: {
  identity: PresentationChannelIdentity;
  targetWindow: AudienceStreamBridgeWindow | null;
}): AudienceStreamBridgeResult {
  const bridgeResult = readAudienceStreamBridge(args.targetWindow);
  if (!bridgeResult.ok) return bridgeResult;

  try {
    return bridgeResult.bridge.detach({ identity: args.identity });
  } catch {
    return { code: "access-denied", ok: false };
  }
}

function readAudienceStreamBridge(
  targetWindow: AudienceStreamBridgeWindow | null,
):
  | { bridge: AudienceStreamBridge; ok: true }
  | { code: AudienceStreamBridgeFailureCode; ok: false } {
  if (!targetWindow || targetWindow.closed) {
    return { code: "window-closed", ok: false };
  }

  try {
    const bridge = (targetWindow as Record<string, unknown>)[
      audienceStreamBridgeKey
    ];
    if (!isAudienceStreamBridge(bridge)) {
      return { code: "bridge-unavailable", ok: false };
    }
    return { bridge, ok: true };
  } catch {
    return { code: "access-denied", ok: false };
  }
}

function isAudienceStreamBridge(value: unknown): value is AudienceStreamBridge {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { attach?: unknown }).attach === "function" &&
    typeof (value as { detach?: unknown }).detach === "function"
  );
}

function matchesIdentity(
  left: PresentationChannelIdentity,
  right: PresentationChannelIdentity,
) {
  return left.deckId === right.deckId && left.sessionId === right.sessionId;
}

function readCurrentWindow(): AudienceStreamBridgeWindow | undefined {
  return typeof window === "undefined"
    ? undefined
    : (window as unknown as AudienceStreamBridgeWindow);
}
