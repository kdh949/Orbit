import {
  IconBell,
  IconChartBar,
  IconChevronDown,
  IconDotsVertical,
  IconFileDescription,
  IconFolder,
  IconHome,
  IconLayoutGrid,
  IconList,
  IconLoader2,
  IconMicrophone2,
  IconMinus,
  IconPencil,
  IconPlayerPlay,
  IconReport,
  IconSearch,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

const projects = [
  {
    id: "q2",
    title: "Q2 성과 리뷰 및 인사이트",
    date: "2026. 7. 11.",
    image: "/assets/q2-insights-thumbnail.png",
    fallback: "/assets/orbit-ai-strategy.png",
    tone: "blue",
  },
  {
    id: "esg",
    title: "ESG 경영 보고서 2026 상반기",
    date: "2026. 7. 9.",
    image: "/assets/orbit-ai-roadmap.png",
    tone: "dark",
  },
  {
    id: "launch",
    title: "신제품 런칭 계획 Ver.1.0",
    date: "2026. 7. 8.",
    image: "/assets/launch-plan-thumbnail.png",
    fallback: "/assets/orbit-ai-strategy.png",
    tone: "dark",
  },
  {
    id: "campaign",
    title: "마케팅 캠페인 하이라이트",
    date: "2026. 7. 7.",
    image: "/assets/orbit-ai-strategy.png",
  },
  {
    id: "culture",
    title: "HR 조직문화 업데이트",
    date: "2026. 7. 6.",
    image: "/assets/rehearsal-editorial.png",
  },
  {
    id: "partner",
    title: "파트너십 제안서 2026",
    date: "2026. 7. 5.",
    image: "/assets/orbit-ai-roadmap.png",
    tone: "dark",
  },
];

function ProjectCard({ project, view }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <article className={`project-card ${view === "list" ? "is-list" : ""}`}>
      <div className={`project-thumbnail tone-${project.tone ?? "light"}`}>
        <img
          alt=""
          onError={(event) => {
            if (project.fallback) event.currentTarget.src = project.fallback;
          }}
          src={project.image}
        />
        <div className="slide-copy" aria-hidden="true">
          <strong>{project.title}</strong>
          <small>ORBIT PRESENTATION</small>
        </div>
      </div>
      <div className="project-card-body">
        <div className="project-title-row">
          <h3>{project.title}</h3>
          <button
            aria-expanded={menuOpen}
            aria-label={`${project.title} 메뉴`}
            className="icon-button quiet"
            onClick={() => setMenuOpen((value) => !value)}
            type="button"
          >
            <IconDotsVertical size={19} />
          </button>
          {menuOpen ? (
            <div className="card-menu">
              <button type="button">이름 바꾸기</button>
              <button type="button">복제하기</button>
              <button type="button">삭제하기</button>
            </div>
          ) : null}
        </div>
        <p className="project-date">{project.date}</p>
        <div className="project-actions">
          <button type="button"><IconPencil size={15} />편집</button>
          <button type="button"><IconMicrophone2 size={16} />리허설</button>
          <button type="button"><IconReport size={15} />리포트</button>
        </div>
      </div>
    </article>
  );
}

function ProcessingCard({ progress, onReset, view }) {
  const complete = progress >= 100;

  return (
    <article className={`project-card processing-card ${view === "list" ? "is-list" : ""}`}>
      <div className="project-thumbnail processing-thumbnail">
        <img alt="PPTX 임시 미리보기" src="/assets/pptx-processing-placeholder.png" />
        <div className="thumbnail-progress">
          <span>{complete ? "미리보기 준비 완료" : `미리보기 만드는 중 · ${progress}%`}</span>
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>
      <div className="project-card-body">
        <span className={complete ? "status-pill is-complete" : "status-pill"}>
          {complete ? "변환 완료" : "PPTX 변환 중"}
        </span>
        <div className="project-title-row">
          <h3>2026 하반기 제품 전략</h3>
          <button aria-label="2026 하반기 제품 전략 메뉴" className="icon-button quiet" type="button">
            <IconDotsVertical size={19} />
          </button>
        </div>
        <p className="processing-description">
          {complete ? "편집할 준비가 끝났어요." : "발표자 노트와 레이아웃을 정리하고 있어요"}
        </p>
        <p className="project-date">방금 업로드</p>
        <div className="project-actions">
          <button disabled={!complete} type="button"><IconPencil size={15} />편집</button>
          <button disabled={!complete} type="button"><IconMicrophone2 size={16} />리허설</button>
          <button disabled={!complete} type="button"><IconReport size={15} />리포트</button>
        </div>
        {complete ? <button className="reset-link" onClick={onReset} type="button">변환 상태 다시 보기</button> : null}
      </div>
    </article>
  );
}

function BackgroundTray({ minimized, onClose, onMinimize, progress }) {
  const complete = progress >= 100;

  return (
    <aside className={`background-tray ${minimized ? "is-minimized" : ""}`} aria-label="백그라운드 작업">
      <header>
        <div>
          {complete ? <IconBell size={18} /> : <IconLoader2 className="spin" size={18} />}
          <strong>{complete ? "백그라운드 작업 완료" : "백그라운드 작업 1개"}</strong>
        </div>
        <div className="tray-controls">
          <button aria-label={minimized ? "작업 트레이 펼치기" : "작업 트레이 접기"} onClick={onMinimize} type="button">
            {minimized ? <IconChevronDown className="flip" size={18} /> : <IconMinus size={18} />}
          </button>
          <button aria-label="작업 트레이 닫기" onClick={onClose} type="button"><IconX size={18} /></button>
        </div>
      </header>
      {!minimized ? (
        <div className="tray-body">
          <div className="tray-file-row">
            <span className="file-icon"><IconFileDescription size={20} /></span>
            <div>
              <strong>2026 하반기 제품 전략.pptx</strong>
              <span>{complete ? "변환 완료" : `변환 중 ${progress}%`}</span>
            </div>
          </div>
          <div className="progress-track tray-progress" aria-label={`PPTX 변환 ${progress}%`} role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress}>
            <span style={{ width: `${progress}%` }} />
          </div>
          <p><IconBell size={16} />{complete ? "프로젝트를 편집할 수 있어요." : "완료되면 알림으로 알려드릴게요."}</p>
        </div>
      ) : null}
    </aside>
  );
}

export function App() {
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [sort, setSort] = useState("최근 수정순");
  const [view, setView] = useState("grid");
  const [progress, setProgress] = useState(78);
  const [trayVisible, setTrayVisible] = useState(true);
  const [trayMinimized, setTrayMinimized] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (progress >= 100) return undefined;
    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(value + 1, 100));
    }, 30000);
    return () => window.clearInterval(timer);
  }, [progress]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    const filtered = normalized
      ? projects.filter((project) => project.title.toLocaleLowerCase("ko-KR").includes(normalized))
      : projects;
    return sort === "이름순"
      ? [...filtered].sort((a, b) => a.title.localeCompare(b.title, "ko"))
      : filtered;
  }, [query, sort]);
  const processingVisible = !query || "2026 하반기 제품 전략".includes(query);

  function restartProcessing() {
    setProgress(0);
    setTrayVisible(true);
    setTrayMinimized(false);
    setToast("업로드가 완료됐어요. 백그라운드에서 변환 중입니다.");
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a aria-label="ORBIT 홈" className="brand" href="#top"><img alt="ORBIT" src="/assets/orbit-logo.png" /></a>
        <nav aria-label="주요 메뉴">
          <a className="is-active" href="#top"><IconHome size={19} />홈</a>
          <a href="#projects"><IconFolder size={19} />프로젝트</a>
          <a href="#projects" onClick={() => setToast("리허설 프로젝트를 선택해 주세요.")}><IconPlayerPlay size={19} />리허설</a>
          <a href="#projects" onClick={() => setToast("프로젝트 리포트를 불러왔어요.")}><IconChartBar size={19} />리포트</a>
        </nav>
        <button className="account" type="button"><span>T</span><strong>test@test.com</strong><IconChevronDown size={16} /></button>
      </header>

      <main id="top">
        <section className="workspace-hero">
          <div>
            <p className="eyebrow">WORKSPACE</p>
            <h1>오늘도<br />멋진 발표를 만들어볼까요?</h1>
            <p className="hero-copy">최근 작업을 이어가거나 AI로 새 발표자료를 빠르게 시작하세요.</p>
          </div>
          <button className="primary-button" onClick={() => setToast("AI 발표자료 만들기를 시작합니다.")} type="button"><IconSparkles size={18} />AI 발표자료 만들기</button>
        </section>

        <section className="projects-section" id="projects">
          <div className="projects-toolbar">
            <div className="project-count"><h2>내 프로젝트</h2><span>{visibleProjects.length + (processingVisible ? 1 : 0)}</span></div>
            <div className="toolbar-actions">
              {searchOpen ? (
                <label className="search-field">
                  <IconSearch size={19} />
                  <input
                    aria-label="프로젝트 검색"
                    autoFocus
                    onBlur={() => { if (!query) setSearchOpen(false); }}
                    onChange={(event) => setQuery(event.currentTarget.value)}
                    placeholder="프로젝트 검색"
                    type="search"
                    value={query}
                  />
                  {query ? <button aria-label="검색어 지우기" onClick={() => setQuery("")} type="button"><IconX size={15} /></button> : null}
                </label>
              ) : (
                <button aria-label="프로젝트 검색 열기" className="search-trigger" onClick={() => setSearchOpen(true)} type="button"><IconSearch size={19} /></button>
              )}
              <label className="sort-select">
                <span className="sr-only">프로젝트 정렬</span>
                <select onChange={(event) => setSort(event.currentTarget.value)} value={sort}>
                  <option>최근 수정순</option>
                  <option>이름순</option>
                </select>
                <IconChevronDown size={17} />
              </label>
              <div className="view-toggle" aria-label="프로젝트 보기 방식">
                <button aria-label="그리드 보기" aria-pressed={view === "grid"} onClick={() => setView("grid")} type="button"><IconLayoutGrid size={19} /></button>
                <button aria-label="목록 보기" aria-pressed={view === "list"} onClick={() => setView("list")} type="button"><IconList size={20} /></button>
              </div>
            </div>
          </div>

          <div className={`project-grid is-${view}`}>
            {processingVisible ? (
              <ProcessingCard onReset={restartProcessing} progress={progress} view={view} />
            ) : null}
            {visibleProjects.map((project) => <ProjectCard key={project.id} project={project} view={view} />)}
          </div>
        </section>
      </main>

      {trayVisible ? (
        <BackgroundTray
          minimized={trayMinimized}
          onClose={() => setTrayVisible(false)}
          onMinimize={() => setTrayMinimized((value) => !value)}
          progress={progress}
        />
      ) : progress < 100 ? (
        <button className="restore-tray" onClick={() => setTrayVisible(true)} type="button"><IconLoader2 className="spin" size={17} />변환 중 {progress}%</button>
      ) : null}

      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}
