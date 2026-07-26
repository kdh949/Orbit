import { type Deck } from "@orbit/shared/deck";
import { slideQuestionGuideDeckTextHashInput } from "@orbit/shared/slide-practice";
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef, useState } from "react"

import { fetchLiveSttRuntimeConfig } from "../../../runtime/speech/stt/liveSttRuntimeConfig"
import { fetchDeck } from "../shell/api/deckPersistenceApi"
import {
  autoCreateSlideQuestionGuides,
  createAutoSlideQuestionGuidesClientRequestId,
  sha256Canonical,
  waitForSlideQuestionGuideJob
} from "./slideQuestionGuideApi"

export type AutoSlideQuestionGuideStatus = "idle" | "generating" | "failed"

export function useAutoSlideQuestionGuides(input: {
  canGenerate: boolean
  persistedDeck: Deck | undefined
  projectId: string
}) {
  const queryClient = useQueryClient()
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
      fetchLatestDeck: () => fetchDeck(input.projectId),
      isActive: () => runIdRef.current === runId,
      onDeckRefreshed: (deck) => {
        queryClient.setQueryData(["deck", input.projectId], deck)
      },
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
  fetchLatestDeck?: () => Promise<Deck>
  isActive: () => boolean
  onDeckRefreshed?: (deck: Deck) => void
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
  let requestDeck = input.deck
  try {
    response = await requestAutoSlideQuestionGuides(input, requestDeck)
  } catch (error) {
    if (!isAutoFreshnessConflict(error) || !input.fetchLatestDeck) {
      markAutoGenerationFailed(input, requestDeck)
      return
    }
    try {
      requestDeck = await input.fetchLatestDeck()
      if (!input.isActive()) return
      input.onDeckRefreshed?.(requestDeck)
      response = await requestAutoSlideQuestionGuides(input, requestDeck)
    } catch {
      markAutoGenerationFailed(input, requestDeck)
      return
    }
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

async function requestAutoSlideQuestionGuides(
  input: Pick<Parameters<typeof runAutoSlideQuestionGuideGeneration>[0], "isActive" | "projectId">,
  deck: Deck,
) {
  const clientRequestId = await createAutoSlideQuestionGuidesClientRequestId({
    projectId: input.projectId,
    deckId: deck.deckId,
    deckVersion: deck.version
  })
  const expectedDeckTextHash = await sha256Canonical(
    slideQuestionGuideDeckTextHashInput(deck),
  )
  if (!input.isActive()) throw new AutoGenerationInactiveError()
  return autoCreateSlideQuestionGuides({
    projectId: input.projectId,
    clientRequestId,
    deckId: deck.deckId,
    expectedDeckVersion: deck.version,
    contentHashVersion: "slide-text-v1",
    expectedDeckTextHash
  })
}

function markAutoGenerationFailed(
  input: Pick<Parameters<typeof runAutoSlideQuestionGuideGeneration>[0], "isActive" | "onStatus">,
  deck: Deck,
) {
  if (!input.isActive()) return
  deck.slides.forEach((slide) => input.onStatus(slide.slideId, "failed"))
}

function isAutoFreshnessConflict(error: unknown) {
  if (error instanceof AutoGenerationInactiveError) return false
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code)
    : ""
  return code === "SLIDE_QUESTION_DECK_CONTENT_HASH_MISMATCH"
    || code === "SLIDE_QUESTION_DECK_VERSION_MISMATCH"
}

class AutoGenerationInactiveError extends Error {}
