import { expect, test, describe } from "bun:test";
import { isWithinPhotoperiod, resolveLightState } from "./controller.ts";

describe("isWithinPhotoperiod", () => {
  test("daytime window on 7 off 23", () => {
    expect(isWithinPhotoperiod(6, 7, 23)).toBe(false);
    expect(isWithinPhotoperiod(7, 7, 23)).toBe(true);
    expect(isWithinPhotoperiod(15, 7, 23)).toBe(true);
    expect(isWithinPhotoperiod(22, 7, 23)).toBe(true);
    expect(isWithinPhotoperiod(23, 7, 23)).toBe(false); // off at 23:00
  });

  test("overnight window on 20 off 8", () => {
    expect(isWithinPhotoperiod(20, 20, 8)).toBe(true);
    expect(isWithinPhotoperiod(23, 20, 8)).toBe(true);
    expect(isWithinPhotoperiod(0, 20, 8)).toBe(true);
    expect(isWithinPhotoperiod(7, 20, 8)).toBe(true);
    expect(isWithinPhotoperiod(8, 20, 8)).toBe(false);
    expect(isWithinPhotoperiod(12, 20, 8)).toBe(false);
  });

  test("zero-length window is always off", () => {
    expect(isWithinPhotoperiod(12, 9, 9)).toBe(false);
  });
});

describe("resolveLightState", () => {
  const at = (h: number) => new Date(2026, 0, 1, h, 0, 0);

  test("follows schedule with no override", () => {
    expect(resolveLightState(at(12), 7, 23, null)).toBe(true);
    expect(resolveLightState(at(3), 7, 23, null)).toBe(false);
  });

  test("active override wins over schedule", () => {
    // `until` is measured against the same clock as the passed `now`.
    expect(resolveLightState(at(3), 7, 23, { mode: "on", until: at(3).getTime() + 60_000 })).toBe(true);
    expect(resolveLightState(at(12), 7, 23, { mode: "off", until: at(12).getTime() + 60_000 })).toBe(false);
  });

  test("expired override is ignored", () => {
    expect(resolveLightState(at(3), 7, 23, { mode: "on", until: at(3).getTime() - 1000 })).toBe(false);
  });
});
