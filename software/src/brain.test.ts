import { expect, test, describe } from "bun:test";
import { parseVerdict, parseDeepReview, MAX_WATER_ML } from "./brain.ts";

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

  test("defaults plants to an empty array", () => {
    expect(parseVerdict({}).plants).toEqual([]);
    expect(parseVerdict({ plants: "nope" }).plants).toEqual([]);
  });

  test("reservoirLevel accepts ok/low and defaults unknown", () => {
    expect(parseVerdict({ reservoirLevel: "low" }).reservoirLevel).toBe("low");
    expect(parseVerdict({ reservoirLevel: "ok" }).reservoirLevel).toBe("ok");
    expect(parseVerdict({}).reservoirLevel).toBe("unknown");
    expect(parseVerdict({ reservoirLevel: "flooded" }).reservoirLevel).toBe("unknown");
  });

  test("validates and clamps per-pot entries", () => {
    const v = parseVerdict({
      plants: [
        { pot: 1.7, species: "basil", stage: "vegetative", health: 8, note: "lush" },
        { pot: -2, species: "  ", stage: "sideways", health: 42, note: 5 },
      ],
    });
    expect(v.plants[0]).toEqual({ pot: 2, species: "basil", stage: "vegetative", health: 8, note: "lush" });
    // invalid stage falls back, empty species -> null, health clamps, note coerced to ""
    expect(v.plants[1]).toEqual({ pot: 0, species: null, stage: "seedling", health: 10, note: "" });
  });
});

describe("parseDeepReview", () => {
  test("keeps well-formed recommendations and their config mapping", () => {
    const r = parseDeepReview({
      digest: "Looking healthy.",
      recommendations: [
        { text: "Raise light to 6am", configKey: "light.onHour", configValue: 6 },
        { text: "Thin the cilantro" },
      ],
    });
    expect(r.digest).toBe("Looking healthy.");
    expect(r.recommendations).toHaveLength(2);
    expect(r.recommendations[0]).toMatchObject({ configKey: "light.onHour", configValue: 6 });
    expect(r.recommendations[1]!.configKey).toBeUndefined();
  });

  test("drops empty recs and non-whitelisted config keys", () => {
    const r = parseDeepReview({
      recommendations: [
        { text: "" },
        { text: "tweak", configKey: "pump.mlPerSecond", configValue: 1 },
      ],
    });
    expect(r.recommendations).toHaveLength(1);
    expect(r.recommendations[0]!.configKey).toBeUndefined(); // non-settable key stripped
  });

  test("survives malformed input", () => {
    expect(parseDeepReview("nope")).toEqual({ digest: "", recommendations: [] });
  });
});
