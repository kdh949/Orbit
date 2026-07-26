import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import type { Socket as ClientSocket } from "socket.io-client";

import { fetchEditorSessionDebug } from "../api/editorSessionApi";
import type {
  EditorSessionDebugState,
  EditorSocketStatus,
  ProjectPresenceUser
} from "../editorSession.model";
import { toEditorErrorMessage } from "../utils/editorFileValidation";

export type {
  EditorSessionDebugState,
  EditorSocketStatus,
  ProjectPresenceUser
} from "../editorSession.model";

type ProjectPresenceEvent = {
  payload?: {
    projectId?: string;
    users?: ProjectPresenceUser[];
  };
};

export function useProjectPresence(args: {
  isDebugOpen: boolean;
  projectId: string;
}) {
  const { isDebugOpen, projectId } = args;
  const [users, setUsers] = useState<ProjectPresenceUser[]>([]);
  const [lastPresenceAt, setLastPresenceAt] = useState<string | null>(null);
  const [socketErrorMessage, setSocketErrorMessage] = useState("");
  const [socketId, setSocketId] = useState("");
  const [socketStatus, setSocketStatus] =
    useState<EditorSocketStatus>("disconnected");
  const [sessionDebug, setSessionDebug] = useState<EditorSessionDebugState>({
    message: "세션 정보를 아직 조회하지 않았습니다.",
    status: "idle"
  });

  useEffect(() => {
    const socket: ClientSocket = io({ withCredentials: true });
    setSocketStatus("connecting");
    setSocketErrorMessage("");

    function joinProjectRoom() {
      socket.emit("project:join", { projectId });
    }

    function handlePresence(event: ProjectPresenceEvent) {
      setUsers(normalizeProjectPresenceUsers(event, projectId));
      setLastPresenceAt(new Date().toISOString());
    }

    function handleConnect() {
      setSocketId(socket.id ?? "");
      setSocketStatus("connected");
      setSocketErrorMessage("");
      joinProjectRoom();
    }

    function handleConnectError(error: Error) {
      setSocketStatus("error");
      setSocketErrorMessage(error.message);
      setUsers([]);
    }

    function handleProjectError(error: { message?: string }) {
      setSocketStatus("error");
      setSocketErrorMessage(error.message ?? "Project socket join failed.");
      setUsers([]);
    }

    function handleDisconnect() {
      setSocketId("");
      setSocketStatus("disconnected");
      setUsers([]);
    }

    socket.on("connect", handleConnect);
    socket.on("connect_error", handleConnectError);
    socket.on("project:presence", handlePresence);
    socket.on("project:error", handleProjectError);
    socket.on("disconnect", handleDisconnect);

    if (socket.connected) handleConnect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("connect_error", handleConnectError);
      socket.off("project:presence", handlePresence);
      socket.off("project:error", handleProjectError);
      socket.off("disconnect", handleDisconnect);
      socket.disconnect();
    };
  }, [projectId]);

  useEffect(() => {
    if (!isDebugOpen) return;

    let isCancelled = false;
    setSessionDebug({
      message: "세션 정보를 불러오는 중입니다.",
      status: "loading"
    });
    void fetchEditorSessionDebug()
      .then((session) => {
        if (!isCancelled) setSessionDebug(session);
      })
      .catch((error) => {
        if (!isCancelled) {
          setSessionDebug({
            message: toEditorErrorMessage(error),
            status: "error"
          });
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isDebugOpen]);

  return {
    lastPresenceAt,
    sessionDebug,
    socketErrorMessage,
    socketId,
    socketStatus,
    users
  };
}

function normalizeProjectPresenceUsers(
  event: ProjectPresenceEvent,
  projectId: string
): ProjectPresenceUser[] {
  if (event.payload?.projectId !== projectId || !Array.isArray(event.payload.users)) {
    return [];
  }

  return event.payload.users.filter(
    (user): user is ProjectPresenceUser =>
      typeof user?.id === "string" &&
      user.id.length > 0 &&
      typeof user.connectedAt === "string" &&
      user.connectedAt.length > 0
  );
}

export function getPresenceUserLabel(user: ProjectPresenceUser) {
  return user.email || user.userId || user.id;
}

export function getPresenceUserInitial(user: ProjectPresenceUser) {
  const label = getPresenceUserLabel(user).trim();
  return label ? (label[0]?.toLocaleUpperCase() ?? "U") : "U";
}

export function formatSocketStatus(status: EditorSocketStatus) {
  if (status === "connected") return "연결됨";
  if (status === "connecting") return "연결 중";
  if (status === "error") return "오류";
  return "연결 끊김";
}

export function formatDebugDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatSessionRemaining(session: EditorSessionDebugState) {
  if (session.status === "idle" || session.status === "loading") {
    return session.message;
  }
  if (session.status === "error") return session.message;
  if (session.status !== "ready") return "-";

  const remainingMs = new Date(session.expiresAt).getTime() - Date.now();
  if (!Number.isFinite(remainingMs)) return "unknown";
  if (remainingMs <= 0) return "expired";
  return `${(remainingMs / (1000 * 60 * 60)).toFixed(1)}h`;
}
