import { describe, expect, it } from "vitest";

import { PresentationPasscodeCipher } from "./presentation-passcode-cipher";

describe("PresentationPasscodeCipher", () => {
  it("encrypts and decrypts a passcode with session-bound AAD", () => {
    const cipher = new PresentationPasscodeCipher({
      key: Buffer.alloc(32, 7),
      version: 3
    });
    const encrypted = cipher.encrypt("4821", "session_1");

    expect(encrypted.keyVersion).toBe(3);
    expect(encrypted.ciphertext).not.toContain("4821");
    expect(cipher.decrypt(encrypted.ciphertext, 3, "session_1")).toBe("4821");
    expect(() =>
      cipher.decrypt(encrypted.ciphertext, 3, "session_other")
    ).toThrow();
  });

  it("decrypts ciphertext written with the previous key during rotation", () => {
    const previous = new PresentationPasscodeCipher({
      key: Buffer.alloc(32, 3),
      version: 2
    });
    const encrypted = previous.encrypt("1357", "session_2");
    const rotated = new PresentationPasscodeCipher(
      { key: Buffer.alloc(32, 7), version: 3 },
      { key: Buffer.alloc(32, 3), version: 2 }
    );

    expect(rotated.decrypt(encrypted.ciphertext, 2, "session_2")).toBe("1357");
  });
});
