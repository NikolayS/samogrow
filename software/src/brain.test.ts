import { expect, test, describe } from "bun:test";
import { parseVerdict, MAX_WATER_ML } from "./brain.ts";

describe("parseVerdict", () => {
  test("passes a well-formed verdict through", () => {
    const v = parseVerdict({
      healthScore: 8,
      summary: "Looking good",
      issues: ["slightly dry"],
      waterTopUpMl: 120,
      lightAdjustment: "increase",
      alert: false,
    });
    expect(v.healthScore).toBe(8);
    expect(v.waterTopUpMl).toBe(120);
    expect(v.lightAdjustment).toBe("increase");
    expect(v.alert).toBe(false);
  });

  test("clamps healthScore into 0-10", () => {
    expect(parseVerdict({ healthScore: 42 }).healthScore).toBe(10);
    expect(parseVerdict({ healthScore: -3 }).healthScore).toBe(0);
  });

  test("caps waterTopUpMl at the safety limit and rounds", () => {
    expect(parseVerdict({ waterTopUpMl: 9999 }).waterTopUpMl).toBe(MAX_WATER_ML);
    expect(parseVerdict({ waterTopUpMl: -50 }).waterTopUpMl).toBe(0);
    expect(parseVerdict({ waterTopUpMl: 33.7 }).waterTopUpMl).toBe(34);
  });

  test("defaults invalid lightAdjustment to none", () => {
    expect(parseVerdict({ lightAdjustment: "sideways" }).lightAdjustment).toBe("none");
    expect(parseVerdict({}).lightAdjustment).toBe("none");
  });

  test("survives completely malformed input", () => {
    const v = parseVerdict("not an object");
    expect(v.healthScore).toBe(5);
    expect(v.summary).toBe("");
    expect(v.issues).toEqual([]);
    expect(v.waterTopUpMl).toBe(0);
    expect(v.alert).toBe(false);
  });

  test("filters non-string issues", () => {
    expect(parseVerdict({ issues: ["ok", 5, null, "pests"] }).issues).toEqual(["ok", "pests"]);
    expect(parseVerdict({ issues: "notarray" }).issues).toEqual([]);
  });

  test("keeps alertReason only when alert is true", () => {
    expect(parseVerdict({ alert: true, alertReason: "wilting" }).alertReason).toBe("wilting");
    expect(parseVerdict({ alert: false, alertReason: "wilting" }).alertReason).toBeUndefined();
  });

  test("coerces numeric strings", () => {
    expect(parseVerdict({ healthScore: "7", waterTopUpMl: "40" })).toMatchObject({
      healthScore: 7,
      waterTopUpMl: 40,
    });
  });
});
