// Conversational Telegram: non-command text goes to Claude with tool use. The
// model answers naturally and may act — every action routes through the SAME
// controller API (and safety caps) as the slash commands. Watering over
// WATER_CONFIRM_THRESHOLD ml is not executed here; instead the bot is asked to
// show an inline confirm button.
//
// The Anthropic client is injected (LLMClient) so tests can mock it — no network.

import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "./config.ts";

export const WATER_CONFIRM_THRESHOLD = 200;
const MAX_STEPS = 6; // tool-use rounds per user message
const MAX_HISTORY = 10; // rolling text turns kept between messages

// The controller surface the conversation tools drive. The controller builds
// the human-readable read strings (it has the db + formatters); actions return
// primitives. Keeping this an interface avoids an import cycle and makes the
// dispatcher trivially testable with a fake.
export interface ConvController {
  statusText(): string;
  lastAnalysisText(): string;
  historyText(days: number): string;
  configText(): string;
  photoNow(): Promise<string[]>;
  // Manual watering mode (no pump): water() explains rather than pumps.
  readonly isManual: boolean;
  manualWaterRecommendation(): number;
  waterNow(ml: number): Promise<number>;
  lightOverride(mode: "on" | "off" | "auto", minutes: number): Promise<void>;
  setSetting(
    key: string,
    value: string | number,
  ): { ok: boolean; key?: string; value?: string | number; error?: string };
}

// Just the slice of the Anthropic SDK the loop needs; the real client satisfies it.
export interface LLMClient {
  messages: {
    create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  };
}

export interface ConvResult {
  reply: string;
  confirmWaterMl?: number; // bot should show a [Water N ml] confirm button
  photos: string[]; // photos captured during the turn, for the bot to send
  history: Anthropic.MessageParam[]; // updated rolling history (text turns only)
}

const CONV_SYSTEM = `You are the friendly assistant of a small indoor hydroponic herb garden, chatting
over Telegram. Answer the owner's questions naturally and concisely. Use the tools to read live state
(status, last analysis, history, config) before answering about the garden — don't guess or invent
numbers. You may act (capture a photo, water, change the light, adjust config), but be conservative:
watering over ${WATER_CONFIRM_THRESHOLD} ml requires the owner to confirm with a button, so for large
amounts just request it and tell them to tap confirm. Keep replies short and plain-text (no markdown).`;

const noInput = { type: "object", properties: {}, additionalProperties: false } as const;

function tools(): Anthropic.Tool[] {
  const t = (name: string, description: string, input_schema: unknown): Anthropic.Tool => ({
    name,
    description,
    input_schema: input_schema as Anthropic.Tool.InputSchema,
  });
  return [
    t("get_status", "Light state, pump budget, uptime, and the last analysis summary.", noInput),
    t("get_last_analysis", "The most recent AI analysis verdict, including per-pot detail.", noInput),
    t("get_history", "Recent history (health, water, light) over the given number of days.", {
      type: "object",
      properties: { days: { type: "number", description: "How many days back (1-30)" } },
      required: ["days"],
      additionalProperties: false,
    }),
    t("capture_photo", "Capture fresh photos now and send them to the owner.", noInput),
    t("water", "Water the plants now, in millilitres.", {
      type: "object",
      properties: { ml: { type: "number", description: "Millilitres to dispense" } },
      required: ["ml"],
      additionalProperties: false,
    }),
    t("set_light", "Override the grow light on/off for some minutes, or return to auto.", {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["on", "off", "auto"] },
        minutes: { type: "number", description: "Minutes to hold the override (ignored for auto)" },
      },
      required: ["mode"],
      additionalProperties: false,
    }),
    t("get_config", "Current effective values of the tunable settings.", noInput),
    t("set_config", "Change one tunable setting (safe whitelist; pump caps can only be lowered).", {
      type: "object",
      properties: {
        key: { type: "string", description: "Setting key, e.g. light.onHour" },
        value: { type: ["string", "number"], description: "New value" },
      },
      required: ["key", "value"],
      additionalProperties: false,
    }),
  ];
}

interface Sink {
  confirmWaterMl?: number;
  photos: string[];
}

async function dispatch(
  name: string,
  input: Record<string, unknown>,
  controller: ConvController,
  sink: Sink,
): Promise<string> {
  switch (name) {
    case "get_status":
      return controller.statusText();
    case "get_last_analysis":
      return controller.lastAnalysisText();
    case "get_history": {
      const days = Math.max(1, Math.min(30, Math.round(Number(input.days) || 7)));
      return controller.historyText(days);
    }
    case "get_config":
      return controller.configText();
    case "capture_photo": {
      const photos = await controller.photoNow();
      for (const p of photos) sink.photos.push(p);
      return photos.length ? `Captured ${photos.length} photo(s); sending them now.` : "No cameras responded.";
    }
    case "water": {
      const ml = Number(input.ml);
      if (!Number.isFinite(ml) || ml <= 0) return "Invalid amount.";
      if (controller.isManual) {
        const rec = controller.manualWaterRecommendation();
        return (
          `This garden is in manual watering mode — there is no pump, so I can't dispense water automatically. ` +
          `Please add roughly ${Math.round(ml)} ml to the reservoir by hand` +
          (rec > 0 ? ` (the current recommendation is about ${rec} ml)` : "") +
          `. Once you've topped up, tap Done on the reminder or send /water and I'll log it so the water trend stays accurate.`
        );
      }
      if (ml > WATER_CONFIRM_THRESHOLD) {
        sink.confirmWaterMl = ml;
        return `Watering ${ml} ml exceeds the ${WATER_CONFIRM_THRESHOLD} ml auto-limit; a confirmation button has been shown to the owner. Ask them to tap it to proceed.`;
      }
      const actual = await controller.waterNow(ml);
      return actual > 0
        ? `Watered ${actual.toFixed(0)} ml.`
        : "Watering did not run (daily budget reached, or the pump is locked out — check /pump).";
    }
    case "set_light": {
      const mode = input.mode;
      if (mode !== "on" && mode !== "off" && mode !== "auto") return "mode must be on, off, or auto.";
      const minutes = Math.max(1, Math.round(Number(input.minutes) || 60));
      await controller.lightOverride(mode, minutes);
      return mode === "auto" ? "Light back on schedule." : `Light forced ${mode} for ${minutes} min.`;
    }
    case "set_config": {
      const key = String(input.key ?? "");
      const value = input.value;
      if (typeof value !== "string" && typeof value !== "number") return "value must be a string or number.";
      const res = controller.setSetting(key, value);
      return res.ok ? `Set ${res.key} = ${res.value}.` : `Could not set: ${res.error}`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// Run one user turn: multi-step tool loop, returning the final reply plus any
// side effects (photos to send, a watering confirmation) and the trimmed history.
export async function runConversation(
  client: LLMClient,
  cfg: Config,
  controller: ConvController,
  history: Anthropic.MessageParam[],
  userText: string,
): Promise<ConvResult> {
  const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userText }];
  const sink: Sink = { photos: [] };
  let finalText = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await client.messages.create({
      model: cfg.brain.model,
      max_tokens: cfg.brain.maxTokens,
      system: CONV_SYSTEM,
      tools: tools(),
      messages,
    });
    messages.push({ role: "assistant", content: msg.content });

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text) finalText = text;

    const toolUses = msg.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (msg.stop_reason !== "tool_use" || toolUses.length === 0) break;

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const content = await dispatch(tu.name, (tu.input ?? {}) as Record<string, unknown>, controller, sink);
      results.push({ type: "tool_result", tool_use_id: tu.id, content });
    }
    messages.push({ role: "user", content: results });
  }

  const reply = finalText || "(no reply)";
  const full: Anthropic.MessageParam[] = [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: reply },
  ];

  return { reply, confirmWaterMl: sink.confirmWaterMl, photos: sink.photos, history: full.slice(-MAX_HISTORY) };
}
