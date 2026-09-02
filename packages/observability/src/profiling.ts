export interface NodeProfilingConfig {
  applicationName: string;
  environment: string;
  sampleIntervalMicros: number;
  serverAddress: string;
  serviceVersion?: string;
}

interface PyroscopeCpuProfiler {
  init(config: {
    appName: string;
    serverAddress: string;
    tags: Record<string, string>;
    wall: {
      collectCpuTime: boolean;
      samplingIntervalMicros: number;
    };
  }): void;
  startCpuProfiling(): void;
}

type PyroscopeLoader = () => Promise<PyroscopeCpuProfiler>;

export function resolveNodeProfilingConfig(
  applicationName: string,
  env: NodeJS.ProcessEnv = process.env,
): NodeProfilingConfig | null {
  if (env.PYROSCOPE_ENABLED?.trim().toLowerCase() !== "true") return null;

  const serverAddress = env.PYROSCOPE_SERVER_ADDRESS?.trim();
  if (!serverAddress) {
    throw new Error(
      "PYROSCOPE_SERVER_ADDRESS is required when PYROSCOPE_ENABLED=true",
    );
  }
  const parsedServerAddress = new URL(serverAddress);
  if (!["http:", "https:"].includes(parsedServerAddress.protocol)) {
    throw new Error("PYROSCOPE_SERVER_ADDRESS must use http or https");
  }
  if (
    parsedServerAddress.username ||
    parsedServerAddress.password ||
    parsedServerAddress.search ||
    parsedServerAddress.hash
  ) {
    throw new Error(
      "PYROSCOPE_SERVER_ADDRESS must not contain credentials, query, or fragment",
    );
  }

  const sampleIntervalValue =
    env.PYROSCOPE_CPU_SAMPLE_INTERVAL_MICROS?.trim() || "20000";
  const sampleIntervalMicros = Number(sampleIntervalValue);
  if (
    !Number.isInteger(sampleIntervalMicros) ||
    sampleIntervalMicros < 10_000 ||
    sampleIntervalMicros > 1_000_000
  ) {
    throw new Error(
      "PYROSCOPE_CPU_SAMPLE_INTERVAL_MICROS must be an integer between 10000 and 1000000",
    );
  }

  const serviceVersion = env.OTEL_SERVICE_VERSION?.trim();
  return {
    applicationName,
    environment: env.APP_ENV?.trim() || "local",
    sampleIntervalMicros,
    serverAddress: parsedServerAddress.toString().replace(/\/+$/, ""),
    ...(serviceVersion ? { serviceVersion } : {}),
  };
}

export async function startNodeProfiling(
  applicationName: string,
  env: NodeJS.ProcessEnv = process.env,
  loadPyroscope: PyroscopeLoader = async () =>
    (await import("@pyroscope/nodejs")).default,
): Promise<boolean> {
  const config = resolveNodeProfilingConfig(applicationName, env);
  if (!config) return false;

  const pyroscope = await loadPyroscope();
  pyroscope.init({
    appName: config.applicationName,
    serverAddress: config.serverAddress,
    tags: {
      environment: config.environment,
      ...(config.serviceVersion
        ? { service_version: config.serviceVersion }
        : {}),
    },
    wall: {
      collectCpuTime: true,
      samplingIntervalMicros: config.sampleIntervalMicros,
    },
  });
  pyroscope.startCpuProfiling();
  return true;
}
