import { describe, expect, it } from "vitest";
import { createLiveSttPort, defaultLiveSttEngineId } from "./liveSttEngineRegistry";
import { MoonshineLiveSttPort } from "./moonshineLiveSttPort";
import { OpenAiRealtimeLiveSttPort } from "./openAiRealtimeLiveSttPort";
import { RerankingLiveSttPort } from "./rerankingLiveSttPort";
import { SherpaLiveSttPort } from "./sherpaLiveSttPort";

describe("liveSttEngineRegistry", () => {
  it("기본 엔진은 OpenAI Realtime이다", () => {
    const port = createLiveSttPort(undefined, {
      projectId: "project_real_1"
    });

    expect(defaultLiveSttEngineId).toBe("openai-realtime");
    expect(port).toBeInstanceOf(OpenAiRealtimeLiveSttPort);
    expect(port.engineId).toBe("openai-realtime");
    expect(port.capabilities.onDevice).toBe(false);
    expect((port as OpenAiRealtimeLiveSttPort).projectId).toBe("project_real_1");
  });

  it("OpenAI Realtime 엔진을 프로젝트 범위로 생성한다", () => {
    const port = createLiveSttPort("openai-realtime", {
      projectId: "project_custom_1"
    });

    expect(port).toBeInstanceOf(OpenAiRealtimeLiveSttPort);
    expect((port as OpenAiRealtimeLiveSttPort).projectId).toBe(
      "project_custom_1"
    );
  });

  it("Web Speech 엔진을 재순위 데코레이터로 생성한다", () => {
    expect(createLiveSttPort("web-speech")).toBeInstanceOf(RerankingLiveSttPort);
  });

  it("Sherpa 엔진을 명시적으로 생성한다", () => {
    expect(createLiveSttPort("sherpa")).toBeInstanceOf(SherpaLiveSttPort);
  });

  it("Moonshine 엔진을 생성한다", () => {
    expect(createLiveSttPort("moonshine")).toBeInstanceOf(MoonshineLiveSttPort);
  });
});
