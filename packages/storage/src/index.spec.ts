import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { LocalMinioStorage } from "./index";

describe("ORBIT-93 S3-compatible storage presign", () => {
  it("creates a browser-facing MinIO PUT URL without contacting the bucket", async () => {
    const storage = new LocalMinioStorage({
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
      bucket: "orbit-local",
      region: "ap-northeast-2",
      accessKeyId: "orbit",
      secretAccessKey: "orbit-password",
      forcePathStyle: true,
    });

    const upload = await storage.createUploadUrl({
      key: "projects/project_1/assets/file_1/report.pdf",
      contentType: "application/pdf",
      expiresInSeconds: 900,
    });
    const url = new URL(upload.url);

    expect(upload.method).toBe("PUT");
    expect(upload.headers).toEqual({ "content-type": "application/pdf" });
    expect(url.origin).toBe("http://localhost:9000");
    expect(url.pathname).toBe(
      "/orbit-local/projects/project_1/assets/file_1/report.pdf",
    );
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("streams object content without buffering and preserves response metadata", async () => {
    const storage = new LocalMinioStorage({
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
      bucket: "orbit-local",
      region: "ap-northeast-2",
      accessKeyId: "orbit",
      secretAccessKey: "orbit-password",
      forcePathStyle: true,
    });
    const source = Readable.from([Buffer.from("slide-image")]);
    const send = vi.fn(async () => ({
      Body: source,
      ContentLength: 11,
      ContentType: "image/webp",
      ETag: '"storage-etag"',
    }));
    (
      storage as unknown as {
        internalClient: { send: typeof send };
      }
    ).internalClient.send = send;

    const result = await storage.getObjectStream(
      "projects/project_1/assets/file_1-slide.webp",
    );
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) {
      chunks.push(Buffer.from(chunk));
    }

    expect(Buffer.concat(chunks).toString()).toBe("slide-image");
    expect(result).toMatchObject({
      contentLength: 11,
      contentType: "image/webp",
      etag: '"storage-etag"',
    });
    expect(send).toHaveBeenCalledOnce();
  });

  it("uses the requested expiry for a signed read URL", async () => {
    const storage = new LocalMinioStorage({
      endpoint: "http://minio:9000",
      publicEndpoint: "http://localhost:9000",
      bucket: "orbit-local",
      region: "ap-northeast-2",
      accessKeyId: "orbit",
      secretAccessKey: "orbit-password",
      forcePathStyle: true,
    });

    const url = new URL(
      await storage.getSignedReadUrl(
        "projects/project_1/assets/file_audio_1/rehearsal.webm",
        300,
      ),
    );

    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
  });
});
