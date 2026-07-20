import type { OoxmlSyncState } from "@orbit/shared";
import { jobSchema, type Job } from "../../../../../../../packages/shared/src/jobs/job.schema";
import { useEffect, useState } from "react";

import { ooxmlSyncJobEventName } from "../api/deckPersistenceApi";
import { getOoxmlSyncState, retryOoxmlSync } from "../api/editorJobApi";

export async function refreshOoxmlStateForTerminalJob(
  projectId: string,
  job: Job,
  loadState: typeof getOoxmlSyncState = getOoxmlSyncState,
): Promise<OoxmlSyncState | null> {
  return ["succeeded", "failed"].includes(job.status)
    ? loadState(projectId)
    : null;
}

export function useOoxmlSyncJob(projectId: string) {
  const [job, setJob] = useState<Job | null>(null);
  const [state, setState] = useState<OoxmlSyncState | null>(null);

  useEffect(() => {
    let isCancelled = false;
    void getOoxmlSyncState(projectId)
      .then((nextState) => {
        if (!isCancelled) {
          setState(nextState);
          setJob(nextState.job ?? null);
        }
      })
      .catch(() => undefined);
    return () => {
      isCancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    let isCancelled = false;
    function handleOoxmlSyncJob(event: Event) {
      const nextJob = jobSchema.parse((event as CustomEvent<Job>).detail);
      setJob(nextJob);
      if (["succeeded", "failed"].includes(nextJob.status)) {
        void refreshOoxmlStateForTerminalJob(projectId, nextJob)
          .then((nextState) => {
            if (!isCancelled && nextState) {
              setState(nextState);
              setJob(nextState.job ?? nextJob);
            }
          })
          .catch(() => undefined);
        return;
      }
      setState((current) =>
        current
          ? {
              ...current,
              status: "pending",
              retryable: false,
              job: nextJob
            }
          : current
      );
    }

    window.addEventListener(ooxmlSyncJobEventName, handleOoxmlSyncJob);
    return () => {
      isCancelled = true;
      window.removeEventListener(ooxmlSyncJobEventName, handleOoxmlSyncJob);
    };
  }, [projectId]);

  useEffect(() => {
    if (!job || ["succeeded", "failed"].includes(job.status)) return;

    let isCancelled = false;
    const intervalId = window.setInterval(() => {
      void fetch(`/api/jobs/${encodeURIComponent(job.jobId)}`)
        .then(async (response) => {
          if (!response.ok) return null;
          return jobSchema.parse(await response.json());
        })
        .then((nextJob) => {
          if (!isCancelled && nextJob) {
            setJob(nextJob);
            if (["succeeded", "failed"].includes(nextJob.status)) {
              void getOoxmlSyncState(projectId)
                .then((nextState) => {
                  if (!isCancelled) setState(nextState);
                })
                .catch(() => undefined);
            }
          }
        })
        .catch(() => undefined);
    }, 1800);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
  }, [job, projectId]);

  async function retry() {
    const nextState = await retryOoxmlSync(projectId);
    setState(nextState);
    setJob(nextState.job ?? null);
  }

  return { job, retry, state };
}
