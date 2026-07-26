export type ProjectPresenceUser = {
  id: string;
  connectedAt: string;
  email?: string;
  userId?: string;
};

export type EditorSocketStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type EditorSessionDebugState =
  | { status: "idle" | "loading"; message: string }
  | {
      authenticatedAt: string;
      email: string;
      expiresAt: string;
      status: "ready";
      userId: string;
    }
  | { status: "error"; message: string };
