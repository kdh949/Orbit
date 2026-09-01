import { BullMQOtel, BullMQOTelSpan } from "bullmq-otel";

const REDACTED_BULLMQ_ATTRIBUTE_KEYS = new Set([
  "bullmq.job.deduplication.key",
  "bullmq.job.failed.reason",
  "bullmq.job.id",
  "bullmq.job.ids",
  "bullmq.job.key",
  "bullmq.job.options",
  "bullmq.job.progress",
  "bullmq.job.result",
  "bullmq.job.scheduler.id",
  "bullmq.worker.id",
]);

export function isRedactedBullMqAttribute(key: string): boolean {
  return REDACTED_BULLMQ_ATTRIBUTE_KEYS.has(key);
}

function redactBullMqSpan(span: BullMQOTelSpan): BullMQOTelSpan {
  const setAttribute = span.setAttribute.bind(span);
  const setAttributes = span.setAttributes.bind(span);
  const addEvent = span.addEvent.bind(span);

  span.setAttribute = (key, value) => {
    if (!isRedactedBullMqAttribute(key)) setAttribute(key, value);
  };
  span.setAttributes = (attributes) => {
    setAttributes(
      Object.fromEntries(
        Object.entries(attributes).filter(
          ([key]) => !isRedactedBullMqAttribute(key),
        ),
      ),
    );
  };
  span.addEvent = (name, attributes, time) => {
    addEvent(
      name,
      attributes
        ? Object.fromEntries(
            Object.entries(attributes).filter(
              ([key]) => !isRedactedBullMqAttribute(key),
            ),
          )
        : undefined,
      time,
    );
  };

  return span;
}

export const bullMqTelemetry = new BullMQOtel({
  tracerName: "orbit-bullmq",
  version: "0.1.0",
});

const startSpan = bullMqTelemetry.tracer.startSpan.bind(bullMqTelemetry.tracer);
bullMqTelemetry.tracer.startSpan = (name, options, context) =>
  redactBullMqSpan(startSpan(name, options, context) as BullMQOTelSpan);
