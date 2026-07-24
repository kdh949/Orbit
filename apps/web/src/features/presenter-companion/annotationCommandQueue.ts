import type {
  PresentationCompanionAnnotationAck,
  PresentationCompanionAnnotationCommand,
} from "@orbit/shared";
import type { CompanionAnnotationCommandInput } from "./useCompanionSocket";

export const companionAnnotationQueueLimit = 256;
export const companionAnnotationAckTimeoutMs = 1_500;

type QueueTimer = ReturnType<typeof setTimeout>;

export class AnnotationCommandQueue {
  private acknowledgementTimer: QueueTimer | null = null;
  private inFlight: PresentationCompanionAnnotationCommand | null = null;
  private pending: CompanionAnnotationCommandInput[] = [];
  private revision = 0;
  private sequence = 0;

  constructor(
    private readonly options: {
      ackTimeoutMs?: number;
      createCommand: (
        input: CompanionAnnotationCommandInput,
        revision: number,
        sequence: number,
      ) => PresentationCompanionAnnotationCommand | null;
      emit: (command: PresentationCompanionAnnotationCommand) => void;
      onReconcile: (reason: "ack-timeout" | "overflow" | "rejected") => void;
      setTimer?: typeof setTimeout;
      clearTimer?: typeof clearTimeout;
    },
  ) {}

  enqueue(input: CompanionAnnotationCommandInput): boolean {
    if (
      this.pending.length + (this.inFlight ? 1 : 0) >=
      companionAnnotationQueueLimit
    ) {
      this.reconcile("overflow");
      return false;
    }
    this.pending.push(input);
    this.flush();
    return true;
  }

  acknowledge(acknowledgement: PresentationCompanionAnnotationAck): void {
    if (
      !this.inFlight ||
      this.inFlight.clientOperationId !== acknowledgement.clientOperationId
    ) {
      return;
    }
    this.clearAcknowledgementTimer();
    this.inFlight = null;
    if (!acknowledgement.accepted) {
      this.revision = acknowledgement.surfaceRevision;
      this.reconcile("rejected");
      return;
    }
    this.revision = acknowledgement.surfaceRevision;
    this.flush();
  }

  reset(surfaceRevision: number): void {
    this.clearAcknowledgementTimer();
    this.inFlight = null;
    this.pending = [];
    this.revision = surfaceRevision;
    this.sequence = 0;
  }

  pause(): void {
    this.clearAcknowledgementTimer();
    this.inFlight = null;
    this.pending = [];
  }

  dispose(): void {
    this.pause();
  }

  get size(): number {
    return this.pending.length + (this.inFlight ? 1 : 0);
  }

  private flush(): void {
    if (this.inFlight || this.pending.length === 0) return;
    const input = this.pending.shift()!;
    const command = this.options.createCommand(
      input,
      this.revision,
      this.sequence,
    );
    if (!command) {
      this.reconcile("rejected");
      return;
    }
    this.inFlight = command;
    this.sequence += 1;
    const setTimer = this.options.setTimer ?? setTimeout;
    this.acknowledgementTimer = setTimer(
      () => this.reconcile("ack-timeout"),
      this.options.ackTimeoutMs ?? companionAnnotationAckTimeoutMs,
    );
    this.options.emit(command);
  }

  private reconcile(reason: "ack-timeout" | "overflow" | "rejected"): void {
    this.pause();
    this.options.onReconcile(reason);
  }

  private clearAcknowledgementTimer(): void {
    if (this.acknowledgementTimer === null) return;
    const clearTimer = this.options.clearTimer ?? clearTimeout;
    clearTimer(this.acknowledgementTimer);
    this.acknowledgementTimer = null;
  }
}
