import type { ProjectMember } from "@orbit/shared";
import { IconCheck, IconTrash, IconUserPlus, IconUsers } from "@tabler/icons-react";
import {
  OrbitButton,
  OrbitDialog,
  OrbitEmptyState,
  OrbitField,
  OrbitIconButton,
  OrbitInput,
  OrbitSelect,
  OrbitTabs
} from "../../../../components/ui";
import type { ShareRole } from "../api/projectMembersApi";

export type ShareAccessTab = "status" | "requests";
export type LocalShareMember = ProjectMember;
export type LocalShareRequest = ProjectMember & { role: Exclude<ShareRole, "owner"> };

export function ShareAccessModal(props: {
  activeTab: ShareAccessTab;
  actionError: string;
  actionLabel: string;
  inviteEmail: string;
  inviteRole: Exclude<ShareRole, "owner">;
  isLoading: boolean;
  members: LocalShareMember[];
  requests: LocalShareRequest[];
  onClose: () => void;
  onInvite: () => void;
  onInviteEmailChange: (email: string) => void;
  onInviteRoleChange: (role: Exclude<ShareRole, "owner">) => void;
  onMemberRemove: (email: string) => void;
  onMemberRoleChange: (email: string, role: ShareRole) => void;
  onRequestStatusChange: (email: string, status: "accepted" | "rejected") => void;
  onTabChange: (tab: ShareAccessTab) => void;
}) {
  return (
    <OrbitDialog className="orbit-share-dialog redesign-dark" description="사용자를 초대하고 프로젝트 접근 요청을 관리합니다." onClose={props.onClose} open title="프로젝트 공유">
      <OrbitTabs activeTab={props.activeTab} ariaLabel="공유 관리" onChange={(tab) => props.onTabChange(tab as ShareAccessTab)} tabs={[{ id: "status", label: `함께 작업 중 ${props.members.length}` }, { id: "requests", label: `승인 요청 ${props.requests.length}` }]}>
        {props.activeTab === "status" ? (
          <div className="orbit-share-panel">
            <section className="orbit-share-invite" aria-labelledby="orbit-share-invite-title">
              <header><span><IconUserPlus aria-hidden="true" size={20} /></span><div><h3 id="orbit-share-invite-title">사용자 초대</h3><p>이메일과 권한을 선택해 프로젝트에 초대하세요.</p></div></header>
              <div>
                <OrbitField id="orbit-share-email" label="이메일"><OrbitInput onChange={(event) => props.onInviteEmailChange(event.currentTarget.value)} placeholder="name@company.com" type="email" value={props.inviteEmail} /></OrbitField>
                <OrbitField id="orbit-share-role" label="권한"><OrbitSelect onChange={(event) => props.onInviteRoleChange(event.currentTarget.value as Exclude<ShareRole, "owner">)} value={props.inviteRole}><option value="editor">편집 가능</option><option value="viewer">보기 전용</option></OrbitSelect></OrbitField>
                <OrbitButton disabled={props.isLoading} onClick={props.onInvite}>초대</OrbitButton>
              </div>
            </section>

            <section className="orbit-share-list" aria-label="권한이 있는 사용자">
              <header><IconUsers aria-hidden="true" size={19} /><h3>참여자</h3><span>{props.members.length}명</span></header>
              {props.members.length ? props.members.map((member) => (
                <div className="orbit-share-member" key={member.userId}>
                  <span className="orbit-share-avatar">{member.email.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{member.email}</strong><small>{member.role === "owner" ? "프로젝트 소유자" : "프로젝트 참여자"}</small></span>
                  <OrbitSelect aria-label={`${member.email} 권한 수정`} onChange={(event) => props.onMemberRoleChange(member.email, event.currentTarget.value as ShareRole)} value={member.role}><option value="viewer">보기 전용</option><option value="editor">편집 가능</option><option value="owner">소유자</option></OrbitSelect>
                  <OrbitIconButton aria-label={`${member.email} 권한 회수`} disabled={member.role === "owner" || props.isLoading} onClick={() => props.onMemberRemove(member.email)} variant="plain"><IconTrash aria-hidden="true" size={17} /></OrbitIconButton>
                </div>
              )) : <OrbitEmptyState description="이메일로 사용자를 초대해 함께 편집할 수 있습니다." title="아직 참여자가 없습니다." />}
            </section>
          </div>
        ) : (
          <section className="orbit-share-list" aria-label="권한 요청 목록">
            {props.requests.length ? props.requests.map((request) => (
              <div className="orbit-share-member request" key={request.userId}>
                <span className="orbit-share-avatar">{request.email.slice(0, 1).toUpperCase()}</span>
                <span><strong>{request.email}</strong><small>{request.role === "editor" ? "편집 권한 요청" : "보기 권한 요청"}</small></span>
                <div><OrbitButton icon={<IconCheck aria-hidden="true" size={16} />} onClick={() => props.onRequestStatusChange(request.email, "accepted")} variant="secondary">승인</OrbitButton><OrbitButton onClick={() => props.onRequestStatusChange(request.email, "rejected")} variant="quiet">거절</OrbitButton></div>
              </div>
            )) : <OrbitEmptyState description="새 요청이 도착하면 이 탭에서 승인하거나 거절할 수 있습니다." title="대기 중인 요청이 없습니다." />}
          </section>
        )}
      </OrbitTabs>
      {props.isLoading ? <p className="orbit-share-message" role="status">공유 정보를 불러오는 중입니다.</p> : null}
      {props.actionLabel ? <p className="orbit-share-message success" role="status">{props.actionLabel}</p> : null}
      {props.actionError ? <p className="orbit-share-message error" role="alert">{props.actionError}</p> : null}
    </OrbitDialog>
  );
}
