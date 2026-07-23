import type { DiagnosticSink } from "../../diagnostics/diagnosticTypes";
import {
  type LiveSttBiasPhrase,
  type LiveSttError,
  type LiveSttPort,
  type LiveSttResult,
  type LiveSttResultSubscriptionOptions,
  type LiveSttSessionConfig,
  type LiveSttUnsubscribe
} from "./liveSttPort";

export class DiagnosticLiveSttPort implements LiveSttPort {
  private readonly resultSubscribers = new Map<
    (result: LiveSttResult) => void,
    string
  >();
  private readonly errorSubscribers = new Set<(error: LiveSttError) => void>();
  private readonly unsubscribeInnerResult: LiveSttUnsubscribe;
  private readonly unsubscribeInnerError: LiveSttUnsubscribe;
  private speechSequence = 0;
  private anonymousSubscriberSequence = 0;

  constructor(
    private readonly inner: LiveSttPort,
    private readonly diagnostics: DiagnosticSink
  ) {
    this.unsubscribeInnerResult = inner.onResult(this.handleResult);
    this.unsubscribeInnerError = inner.onError(this.handleError);
  }

  get engineId() {
    return this.inner.engineId;
  }

  get capabilities() {
    return this.inner.capabilities;
  }

  async start(config: LiveSttSessionConfig) {
    this.speechSequence = 0;
    const phrases = config.biasPhrases ?? [];
    this.emitBiasRequested(phrases, "start");
    this.diagnostics.emit({
      stage: "stt",
      name: "stt.session.start_requested",
      outcome: "started",
      data: {
        engine: this.engineId,
        language: config.language
      }
    });
    try {
      await this.inner.start(config);
      this.emitBiasCapability(phrases, "start");
      this.diagnostics.emit({
        stage: "stt",
        name: "stt.session.started",
        outcome: "accepted",
        data: {
          engine: this.engineId,
          capabilities: toDiagnosticCapabilities(this.capabilities)
        }
      });
    } catch (cause) {
      this.diagnostics.emit({
        stage: "stt",
        name: "stt.session.start_failed",
        outcome: "failed",
        reason: "ENGINE_START_FAILED",
        data: {
          engine: this.engineId,
          errorName: cause instanceof Error ? cause.name : "UnknownError"
        }
      });
      throw cause;
    }
  }

  async stop() {
    await this.inner.stop();
    this.diagnostics.emit({
      stage: "stt",
      name: "stt.session.stopped",
      outcome: "settled",
      data: { engine: this.engineId }
    });
  }

  async updateBiasPhrases(phrases: readonly LiveSttBiasPhrase[]) {
    this.emitBiasRequested(phrases, "update");
    try {
      await this.inner.updateBiasPhrases(phrases);
      this.emitBiasCapability(phrases, "update");
    } catch (cause) {
      this.diagnostics.emit({
        stage: "bias",
        name: "bias.submit_rejected",
        outcome: "failed",
        reason: "ENGINE_UPDATE_FAILED",
        data: {
          engine: this.engineId,
          phraseCount: phrases.length,
          errorName: cause instanceof Error ? cause.name : "UnknownError"
        }
      });
      throw cause;
    }
  }

  onResult(
    cb: (result: LiveSttResult) => void,
    options?: LiveSttResultSubscriptionOptions
  ): LiveSttUnsubscribe {
    this.anonymousSubscriberSequence += 1;
    this.resultSubscribers.set(
      cb,
      options?.subscriberId ?? `anonymous-${this.anonymousSubscriberSequence}`
    );
    return () => {
      this.resultSubscribers.delete(cb);
    };
  }

  onError(cb: (error: LiveSttError) => void): LiveSttUnsubscribe {
    this.errorSubscribers.add(cb);
    return () => {
      this.errorSubscribers.delete(cb);
    };
  }

  async dispose() {
    this.unsubscribeInnerResult();
    this.unsubscribeInnerError();
    this.resultSubscribers.clear();
    this.errorSubscribers.clear();
    await this.inner.dispose();
  }

  private readonly handleResult = (result: LiveSttResult) => {
    this.speechSequence += 1;
    const triggerTraceId =
      result.diagnosticTrace?.triggerTraceId ??
      this.diagnostics.createTriggerTraceId({
        ...(result.resultRevision === undefined
          ? {}
          : { resultRevision: result.resultRevision }),
        ...(result.utteranceId === undefined
          ? {}
          : { utteranceId: result.utteranceId })
      });
    const diagnosticTrace = {
      ...result.diagnosticTrace,
      speechSequence: this.speechSequence,
      ...(triggerTraceId === null ? {} : { triggerTraceId }),
      ...(result.utteranceId === undefined
        ? {}
        : { utteranceId: result.utteranceId }),
      ...(result.resultRevision === undefined
        ? {}
        : { resultRevision: result.resultRevision })
    };
    const deliveredResult: LiveSttResult = {
      ...result,
      diagnosticTrace
    };

    this.diagnostics.emit({
      stage: "stt",
      name: "stt.result.normalized",
      outcome: "accepted",
      trace: diagnosticTrace,
      data: {
        engine: this.engineId,
        text: result.text,
        normalizedText: result.text.trim().replace(/\s+/g, " "),
        isFinal: result.isFinal,
        timestampMs: [...result.timestampMs],
        confidence: {
          available: result.confidence !== undefined,
          value: result.confidence ?? null,
          source: result.confidence === undefined ? "unavailable" : "engine"
        },
        alternatives: (result.alternatives ?? []).map((alternative) => ({
          text: alternative.text,
          confidence: alternative.confidence ?? null
        }))
      }
    });

    for (const [subscriber, subscriberId] of this.resultSubscribers) {
      const startedAt = performance.now();
      this.diagnostics.emit({
        stage: "stt",
        name: "stt.subscriber.delivery_started",
        outcome: "started",
        trace: diagnosticTrace,
        data: { subscriberId }
      });
      try {
        subscriber(deliveredResult);
        this.diagnostics.emit({
          stage: "stt",
          name: "stt.subscriber.delivery_succeeded",
          outcome: "accepted",
          trace: diagnosticTrace,
          data: {
            subscriberId,
            durationMs: Math.max(0, performance.now() - startedAt)
          }
        });
      } catch (cause) {
        this.diagnostics.emit({
          level: "error",
          stage: "stt",
          name: "stt.subscriber.delivery_failed",
          outcome: "failed",
          reason: "SUBSCRIBER_THROW",
          trace: diagnosticTrace,
          data: {
            subscriberId,
            durationMs: Math.max(0, performance.now() - startedAt),
            errorName: cause instanceof Error ? cause.name : "UnknownError"
          }
        });
      }
    }
  };

  private readonly handleError = (error: LiveSttError) => {
    this.diagnostics.emit({
      level: "error",
      stage: "stt",
      name: "stt.engine.error",
      outcome: "failed",
      reason: error.code,
      data: {
        engine: this.engineId,
        errorName: error.name
      }
    });
    for (const subscriber of this.errorSubscribers) {
      subscriber(error);
    }
  };

  private emitBiasRequested(
    phrases: readonly LiveSttBiasPhrase[],
    source: "start" | "update"
  ) {
    this.diagnostics.emit({
      stage: "bias",
      name: "bias.requested",
      outcome: "received",
      data: {
        engine: this.engineId,
        source,
        phraseCount: phrases.length,
        phrases: phrases.map((phrase) => phrase.text)
      }
    });
  }

  private emitBiasCapability(
    phrases: readonly LiveSttBiasPhrase[],
    source: "start" | "update"
  ) {
    const supportedByEngine = this.capabilities.keywordBiasing;
    this.diagnostics.emit({
      stage: "bias",
      name: "bias.capability_checked",
      outcome: supportedByEngine ? "accepted" : "skipped",
      reason: supportedByEngine ? undefined : "ENGINE_BIAS_NOT_WIRED",
      data: {
        engine: this.engineId,
        source,
        requested: phrases.length > 0,
        phraseCount: phrases.length,
        supportedByEngine,
        submittedToEngine: supportedByEngine && phrases.length > 0,
        acknowledgedByEngine: false,
        rerankerUsed: false
      }
    });
  }
}

function toDiagnosticCapabilities(capabilities: LiveSttPort["capabilities"]) {
  return {
    onDevice: capabilities.onDevice,
    streaming: capabilities.streaming,
    keywordBiasing: capabilities.keywordBiasing,
    languages: [...capabilities.languages]
  };
}
