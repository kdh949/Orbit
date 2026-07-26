export function redisConnectionOptions(redisUrl: string) {
  const url = new URL(redisUrl);
  if (!["redis:", "rediss:"].includes(url.protocol)) {
    throw new Error("REDIS_URL must use redis:// or rediss://.");
  }

  const db =
    url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined;
  if (db !== undefined && !Number.isInteger(db)) {
    throw new Error("REDIS_URL database index must be an integer.");
  }

  return {
    db,
    host: url.hostname,
    maxRetriesPerRequest: null,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    port: url.port ? Number(url.port) : 6379,
    tls: url.protocol === "rediss:" ? {} : undefined,
    username: url.username ? decodeURIComponent(url.username) : undefined,
  };
}
