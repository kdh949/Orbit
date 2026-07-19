import { createDemoDeck } from "@orbit/editor-core"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  autoCreate: vi.fn(),
  clientRequestId: vi.fn(),
  runtimeConfig: vi.fn(),
  waitForJob: vi.fn()
}))

vi.mock("../../rehearsal/stt/liveSttRuntimeConfig", () => ({
  fetchLiveSttRuntimeConfig: mocks.runtimeConfig
}))
vi.mock("./slideQuestionGuideApi", () => ({
  autoCreateSlideQuestionGuides: mocks.autoCreate,
  createAutoSlideQuestionGuidesClientRequestId: mocks.clientRequestId,
  waitForSlideQuestionGuideJob: mocks.waitForJob
}))

import {
  runAutoSlideQuestionGuideGeneration,
  shouldStartAutoSlideQuestionGuides
} from "./useAutoSlideQuestionGuides"

describe("runAutoSlideQuestionGuideGeneration", () => {
  beforeEach(() => {
    mocks.autoCreate.mockReset()
    mocks.clientRequestId.mockReset().mockResolvedValue("stable-client-request")
    mocks.runtimeConfig.mockReset().mockResolvedValue({ slideQuestionGuidesEnabled: true })
    mocks.waitForJob.mockReset().mockResolvedValue({ status: "succeeded" })
  })

  it("does not call the auto API when the runtime flag is disabled", async () => {
    mocks.runtimeConfig.mockResolvedValue({
      slideQuestionGuidesEnabled: false
    })

    await runAutoSlideQuestionGuideGeneration({
      deck: createDemoDeck(),
      isActive: () => true,
      onRefresh: vi.fn(),
      onStatus: vi.fn(),
      projectId: "project-1"
    })

    expect(mocks.autoCreate).not.toHaveBeenCalled()
  })

  it("does not call the auto API when the runtime flag check fails", async () => {
    mocks.runtimeConfig.mockRejectedValue(new Error("runtime config unavailable"))

    await runAutoSlideQuestionGuideGeneration({
      deck: createDemoDeck(),
      isActive: () => true,
      onRefresh: vi.fn(),
      onStatus: vi.fn(),
      projectId: "project-1"
    })

    expect(mocks.autoCreate).not.toHaveBeenCalled()
  })

  it("polls queued jobs, refreshes completed guides, and leaves failures retryable", async () => {
    const demoDeck = createDemoDeck()
    const [first, second] = demoDeck.slides
    if (!first || !second) throw new Error("The demo deck needs two slides.")
    const third = { ...second, slideId: "slide_auto_3", order: 3 }
    const deck = { ...demoDeck, slides: [first, second, third] }
    mocks.autoCreate.mockResolvedValue({
      deckId: deck.deckId,
      deckVersion: deck.version,
      slides: [
        {
          status: "accepted",
          slideId: first.slideId,
          guideId: "guide-1",
          job: job("job-1", "queued")
        },
        {
          status: "accepted",
          slideId: second.slideId,
          guideId: "guide-2",
          job: job("job-2", "succeeded")
        },
        {
          status: "failed",
          slideId: third.slideId,
          errorCode: "ENQUEUE_FAILED"
        }
      ]
    })
    const statuses: Array<[string, string]> = []
    const onRefresh = vi.fn()

    await runAutoSlideQuestionGuideGeneration({
      deck,
      isActive: () => true,
      onRefresh,
      onStatus: (slideId, status) => statuses.push([slideId, status]),
      projectId: deck.projectId
    })

    expect(mocks.autoCreate).toHaveBeenCalledTimes(1)
    expect(mocks.waitForJob).toHaveBeenCalledWith("job-1")
    expect(statuses).toContainEqual([first.slideId, "generating"])
    expect(statuses).toContainEqual([first.slideId, "idle"])
    expect(statuses).toContainEqual([second.slideId, "idle"])
    expect(statuses).toContainEqual([third.slideId, "failed"])
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it("does not update UI state after the run becomes inactive", async () => {
    let active = true
    mocks.clientRequestId.mockImplementation(async () => {
      active = false
      return "stable-client-request"
    })
    mocks.autoCreate.mockResolvedValue({
      deckId: "deck-1",
      deckVersion: 1,
      slides: []
    })
    const onStatus = vi.fn()

    await runAutoSlideQuestionGuideGeneration({
      deck: createDemoDeck(),
      isActive: () => active,
      onRefresh: vi.fn(),
      onStatus,
      projectId: "project-1"
    })

    expect(mocks.autoCreate).not.toHaveBeenCalled()
    expect(onStatus).not.toHaveBeenCalled()
  })
})

describe("shouldStartAutoSlideQuestionGuides", () => {
  it("starts once per project mount and skips read-only access", () => {
    const persistedDeck = createDemoDeck()
    const base = {
      projectId: persistedDeck.projectId
    }

    expect(shouldStartAutoSlideQuestionGuides({
      ...base,
      canGenerate: false,
      startedProjectId: null
    })).toBe(false)
    expect(shouldStartAutoSlideQuestionGuides({
      ...base,
      canGenerate: true,
      startedProjectId: null
    })).toBe(true)
    expect(shouldStartAutoSlideQuestionGuides({
      ...base,
      canGenerate: true,
      startedProjectId: persistedDeck.projectId
    })).toBe(false)
  })
})

function job(jobId: string, status: "queued" | "succeeded") {
  return {
    jobId,
    projectId: "project-1",
    type: "slide-question-guide-generation",
    status,
    progress: status === "queued" ? 0 : 100,
    message: status,
    result: null,
    error: null,
    createdAt: "2026-07-19T00:00:00.000Z",
    updatedAt: "2026-07-19T00:00:00.000Z"
  }
}
