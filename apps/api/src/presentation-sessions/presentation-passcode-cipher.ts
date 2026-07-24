import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

type EncryptionKey = {
  key: Buffer;
  version: number;
};

export type EncryptedPresentationPasscode = {
  ciphertext: string;
  keyVersion: number;
};

export class PresentationPasscodeCipher {
  private readonly keys: Map<number, Buffer>;

  constructor(private readonly current: EncryptionKey, previous?: EncryptionKey) {
    this.keys = new Map([[current.version, current.key]]);
    if (previous) this.keys.set(previous.version, previous.key);
  }

  static fromEnvironment(
    env: NodeJS.ProcessEnv = process.env
  ): PresentationPasscodeCipher {
    if (
      !env.PRESENTATION_PASSCODE_ENCRYPTION_KEY?.trim() &&
      (env.NODE_ENV === "test" || env.APP_ENV === "test")
    ) {
      return new PresentationPasscodeCipher({
        key: Buffer.alloc(32, 0),
        version: 1
      });
    }
    const current = readKey(
      env.PRESENTATION_PASSCODE_ENCRYPTION_KEY,
      env.PRESENTATION_PASSCODE_ENCRYPTION_KEY_VERSION,
      "PRESENTATION_PASSCODE_ENCRYPTION_KEY"
    );
    const hasPreviousKey = Boolean(
      env.PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY?.trim()
    );
    const hasPreviousVersion = Boolean(
      env.PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY_VERSION?.trim()
    );
    if (hasPreviousKey !== hasPreviousVersion) {
      throw new Error(
        "Previous presentation passcode encryption key and version must be configured together"
      );
    }
    const previous = hasPreviousKey
      ? readKey(
          env.PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY,
          env.PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY_VERSION,
          "PRESENTATION_PASSCODE_ENCRYPTION_PREVIOUS_KEY"
        )
      : undefined;

    if (previous?.version === current.version) {
      throw new Error(
        "Presentation passcode encryption key versions must be unique"
      );
    }
    return new PresentationPasscodeCipher(current, previous);
  }

  encrypt(passcode: string, sessionId: string): EncryptedPresentationPasscode {
    if (!/^\d{4}$/.test(passcode)) {
      throw new Error("Presentation passcode must contain four digits");
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.current.key, iv);
    cipher.setAAD(aad(sessionId));
    const encrypted = Buffer.concat([
      cipher.update(passcode, "utf8"),
      cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return {
      ciphertext: [
        "gcm1",
        iv.toString("base64url"),
        tag.toString("base64url"),
        encrypted.toString("base64url")
      ].join("."),
      keyVersion: this.current.version
    };
  }

  decrypt(
    ciphertext: string,
    keyVersion: number,
    sessionId: string
  ): string {
    const key = this.keys.get(keyVersion);
    if (!key) throw new Error("Presentation passcode encryption key unavailable");
    const [format, encodedIv, encodedTag, encodedValue, ...rest] =
      ciphertext.split(".");
    if (
      format !== "gcm1" ||
      !encodedIv ||
      !encodedTag ||
      !encodedValue ||
      rest.length > 0
    ) {
      throw new Error("Presentation passcode ciphertext is invalid");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(encodedIv, "base64url")
    );
    decipher.setAAD(aad(sessionId));
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    const value = Buffer.concat([
      decipher.update(Buffer.from(encodedValue, "base64url")),
      decipher.final()
    ]).toString("utf8");
    if (!/^\d{4}$/.test(value)) {
      throw new Error("Presentation passcode ciphertext is invalid");
    }
    return value;
  }
}

function readKey(
  encodedKey: string | undefined,
  rawVersion: string | undefined,
  name: string
): EncryptionKey {
  if (!encodedKey?.trim()) throw new Error(`${name} is required`);
  const key = Buffer.from(encodedKey.trim(), "base64");
  if (key.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes`);
  }
  const version = Number(rawVersion);
  if (!Number.isInteger(version) || version < 1 || version > 32767) {
    throw new Error(`${name}_VERSION must be an integer from 1 to 32767`);
  }
  return { key, version };
}

function aad(sessionId: string) {
  return Buffer.from(`orbit:presentation-passcode:${sessionId}`, "utf8");
}
