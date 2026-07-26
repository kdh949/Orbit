import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { defaultAutoAdvancePolicy } from "../../../runtime/presentation/advance/autoAdvanceConfig";
import { AutoAdvanceSettings } from "./AutoAdvanceSettings";
import {
  defaultPresenterSettings,
  type PresenterSettingsUpdater
} from "../../rehearsal/settings/presenterSettings";

describe("AutoAdvanceSettings", () => {
  it("renders mode toggles and a 5 percent threshold value", () => {
    const html = renderSettings();

    expect(html).toContain("리허설 자동 전환");
    expect(html).toContain("실전 자동 전환");
    expect(html).toContain("E5 대본 따라가기");
    expect(html).toContain("70%");
  });

  it("does not expose hidden timing or detector controls", () => {
    const html = renderSettings();

    expect(html).not.toContain("pauseMs");
    expect(html).not.toContain("countdownMs");
    expect(html).not.toContain("manualGuidanceDelayMs");
    expect(html).not.toContain("silenceThresholdDb");
    expect(html).not.toContain("침묵");
  });

  it("persists rehearsal and live toggle changes through settings updaters", () => {
    const saveSettings = vi.fn();
    const element = renderSettingsElement(saveSettings);
    const [rehearsalToggle, liveToggle, semanticToggle] = findElementsByType(
      element,
      "input"
    );

    rehearsalToggle.props.onChange({ target: { checked: false } });
    liveToggle.props.onChange({ target: { checked: false } });
    semanticToggle.props.onChange({ target: { checked: false } });

    expect(applySettingsUpdater(saveSettings.mock.calls[0]![0])).toMatchObject({
      advancePolicy: {
        live: false,
        rehearsal: false
      }
    });
    expect(applySettingsUpdater(saveSettings.mock.calls[1]![0])).toMatchObject({
      advancePolicy: {
        live: false,
        rehearsal: true
      }
    });
    expect(applySettingsUpdater(saveSettings.mock.calls[2]![0])).toMatchObject({
      advancePolicy: {
        semanticMatching: false
      }
    });
    expect(semanticToggle.props.checked).toBe(true);
  });

  it("persists threshold changes in five percent steps within the allowed range", () => {
    const saveSettings = vi.fn();
    const element = renderSettingsElement(saveSettings);

    findButtonByLabel(element, "자동 전환 기준 낮추기").props.onClick();
    findButtonByLabel(element, "자동 전환 기준 높이기").props.onClick();

    expect(applySettingsUpdater(saveSettings.mock.calls[0]![0])).toMatchObject({
      advancePolicy: {
        threshold: 0.65
      }
    });
    expect(applySettingsUpdater(saveSettings.mock.calls[1]![0])).toMatchObject({
      advancePolicy: {
        threshold: 0.75
      }
    });

    expect(
      findButtonByLabel(
        renderSettingsElement(vi.fn(), { threshold: 0.5 }),
        "자동 전환 기준 낮추기"
      ).props.disabled
    ).toBe(true);
    expect(
      findButtonByLabel(
        renderSettingsElement(vi.fn(), { threshold: 0.95 }),
        "자동 전환 기준 높이기"
      ).props.disabled
    ).toBe(true);
  });
});

function renderSettings() {
  return renderToStaticMarkup(
    renderSettingsElement(vi.fn())
  );
}

function renderSettingsElement(
  saveSettings: (updater: PresenterSettingsUpdater) => void,
  policyPatch: Partial<typeof defaultAutoAdvancePolicy> = {}
) {
  return AutoAdvanceSettings({
    policy: {
      ...defaultAutoAdvancePolicy,
      ...policyPatch
    },
    saveSettings
  });
}

function applySettingsUpdater(updater: PresenterSettingsUpdater) {
  return typeof updater === "function"
    ? updater(defaultPresenterSettings)
    : updater;
}

function findElementsByType(element: ReactNode, type: string) {
  return findElements(element, (candidate) => candidate.type === type);
}

function findButtonByLabel(element: ReactNode, label: string) {
  const match = findElements(element, (candidate) => candidate.props["aria-label"] === label)[0];
  if (!match) {
    throw new Error(`Button not found: ${label}`);
  }
  return match;
}

function findElements(
  node: ReactNode,
  predicate: (candidate: any) => boolean
): any[] {
  const matches: any[] = [];

  function visit(current: ReactNode) {
    if (!isValidElement(current)) {
      return;
    }

    if (predicate(current)) {
      matches.push(current);
    }

    Children.forEach((current.props as { children?: ReactNode }).children, visit);
  }

  Children.forEach(node, visit);
  return matches;
}
