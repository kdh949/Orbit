export interface WorkerScheduler {
  readonly name: string;
  start(): void;
  stop(): Promise<void>;
}
