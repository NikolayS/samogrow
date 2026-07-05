import { expect, test, describe } from "bun:test";
import { sampleFrames } from "./timelapse.ts";

describe("sampleFrames", () => {
  test("returns all frames when under the cap", () => {
    expect(sampleFrames([1, 2, 3], 5)).toEqual([1, 2, 3]);
  });

  test("evenly samples down to the cap, keeping first and last", () => {
    const frames = Array.from({ length: 100 }, (_, i) => i);
    const out = sampleFrames(frames, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(99);
    // strictly increasing (order preserved)
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!);
  });

  test("cap of 1 keeps the first frame", () => {
    expect(sampleFrames([5, 6, 7], 1)).toEqual([5]);
  });

  test("cap of 0 (or empty) yields nothing", () => {
    expect(sampleFrames([1, 2], 0)).toEqual([]);
    expect(sampleFrames([], 5)).toEqual([]);
  });
});
