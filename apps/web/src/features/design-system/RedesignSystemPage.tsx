import { IconBell, IconSparkles } from "@tabler/icons-react";
import { useState, type ReactNode } from "react";
import {
  OrbitBrand,
  OrbitButton,
  OrbitCard,
  OrbitDialog,
  OrbitField,
  OrbitIconButton,
  OrbitInput,
  OrbitSelect,
  OrbitStatus,
  OrbitTabs,
} from "../../components/ui";
import "./redesign-system-page.css";

const palette = [
  { className: "primary", label: "Primary", role: "핵심 행동과 활성 상태" },
  { className: "secondary", label: "Secondary", role: "창작 기능과 논리 상태" },
  { className: "tertiary", label: "Tertiary", role: "강조와 주의 신호" },
  { className: "surface", label: "Surface", role: "기본 작업면" },
  { className: "container", label: "Container", role: "구조적 위계" },
  { className: "inverse", label: "Inverse", role: "고대비 도구 표면" },
] as const;

const spacingScale = [
  { className: "1", label: "4px", token: "space-1" },
  { className: "2", label: "8px", token: "space-2" },
  { className: "4", label: "16px", token: "space-4" },
  { className: "6", label: "24px", token: "space-6" },
  { className: "8", label: "32px", token: "space-8" },
] as const;

const shapeScale = [
  { className: "default", label: "Control", token: "radius" },
  { className: "lg", label: "Card", token: "radius-lg" },
  { className: "xl", label: "Panel", token: "radius-xl" },
] as const;

export function RedesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [tab, setTab] = useState("chat");

  return (
    <div className="redesign-page system-page">
      <header className="system-topbar">
        <a aria-label="ORBIT 홈으로 이동" href="/">
          <OrbitBrand />
        </a>
        <span>Redesign System</span>
        <OrbitIconButton aria-label="알림" variant="plain">
          <IconBell aria-hidden="true" size={20} />
        </OrbitIconButton>
      </header>

      <main className="system-main">
        <section className="system-hero">
          <p className="redesign-eyebrow">ORBIT PRODUCT LANGUAGE</p>
          <h1>밝고 정밀한 발표 작업대</h1>
          <p>
            Electric Blue의 명확한 행동 신호와 절제된 표면 위계로 모든 제품
            화면을 연결합니다.
          </p>
        </section>

        <SystemSection
          title="Semantic color"
          description="색상 이름이 아니라 제품에서 수행하는 역할로 사용합니다."
        >
          <div className="system-palette">
            {palette.map((color) => (
              <OrbitCard className="system-swatch" key={color.label}>
                <span
                  className={`system-swatch-color system-swatch-${color.className}`}
                />
                <strong>{color.label}</strong>
                <small>{color.role}</small>
              </OrbitCard>
            ))}
          </div>
        </SystemSection>

        <SystemSection
          title="Typography"
          description="Pretendard 하나로 크기, 무게, 간격의 위계를 만듭니다."
        >
          <div className="system-type-list">
            <div>
              <small>Display</small>
              <strong className="system-type-display">생각을 발표로</strong>
            </div>
            <div>
              <small>Headline</small>
              <strong className="system-type-headline">
                다음 발표를 이어가세요
              </strong>
            </div>
            <div>
              <small>Body</small>
              <p>
                아이디어 정리부터 리허설 피드백까지 하나의 흐름으로 연결합니다.
              </p>
            </div>
          </div>
        </SystemSection>

        <SystemSection
          title="Spacing"
          description="4px 기반 토큰을 조합해 화면 밀도와 정렬 리듬을 일관되게 유지합니다."
        >
          <div className="system-space-list">
            {spacingScale.map((space) => (
              <div key={space.token}>
                <code>--redesign-{space.token}</code>
                <span
                  aria-hidden="true"
                  className={`system-space-bar system-space-${space.className}`}
                />
                <small>{space.label}</small>
              </div>
            ))}
          </div>
        </SystemSection>

        <SystemSection
          title="Shape &amp; elevation"
          description="형태는 역할에 맞는 세 단계 radius를, 깊이는 경계와 제한된 shadow를 사용합니다."
        >
          <div className="system-shape-grid">
            {shapeScale.map((shape) => (
              <div
                className={`system-shape system-shape-${shape.className}`}
                key={shape.token}
              >
                <strong>{shape.label}</strong>
                <code>--redesign-{shape.token}</code>
              </div>
            ))}
            <div className="system-shape system-elevation-raised">
              <strong>Raised</strong>
              <code>--redesign-shadow-raised</code>
            </div>
            <div className="system-shape system-elevation-overlay">
              <strong>Overlay</strong>
              <code>--redesign-shadow-overlay</code>
            </div>
          </div>
        </SystemSection>

        <SystemSection
          title="Motion"
          description="빠른 피드백은 150ms, 일반 전환은 220ms를 사용하며 reduced motion 환경을 존중합니다."
        >
          <div className="system-motion-list">
            <div>
              <span className="system-motion-dot system-motion-fast" />
              <strong>Fast</strong>
              <code>150ms</code>
            </div>
            <div>
              <span className="system-motion-dot system-motion-normal" />
              <strong>Normal</strong>
              <code>220ms</code>
            </div>
            <div>
              <span className="system-motion-dot system-motion-slow" />
              <strong>Slow</strong>
              <code>320ms</code>
            </div>
          </div>
        </SystemSection>

        <SystemSection
          title="Controls"
          description="모든 상태는 색상뿐 아니라 형태와 텍스트로도 구분합니다."
        >
          <div className="system-grid">
            <OrbitCard className="system-specimen">
              <h3>Buttons</h3>
              <div className="system-inline">
                <OrbitButton
                  icon={<IconSparkles aria-hidden="true" size={18} />}
                >
                  발표자료 만들기
                </OrbitButton>
                <OrbitButton variant="secondary">가져오기</OrbitButton>
                <OrbitButton variant="quiet">취소</OrbitButton>
                <OrbitButton loading>생성 중</OrbitButton>
              </div>
            </OrbitCard>

            <OrbitCard className="system-specimen">
              <h3>Status</h3>
              <div className="system-inline">
                <OrbitStatus>초안</OrbitStatus>
                <OrbitStatus tone="lilac">편집 중</OrbitStatus>
                <OrbitStatus tone="success">완료</OrbitStatus>
                <OrbitStatus tone="warning">확인 필요</OrbitStatus>
                <OrbitStatus tone="danger">오류</OrbitStatus>
              </div>
            </OrbitCard>

            <OrbitCard className="system-specimen">
              <h3>Fields</h3>
              <div className="system-form">
                <OrbitField
                  id="system-title"
                  label="발표 제목"
                  hint="목적이 드러나는 제목을 권장합니다."
                >
                  <OrbitInput defaultValue="2026 하반기 제품 전략" />
                </OrbitField>
                <OrbitField id="system-audience" label="청중">
                  <OrbitSelect defaultValue="team">
                    <option value="team">제품 팀</option>
                    <option value="external">외부 고객</option>
                  </OrbitSelect>
                </OrbitField>
              </div>
            </OrbitCard>

            <OrbitCard className="system-specimen">
              <h3>Tabs &amp; dialog</h3>
              <OrbitTabs
                activeTab={tab}
                ariaLabel="AI 도구"
                onChange={setTab}
                tabs={[
                  { id: "chat", label: "채팅" },
                  { id: "inspect", label: "검사" },
                ]}
              >
                <p className="system-tab-copy">
                  {tab === "chat"
                    ? "현재 슬라이드를 더 명확하게 다듬습니다."
                    : "가독성과 구조를 점검합니다."}
                </p>
              </OrbitTabs>
              <OrbitButton
                onClick={() => setDialogOpen(true)}
                variant="secondary"
              >
                모달 열기
              </OrbitButton>
            </OrbitCard>
          </div>
        </SystemSection>
      </main>

      <OrbitDialog
        description="새로운 시스템의 표면, 경계, 포커스 상태를 확인합니다."
        footer={
          <>
            <OrbitButton onClick={() => setDialogOpen(false)} variant="quiet">
              취소
            </OrbitButton>
            <OrbitButton onClick={() => setDialogOpen(false)}>확인</OrbitButton>
          </>
        }
        onClose={() => setDialogOpen(false)}
        open={dialogOpen}
        title="디자인 시스템 모달"
      >
        <p className="system-dialog-copy">
          오버레이는 강한 경계와 제한된 그림자만 사용합니다.
        </p>
      </OrbitDialog>
    </div>
  );
}

function SystemSection(props: {
  children: ReactNode;
  description: string;
  title: string;
}) {
  return (
    <section className="system-section">
      <header>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </header>
      {props.children}
    </section>
  );
}
