import { HttpException, HttpStatus } from "@nestjs/common";

export const asyncJobAdmissionDrainingError = {
  code: "ASYNC_JOB_ADMISSION_DRAINING",
  message: "Asynchronous job admission is temporarily draining.",
} as const;

export function isAsyncJobAdmissionDraining() {
  return process.env.ASYNC_JOB_ADMISSION_MODE === "drain";
}

export function assertAsyncJobAdmissionOpen() {
  if (!isAsyncJobAdmissionDraining()) return;

  throw new HttpException(
    asyncJobAdmissionDrainingError,
    HttpStatus.SERVICE_UNAVAILABLE,
  );
}
