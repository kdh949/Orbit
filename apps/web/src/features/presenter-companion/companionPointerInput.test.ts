import { describe, expect, it } from "vitest";
import {
  findHitStrokeId,
  getCompanionPointerPoints,
  resolvePointerPressure,
  shouldAcceptCompanionPointer,
} from "./companionPointerInput";

describe("companionPointerInput", () => {
  it("uses coalesced Pencil samples and normalizes pressure", () => {
    const points = getCompanionPointerPoints(
      {
        clientX: 20,
        clientY: 30,
        pointerId: 1,
        pointerType: "pen",
        pressure: 0.2,
        timeStamp: 110,
        getCoalescedEvents: () => [
          {
            clientX: 20,
            clientY: 30,
            pointerId: 1,
            pointerType: "pen",
            pressure: 0.25,
            timeStamp: 110,
          },
          {
            clientX: 30,
            clientY: 40,
            pointerId: 1,
            pointerType: "pen",
            pressure: 0.75,
            timeStamp: 120,
          },
        ],
      },
      { left: 10, top: 20, width: 100, height: 100 },
      100,
    );

    expect(points).toEqual([
      { x: 0.1, y: 0.1, pressure: 0.25, t: 10 },
      { x: 0.2, y: 0.2, pressure: 0.75, t: 20 },
    ]);
  });

  it("falls back for touch-only and hover pressure", () => {
    expect(
      resolvePointerPressure({ pointerType: "pen", pressure: 0 }),
    ).toBe(0.35);
    expect(
      resolvePointerPressure({ pointerType: "touch", pressure: 0 }),
    ).toBe(0.5);
    expect(
      getCompanionPointerPoints(
        {
          clientX: 500,
          clientY: -5,
          pointerId: 2,
          pointerType: "touch",
          pressure: 0,
          timeStamp: 5,
        },
        { left: 0, top: 0, width: 100, height: 100 },
        0,
      )[0],
    ).toMatchObject({ x: 1, y: 0, pressure: 0.5 });
  });

  it("ignores unrelated touch and palm-sized contact while Pencil is active", () => {
    const active = { pointerId: 1, pointerType: "pen" };
    expect(
      shouldAcceptCompanionPointer(
        {
          clientX: 0,
          clientY: 0,
          pointerId: 2,
          pointerType: "touch",
          pressure: 0.5,
          timeStamp: 0,
        },
        active,
      ),
    ).toBe(false);
    expect(
      shouldAcceptCompanionPointer(
        {
          clientX: 0,
          clientY: 0,
          pointerId: 3,
          pointerType: "touch",
          pressure: 0.5,
          timeStamp: 0,
          width: 60,
          height: 50,
        },
        null,
      ),
    ).toBe(false);
    expect(
      shouldAcceptCompanionPointer(
        {
          clientX: 0,
          clientY: 0,
          pointerId: 4,
          pointerType: "touch",
          pressure: 0,
          timeStamp: 0,
          width: 12,
          height: 12,
        },
        null,
      ),
    ).toBe(true);
  });

  it("selects an entire nearest stroke for erasing", () => {
    expect(
      findHitStrokeId(
        [
          {
            strokeId: "stroke_1",
            tool: "pen",
            color: "ink-blue",
            width: 0.01,
            points: [
              { x: 0.2, y: 0.2, pressure: 0.5, t: 0 },
              { x: 0.4, y: 0.4, pressure: 0.5, t: 1 },
            ],
          },
        ],
        { x: 0.3, y: 0.3 },
      ),
    ).toBe("stroke_1");
  });
});
