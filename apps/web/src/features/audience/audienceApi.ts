import type { VerifyAudienceAccessSessionResponse } from "@orbit/shared/presentation";

export async function getAudienceSessionAccess(
  sessionId: string
): Promise<VerifyAudienceAccessSessionResponse> {
  const response = await fetch(
    `/api/v1/audience-sessions/${encodeURIComponent(sessionId)}/access`,
    {
      credentials: "include",
      method: "GET"
    }
  );

  if (!response.ok) {
    throw new Error("입장 링크 또는 비밀번호를 확인해 주세요.");
  }

  return response.json() as Promise<VerifyAudienceAccessSessionResponse>;
}

export async function verifyAudienceSessionPasscode(args: {
  passcode: string;
  sessionId: string;
}): Promise<VerifyAudienceAccessSessionResponse> {
  const response = await fetch(
    `/api/v1/audience-sessions/${encodeURIComponent(args.sessionId)}/verify`,
    {
      body: JSON.stringify({ passcode: args.passcode }),
      credentials: "include",
      headers: {
        "content-type": "application/json"
      },
      method: "POST"
    }
  );

  if (!response.ok) {
    throw new Error("입장 링크 또는 비밀번호를 확인해 주세요.");
  }

  return response.json() as Promise<VerifyAudienceAccessSessionResponse>;
}
