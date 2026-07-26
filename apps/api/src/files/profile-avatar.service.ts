import { avatarFileIdSchema, type AuthAvatar } from "@orbit/shared/auth";
import { StoragePort } from "@orbit/storage";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { DataSource } from "typeorm";
import { STORAGE_PORT } from "./files.service";

const maxProfileAvatarBytes = 3 * 1024 * 1024;
const avatarMimeTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

type AvatarRow = {
  storage_key: string;
  mime_type: string;
};

@Injectable()
export class ProfileAvatarService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  async storeUploadedAvatar(userId: string, mimeType: string, body: Buffer): Promise<AuthAvatar> {
    if (!avatarMimeTypes.has(mimeType)) {
      throw new BadRequestException("Only JPEG, PNG, and WebP profile images are supported.");
    }
    if (body.byteLength === 0 || body.byteLength > maxProfileAvatarBytes) {
      throw new BadRequestException("Profile image must be between 1 byte and 3MiB.");
    }
    if (!matchesImageSignature(mimeType, body)) {
      throw new BadRequestException("Profile image content does not match its MIME type.");
    }

    const fileId = `avatar_${randomUUID()}`;
    const storageKey = `avatars/${userId}/${fileId}.${fileExtension(mimeType)}`;
    await this.storage.putObject({
      key: storageKey,
      body,
      contentType: mimeType,
      purpose: "profile-avatar",
    });
    await this.dataSource.query(
      `
        INSERT INTO user_avatar_uploads (file_id, user_id, storage_key, mime_type, size)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [fileId, userId, storageKey, mimeType, body.byteLength],
    );
    return { kind: "uploaded", fileId };
  }

  async openUploadedAvatar(userId: string, fileId: string) {
    const parsedFileId = avatarFileIdSchema.safeParse(fileId);
    if (!parsedFileId.success) throw new NotFoundException("Profile image not found.");
    const rows = await this.dataSource.query<AvatarRow[]>(
      `
        SELECT storage_key, mime_type
        FROM user_avatar_uploads
        WHERE file_id = $1 AND user_id = $2
      `,
      [parsedFileId.data, userId],
    );
    const avatar = rows[0];
    if (!avatar) throw new NotFoundException("Profile image not found.");
    const stored = await this.storage.getObjectStream(avatar.storage_key);
    return { ...stored, contentType: avatar.mime_type };
  }

  async openCommunityAvatar(userId: string) {
    const rows = await this.dataSource.query<AvatarRow[]>(
      `
        SELECT uploads.storage_key, uploads.mime_type
        FROM users
        INNER JOIN user_avatar_uploads uploads
          ON uploads.file_id = users.avatar_id
          AND uploads.user_id = users.user_id
        WHERE users.user_id = $1
          AND users.avatar_type = 'uploaded'
      `,
      [userId],
    );
    const avatar = rows[0];
    if (!avatar) throw new NotFoundException("Profile image not found.");
    const stored = await this.storage.getObjectStream(avatar.storage_key);
    return { ...stored, contentType: avatar.mime_type };
  }
}

function fileExtension(mimeType: string): "jpg" | "png" | "webp" {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  return "webp";
}

function matchesImageSignature(mimeType: string, body: Buffer): boolean {
  if (mimeType === "image/jpeg") return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (mimeType === "image/png") return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return body.length >= 12 && body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP";
}
