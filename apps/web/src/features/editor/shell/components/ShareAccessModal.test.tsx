import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ShareAccessModal } from "./ShareAccessModal";

const baseProps = { activeTab: "status" as const, actionError: "", actionLabel: "", inviteEmail: "", inviteRole: "editor" as const, isLoading: false, members: [], requests: [], onClose: vi.fn(), onInvite: vi.fn(), onInviteEmailChange: vi.fn(), onInviteRoleChange: vi.fn(), onMemberRemove: vi.fn(), onMemberRoleChange: vi.fn(), onRequestStatusChange: vi.fn(), onTabChange: vi.fn() };

describe("ShareAccessModal", () => {
  it("renders supported member management without link sharing", () => {
    const html = renderToStaticMarkup(<ShareAccessModal {...baseProps} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain("orbit-share-dialog redesign-dark");
    expect(html).toContain("함께 작업 중 0");
    expect(html).toContain("승인 요청 0");
    expect(html).toContain("사용자 초대");
    expect(html).not.toContain("링크 복사");
    expect(html).not.toContain("공개 링크");
  });

  it("renders approval actions for pending requests", () => {
    const html = renderToStaticMarkup(<ShareAccessModal {...baseProps} activeTab="requests" requests={[{ createdAt: "2026-07-10T00:00:00.000Z", email: "viewer@orbit.test", role: "viewer", status: "pending", userId: "user_viewer" }]} />);
    expect(html).toContain("보기 권한 요청");
    expect(html).toContain("승인");
    expect(html).toContain("거절");
  });
});
