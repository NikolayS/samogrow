import { expect, test, describe } from "bun:test";
import { runConversation, type ConvController, type LLMClient } from "./conversation.ts";
import type { Config } from "./config.ts";

// Minimal Anthropic.Message stand-ins for the mocked client (no network).
function toolMsg(name: string, input: unknown, id = "tu1"): any {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model: "x",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [{ type: "tool_use", id, name, input }],
  };
}
function textMsg(text: string): any {
  return {
    id: "m",
    type: "message",
    role: "assistant",
    model: "x",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [{ type: "text", text }],
  };
}

class FakeClient implements LLMClient {
  calls = 0;
  constructor(private readonly scripted: any[]) {}
  messages = {
    create: async (): Promise<any> => this.scripted[this.calls++],
  };
}

const cfg = { brain: { model: "m", maxTokens: 100 } } as unknown as Config;

function makeController(overrides: Partial<ConvController> = {}) {
  const calls = { watered: [] as number[], set: [] as [string, string | number][] };
  const controller: ConvController = {
    statusText: () => "STATUS",
    lastAnalysisText: () => "LAST",
    historyText: (d) => `HIST ${d}`,
    configText: () => "CFG",
    photoNow: async () => ["/tmp/p1.jpg"],
    isManual: false,
    manualWaterRecommendation: () => 0,
    waterNow: async (ml) => {
      calls.watered.push(ml);
      return ml;
    },
    lightOverride: async () => {},
    setSetting: (key, value) => {
      calls.set.push([key, value]);
      return { ok: true, key, value };
    },
    ...overrides,
  };
  return { controller, calls };
}

describe("runConversation", () => {
  test("dispatches a read tool then returns the model's text reply", async () => {
    const { controller } = makeController();
    const client = new FakeClient([toolMsg("get_status", {}), textMsg("All good — health 8/10.")]);
    const res = await runConversation(client, cfg, controller, [], "how's it going?");
    expect(res.reply).toBe("All good — health 8/10.");
    // history keeps just the user + assistant text turn
    expect(res.history).toHaveLength(2);
  });

  test("small watering executes immediately through the controller", async () => {
    const { controller, calls } = makeController();
    const client = new FakeClient([toolMsg("water", { ml: 100 }), textMsg("Watered 100 ml.")]);
    const res = await runConversation(client, cfg, controller, [], "give it a splash");
    expect(calls.watered).toEqual([100]);
    expect(res.confirmWaterMl).toBeUndefined();
  });

  test("watering over the threshold requests confirmation instead of acting", async () => {
    const { controller, calls } = makeController();
    const client = new FakeClient([toolMsg("water", { ml: 300 }), textMsg("Please tap confirm.")]);
    const res = await runConversation(client, cfg, controller, [], "water a lot");
    expect(res.confirmWaterMl).toBe(300);
    expect(calls.watered).toEqual([]); // NOT executed
  });

  test("capture_photo surfaces the captured paths to the bot", async () => {
    const { controller } = makeController();
    const client = new FakeClient([toolMsg("capture_photo", {}), textMsg("Here you go.")]);
    const res = await runConversation(client, cfg, controller, [], "show me");
    expect(res.photos).toEqual(["/tmp/p1.jpg"]);
  });

  test("set_config routes through the controller (same safety path)", async () => {
    const { controller, calls } = makeController();
    const client = new FakeClient([toolMsg("set_config", { key: "light.onHour", value: 6 }), textMsg("Done.")]);
    await runConversation(client, cfg, controller, [], "lights on at 6");
    expect(calls.set).toEqual([["light.onHour", 6]]);
  });

  test("water in manual mode explains instead of dispensing", async () => {
    const { controller, calls } = makeController({ isManual: true, manualWaterRecommendation: () => 150 });
    const client = new FakeClient([toolMsg("water", { ml: 120 }), textMsg("Add ~120 ml by hand.")]);
    const res = await runConversation(client, cfg, controller, [], "water it");
    expect(calls.watered).toEqual([]); // NOT dispensed
    expect(res.confirmWaterMl).toBeUndefined();
    // the model saw a manual-mode explanation (it relays that in its reply)
    expect(res.reply).toContain("120");
  });

  test("carries prior history forward", async () => {
    const { controller } = makeController();
    const client = new FakeClient([textMsg("Hi again.")]);
    const prior = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ] as any;
    const res = await runConversation(client, cfg, controller, prior, "you there?");
    expect(res.history).toHaveLength(4);
  });
});
