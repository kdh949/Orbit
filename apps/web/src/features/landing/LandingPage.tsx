import {
  IconAdjustmentsHorizontal,
  IconArrowLeft,
  IconArrowRight,
  IconChartBar,
  IconChevronDown,
  IconDeviceFloppy,
  IconFocusCentered,
  IconHistory,
  IconHome,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarRightCollapse,
  IconMessageCircle,
  IconMicrophone,
  IconPhotoPlus,
  IconPlayerPlay,
  IconPlus,
  IconPointer,
  IconRefresh,
  IconShape,
  IconShare,
  IconSparkles,
  IconTargetArrow,
  IconTypography,
  IconZoomIn,
  IconZoomOut,
} from "@tabler/icons-react";
import { GradientButton, OrbitBrand } from "../../components/ui";
import "../../styles/tokens.css";
import "./landing-page.css";

type Navigate = (path: string) => void;

const slidePreviews = [
  { label: "표지", variant: "cover" },
  { label: "문제 정의", variant: "quote" },
  { label: "핵심 전략", variant: "chart" },
  { label: "실행 계획", variant: "metrics" },
  { label: "성과 지표", variant: "summary" },
  { label: "시장 분석", variant: "quote" },
  { label: "제품 로드맵", variant: "metrics" },
];

export function LandingPage(props: { onNavigate: Navigate }) {
  return (
    <div className="landing-page">
      <header className="landing-header">
        <div className="landing-header-inner">
          <button
            aria-label="ORBIT 홈"
            className="landing-logo"
            onClick={() => window.scrollTo(0, 0)}
            type="button"
          >
            <OrbitBrand />
          </button>

          <div className="landing-header-actions">
            <button
              className="landing-login"
              onClick={() => props.onNavigate("/login")}
              type="button"
            >
              로그인
            </button>
            <GradientButton onClick={() => props.onNavigate("/signup")}>
              무료로 시작
            </GradientButton>
          </div>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <h1>
            생각을 발표로 바꾸는
            <br />
            가장 빠른 캔버스
          </h1>

          <div className="landing-hero-bottom">
            <div className="landing-hero-copy">
              <p className="landing-intro">
                AI로 아이디어를 슬라이드로 만들고, <br />
                리허설과 피드백까지 하나의 흐름에서 완성하세요.
              </p>
              <GradientButton
                className="landing-primary-action"
                onClick={() => props.onNavigate("/signup")}
                size="large"
              >
                무료로 시작하기
                <IconArrowRight aria-hidden="true" size={16} />
              </GradientButton>
            </div>
          </div>
        </section>

        <ProductPreview />
      </main>

      <footer className="landing-footer">
        <span>© 2026 ORBIT</span>
        <span>발표의 모든 순간을 연결합니다.</span>
      </footer>
    </div>
  );
}

function ProductPreview() {
  return (
    <section
      aria-label="ORBIT 편집 화면 미리보기"
      className="landing-product-preview"
    >
      <header className="landing-preview-topbar redesign-dark">
        <div className="landing-preview-filebar">
          <span className="landing-preview-top-icon">
            <IconHome aria-hidden="true" size={13} />
          </span>
          <span className="landing-preview-file-menu">
            파일
            <IconChevronDown aria-hidden="true" size={11} />
          </span>
          <i aria-hidden="true" />
          <strong>내가 가장 좋아하는 애니메이션 - 짱구는 못말려</strong>
          <small>저장됨</small>
          <span className="landing-preview-top-icon">
            <IconRefresh aria-hidden="true" size={12} />
          </span>
        </div>

        <div aria-hidden="true" className="landing-preview-actions">
          <span className="landing-preview-avatar">
            <img alt="" src="/avatars/orbit-01.png" />
          </span>
          <i>
            <IconHistory size={13} />
          </i>
          <i>
            <IconDeviceFloppy size={13} />
          </i>
          <i>
            <IconRefresh size={13} />
          </i>
          <i className="is-primary">
            <IconMicrophone size={13} />
          </i>
          <i>
            <IconShare size={13} />
          </i>
          <strong>
            <IconPlayerPlay size={12} />
            발표하기
          </strong>
          <i className="landing-preview-present-more">
            <IconChevronDown size={11} />
          </i>
        </div>
      </header>

      <div className="landing-preview-workspace">
        <div aria-label="슬라이드 목록" className="landing-preview-rail">
          <div className="landing-preview-rail-heading">
            <span>
              <strong>슬라이드</strong> 7
            </span>
            <IconLayoutSidebarLeftCollapse aria-hidden="true" size={13} />
          </div>

          {slidePreviews.map((slide, index) => (
            <div
              className={`landing-preview-thumbnail ${index === 0 ? "is-active" : ""}`}
              key={slide.label}
            >
              <span>{index + 1}</span>
              <div
                className={`landing-thumbnail-art landing-thumbnail-${slide.variant}`}
              >
                <i />
                <i />
                <i />
              </div>
            </div>
          ))}
          <footer className="landing-preview-rail-footer">
            <span className="is-selected">
              <IconLayoutGrid aria-hidden="true" size={13} />
            </span>
            <span>
              <IconLayoutSidebarLeftCollapse aria-hidden="true" size={13} />
            </span>
            <span>
              <IconPlus aria-hidden="true" size={14} />
            </span>
          </footer>
        </div>

        <section className="landing-preview-editor">
          <div className="landing-preview-stage">
            <div
              aria-hidden="true"
              className="landing-preview-toolbar redesign-dark"
            >
              <IconArrowLeft size={14} />
              <IconArrowRight size={14} />
              <span className="is-selected">
                <IconPointer size={12} />
              </span>
              <i />
              <IconTypography size={14} />
              <IconShape size={14} />
              <IconChartBar size={14} />
              <IconPhotoPlus size={14} />
              <IconSparkles size={14} />
            </div>

            <div
              aria-hidden="true"
              className="landing-preview-zoom redesign-dark"
            >
              <IconZoomOut size={13} />
              <IconFocusCentered size={13} />
              <strong>51%</strong>
              <IconZoomIn size={13} />
            </div>

            <article className="landing-preview-slide">
              <div className="landing-slide-copy">
                <p>2026 H2 STRATEGY</p>
                <h2>
                  고객의 시간을
                  <br />
                  성장으로 바꾸다
                </h2>
                <span>Orbit Product Team</span>
              </div>

              <div aria-hidden="true" className="landing-slide-visual">
                <div className="landing-slide-orbit" />
                <div className="landing-slide-metric landing-slide-metric-main">
                  <small>ARR GROWTH</small>
                  <strong>+34%</strong>
                </div>
                <div className="landing-slide-metric landing-slide-metric-sub">
                  <small>ACTIVE TEAMS</small>
                  <strong>12.8K</strong>
                </div>
              </div>
            </article>
          </div>

          <footer className="landing-preview-script">
            <strong>대본</strong>
            <span>
              이번 발표에서는 고객의 시간을 줄이고 성장을 만드는 세 가지 전략을
              소개합니다.
            </span>
            <IconChevronDown aria-hidden="true" size={13} />
          </footer>
        </section>

        <div aria-label="AI 어시스턴트" className="landing-preview-ai">
          <header className="landing-preview-inspector-header">
            <span>
              <IconMessageCircle aria-hidden="true" size={13} /> AI 어시스턴트
            </span>
            <div aria-hidden="true">
              <i>
                <IconAdjustmentsHorizontal size={12} />
              </i>
              <i>
                <IconLayoutGrid size={12} />
              </i>
              <i className="is-selected">
                <IconMessageCircle size={12} />
              </i>
              <i>
                <IconLayoutSidebarRightCollapse size={12} />
              </i>
            </div>
          </header>

          <section className="landing-preview-assistant">
            <div className="landing-ai-redesign">
              <span className="landing-ai-redesign-icon">
                <IconSparkles aria-hidden="true" size={18} />
              </span>
              <h3>이 슬라이드를 더 설득력 있게</h3>
              <p>
                내용은 유지하면서 현재 장표에 어울리는 디자인 제안을 준비해
                드려요.
              </p>
              <button className="landing-ai-primary" type="button">
                <IconSparkles aria-hidden="true" size={13} />
                슬라이드 다시 디자인
              </button>
              <div className="landing-ai-quick-actions">
                <button type="button">
                  <IconLayoutGrid size={12} /> 레이아웃 정리
                </button>
                <button type="button">
                  <IconTargetArrow size={12} /> 핵심 메시지 강조
                </button>
                <button type="button">
                  <IconPlayerPlay size={12} /> 애니메이션 추천
                </button>
              </div>
            </div>
            <div className="landing-ai-message">
              <i>AI</i>
              <p>현재 슬라이드에서 바꾸고 싶은 디자인을 말씀해 주세요.</p>
            </div>
            <div className="landing-ai-composer">
              <button className="landing-ai-intro" type="button">
                아이스브레이킹 인트로 추가
              </button>
              <nav aria-label="AI 생성 유형">
                <span className="is-active">디자인</span>
                <span>
                  <IconPhotoPlus aria-hidden="true" size={11} /> 이미지 생성
                </span>
              </nav>
              <div className="landing-ai-input">
                <span>바꾸고 싶은 디자인을 말씀해 주세요</span>
                <IconArrowRight aria-hidden="true" size={12} />
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
