import type { Deck } from "@orbit/shared"
import { useEffect, useRef, useState } from "react"

import { fetchLiveSttRuntimeConfig } from "../../rehearsal/stt/liveSttRuntimeConfig"
import {
  autoCreateSlideQuestionGuides,
  createAutoSlideQuestionGuidesClientRequestId,
  waitForSlideQuestionGuideJob
} from "./slideQuestionGuideApi"

export type AutoSlideQuestionGuideStatus = "idle" | "generating" | "failed"

export function useAutoSlideQuestionGuides(input: {
  canGenerate: boolean
  persistedDeck: Deck | undefined
  projectId: string
}) {
  const [statusBySlideId, setStatusBySlideId] = useState<
    Record<string, AutoSlideQuestionGuideStatus>
  >({})
  const [refreshToken, setRefreshToken] = useState(0)
  const startedProjectIdRef = useRef<string | null>(null)
  const runIdRef = useRef(0)

  useEffect(
    () => () => {
      runIdRef.current += 1
    },
    []
  )

  useEffect(() => {
    runIdRef.current += 1
    startedProjectIdRef.current = null
    setStatusBySlideId({})
  }, [input.projectId])

  useEffect(() => {
    if (!input.canGenerate) runIdRef.current += 1
  }, [input.canGenerate])

  useEffect(() => {
    if (!input.persistedDeck || !shouldStartAutoSlideQuestionGuides({
      canGenerate: input.canGenerate,
      projectId: input.projectId,
      startedProjectId: startedProjectIdRef.current
    })) {
      return
    }
    startedProjectIdRef.current = input.projectId
    const runId = ++runIdRef.current
    setStatusBySlideId({})
    void runAutoSlideQuestionGuideGeneration({
      deck: input.persistedDeck,
      isActive: () => runIdRef.current === runId,
      onRefresh: () => setRefreshToken((current) => current + 1),
      onStatus: (slideId, status) => {
        setStatusBySlideId((current) => ({ ...current, [slideId]: status }))
      },
      projectId: input.projectId
    })
  }, [input.canGenerate, input.persistedDeck, input.projectId])

  return { refreshToken, statusBySlideId }
}

export function shouldStartAutoSlideQuestionGuides(input: {
  canGenerate: boolean
  projectId: string
  startedProjectId: string | null
}) {
  return input.canGenerate && input.startedProjectId !== input.projectId
}

export async function runAutoSlideQuestionGuideGeneration(input: {
  deck: Deck
  isActive: () => boolean
  onRefresh: () => void
  onStatus: (slideId: string, status: AutoSlideQuestionGuideStatus) => void
  projectId: string
}) {
  let runtimeConfig
  try {
    runtimeConfig = await fetchLiveSttRuntimeConfig()
  } catch {
    return
  }
  if (!input.isActive() || !runtimeConfig.slideQuestionGuidesEnabled) return

  let response
  try {
    const clientRequestId = await createAutoSlideQuestionGuidesClientRequestId({
      projectId: input.projectId,
      deckId: input.deck.deckId,
      deckVersion: input.deck.version
    })
    if (!input.isActive()) return
    response = await autoCreateSlideQuestionGuides({
      projectId: input.projectId,
      clientRequestId,
      deckId: input.deck.deckId,
      expectedDeckVersion: input.deck.version
    })
  } catch {
    if (input.isActive()) {
      input.deck.slides.forEach((slide) => input.onStatus(slide.slideId, "failed"))
    }
    return
  }

  await Promise.all(
    response.slides.map(async (slide) => {
      if (!input.isActive()) return
      if (slide.status === "failed" || slide.job.status === "failed") {
        input.onStatus(slide.slideId, "failed")
        return
      }
      if (slide.job.status === "succeeded") {
        input.onStatus(slide.slideId, "idle")
        input.onRefresh()
        return
      }

      input.onStatus(slide.slideId, "generating")
      try {
        await waitForSlideQuestionGuideJob(slide.job.jobId)
        if (!input.isActive()) return
        input.onStatus(slide.slideId, "idle")
        input.onRefresh()
      } catch {
        if (input.isActive()) input.onStatus(slide.slideId, "failed")
      }
    })
  )
}
