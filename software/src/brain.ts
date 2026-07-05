// The brain: Claude vision analysis of the latest photos.
//
// Sends the newest JPEGs (base64) plus operating context and asks for a strict
// JSON verdict via forced tool use. The result is validated and clamped before
// it can drive any hardware — the model never gets to exceed the safety caps.

import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import type { Config } from "./config.ts";

export interface Verdict {
  healthScore: number; // 0-10
  summary: string;
  issues: string[];
  waterTopUpMl: number; // 0 if none; hard-capped at 500
  lightAdjustment: "none" | "increase" | "decrease";
  alert: boolean;
  alertReason?: string;
}

export interface BrainContext {
  hoursSinceLastTopUp: number | null;
  pumpBudgetUsedSeconds: number;
  pumpBudgetTotalSeconds: number;
  lightOn: boolean;
  recentEvents: { ts: string; kind: string }[];
}

export const MAX_WATER_ML = 500; // safety: brain may never request more than this

const clampNum = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
};

// Validate + clamp an arbitrary object (tool input or parsed JSON) into a
// safe Verdict. Tolerant of malformed / partial model output.
export function parseVerdict(raw: unknown): Verdict {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const issues = Array.isArray(o.issues)
    ? o.issues.filter((x): x is string => typeof x === "string")
    : [];

  const adj = o.lightAdjustment;
  const lightAdjustment: Verdict["lightAdjustment"] =
    adj === "increase" || adj === "decrease" ? adj : "none";

  const v: Verdict = {
    healthScore: clampNum(o.healthScore, 0, 10, 5),
    summary: typeof o.summary === "string" ? o.summary : "",
    issues,
    waterTopUpMl: Math.round(clampNum(o.waterTopUpMl, 0, MAX_WATER_ML, 0)),
    lightAdjustment,
    alert: Boolean(o.alert),
  };
  if (v.alert && typeof o.alertReason === "string") v.alertReason = o.alertReason;
  return v;
}

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    healthScore: { type: "number", description: "Overall plant health, 0 (dead) to 10 (thriving)" },
    summary: { type: "string", description: "One or two sentences on what you see" },
    issues: { type: "array", items: { type: "string" }, description: "Specific problems observed" },
    waterTopUpMl: { type: "number", description: "Millilitres to top up now (0 if none). Max 500." },
    lightAdjustment: { type: "string", enum: ["none", "increase", "decrease"] },
    alert: { type: "boolean", description: "True if the human should be notified now" },
    alertReason: { type: "string", description: "Why an alert is warranted (only if alert is true)" },
  },
  required: ["healthScore", "summary", "issues", "waterTopUpMl", "lightAdjustment", "alert"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the horticulturist brain of a small indoor hydroponic herb garden
(parsley and leafy greens). You receive photos from the grow chamber plus operating context.
Assess plant health, spot problems (wilting, yellowing, pests, low water, light stress, mould),
and decide on any small corrective watering or light change. Be conservative with water.
Always answer by calling the record_verdict tool.`;

export class Brain {
  private client: Anthropic;
  constructor(private readonly cfg: Config) {
    this.client = new Anthropic({ apiKey: cfg.anthropicApiKey });
  }

  async analyze(photoPaths: string[], ctx: BrainContext): Promise<{ verdict: Verdict; raw: string }> {
    const images = await Promise.all(
      photoPaths.map(async (p) => ({
        type: "image" as const,
        source: {
          type: "base64" as const,
          media_type: "image/jpeg" as const,
          data: (await readFile(p)).toString("base64"),
        },
      })),
    );

    const contextText = [
      `Hours since last water top-up: ${ctx.hoursSinceLastTopUp?.toFixed(1) ?? "never"}`,
      `Pump budget used today: ${ctx.pumpBudgetUsedSeconds}s of ${ctx.pumpBudgetTotalSeconds}s`,
      `Light currently: ${ctx.lightOn ? "on" : "off"}`,
      `Recent events: ${ctx.recentEvents.map((e) => `${e.kind}@${e.ts}`).join(", ") || "none"}`,
      `Reminder: waterTopUpMl must be 0-${MAX_WATER_ML}.`,
    ].join("\n");

    const msg = await this.client.messages.create({
      model: this.cfg.brain.model,
      max_tokens: this.cfg.brain.maxTokens,
      system: SYSTEM,
      tools: [
        {
          name: "record_verdict",
          description: "Record the structured health verdict for this inspection.",
          input_schema: VERDICT_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "record_verdict" },
      messages: [
        {
          role: "user",
          content: [
            ...images,
            { type: "text", text: contextText },
          ],
        },
      ],
    });

    const raw = JSON.stringify(msg.content);
    const toolUse = msg.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      return { verdict: parseVerdict(toolUse.input), raw };
    }
    // Fallback: extract JSON from any text block if forced tool use didn't land.
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { verdict: parseVerdict(extractJson(text)), raw: raw || text };
  }
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return {};
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return {};
  }
}
