import { loadOrbitConfig } from "@orbit/config";
import { LocalMinioStorage, PurposeRoutedStorage, S3Storage, type StoragePort } from "@orbit/storage";

export function workerStorage(): StoragePort {
  const config = loadOrbitConfig(process.env, { service: "worker" });
  const workerReadEndpoint = config.S3_ENDPOINT ?? config.S3_PUBLIC_ENDPOINT;
  const assetsBucket = config.S3_ASSETS_BUCKET || config.S3_BUCKET;

  if (config.STORAGE_DRIVER === "s3") {
    const assets = new S3Storage({
      endpoint: config.S3_ENDPOINT,
      publicEndpoint: workerReadEndpoint,
      bucket: assetsBucket,
      region: config.S3_REGION,
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
    const privateAudio = config.S3_PRIVATE_AUDIO_BUCKET
      ? new S3Storage({
          endpoint: config.S3_ENDPOINT,
          publicEndpoint: workerReadEndpoint,
          bucket: config.S3_PRIVATE_AUDIO_BUCKET,
          region: config.S3_REGION,
          accessKeyId: config.AWS_ACCESS_KEY_ID,
          secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        })
      : null;
    return new PurposeRoutedStorage(assets, privateAudio);
  }

  return new PurposeRoutedStorage(new LocalMinioStorage({
    endpoint: config.S3_ENDPOINT,
    publicEndpoint: workerReadEndpoint,
    bucket: assetsBucket,
    region: config.S3_REGION,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    forcePathStyle: config.S3_FORCE_PATH_STYLE,
  }), null);
}
