// The brain: Claude vision analysis of the latest photos.
//
// Sends the newest JPEGs (base64) plus operating context and asks for a strict
// JSON verdict via forced tool use. The result is validated and clamped before
// it can drive any hardware — the model never gets to exceed the safety caps.

import Anthropic from "@anthropic-ai/sdk";
import { readFile } from "node:fs/promises";
import type { Config } from "./config.ts";
import { SETTABLE_KEYS, isSettableKey } from "./overrides.ts";

export type PlantStage =
  | "empty"
  | "germinating"
  | "seedling"
  | "vegetative"
  | "harvest-ready"
  | "struggling";

export const PLANT_STAGES: readonly PlantStage[] = [
  "empty",
  "germinating",
  "seedling",
  "vegetative",
  "harvest-ready",
  "struggling",
];

export interface PlantVerdict {
  pot: number; // pot index (1-based in prompts; clamped to a non-negative integer)
  species: string | null;
  stage: PlantStage;
  health: number; // 0-10
  note: string;
}

export interface Verdict {
  healthScore: number; // 0-10 (whole-garden)
  summary: string;
  issues: string[];
  plants: PlantVerdict[]; // per-pot detail (may be empty)
  reservoirLevel: "ok" | "low" | "unknown"; // from a sight-tube float bead if visible
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

// Validate + clamp a single per-pot entry into a safe PlantVerdict.
function parsePlant(raw: unknown): PlantVerdict {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const stage = PLANT_STAGES.includes(o.stage as PlantStage) ? (o.stage as PlantStage) : "seedling";
  const species = typeof o.species === "string" && o.species.trim() ? o.species : null;
  return {
    pot: Math.max(0, Math.round(clampNum(o.pot, 0, 999, 0))),
    species,
    stage,
    health: clampNum(o.health, 0, 10, 5),
    note: typeof o.note === "string" ? o.note : "",
  };
}

// Validate + clamp an arbitrary object (tool input or parsed JSON) into a
// safe Verdict. Tolerant of malformed / partial model output.
export function parseVerdict(raw: unknown): Verdict {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const issues = Array.isArray(o.issues)
    ? o.issues.filter((x): x is string => typeof x === "string")
    : [];

  const plants = Array.isArray(o.plants) ? o.plants.map(parsePlant) : [];

  const adj = o.lightAdjustment;
  const lightAdjustment: Verdict["lightAdjustment"] =
    adj === "increase" || adj === "decrease" ? adj : "none";

  const reservoirLevel: Verdict["reservoirLevel"] =
    o.reservoirLevel === "ok" || o.reservoirLevel === "low" ? o.reservoirLevel : "unknown";

  const v: Verdict = {
    healthScore: clampNum(o.healthScore, 0, 10, 5),
    summary: typeof o.summary === "string" ? o.summary : "",
    issues,
    plants,
    reservoirLevel,
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
    healthScore: { type: "number", description: "Overall garden health, 0 (dead) to 10 (thriving)" },
    summary: { type: "string", description: "One or two sentences on what you see" },
    issues: { type: "array", items: { type: "string" }, description: "Specific problems observed" },
    plants: {
      type: "array",
      description: "Per-pot detail, one entry per visible pot (left to right)",
      items: {
        type: "object",
        properties: {
          pot: { type: "number", description: "Pot number, starting at 1 (left to right)" },
          species: { type: ["string", "null"], description: "Best guess at the herb, or null if unknown/empty" },
          stage: {
            type: "string",
            enum: ["empty", "germinating", "seedling", "vegetative", "harvest-ready", "struggling"],
          },
          health: { type: "number", description: "This pot's health, 0-10" },
          note: { type: "string", description: "Short note on this pot" },
        },
        required: ["pot", "species", "stage", "health", "note"],
        additionalProperties: false,
      },
    },
    reservoirLevel: {
      type: "string",
      enum: ["ok", "low", "unknown"],
      description: "Water reservoir level from a sight tube / float bead if visible, else 'unknown'",
    },
    waterTopUpMl: { type: "number", description: "Millilitres to top up now (0 if none). Max 500." },
    lightAdjustment: { type: "string", enum: ["none", "increase", "decrease"] },
    alert: { type: "boolean", description: "True if the human should be notified now" },
    alertReason: { type: "string", description: "Why an alert is warranted (only if alert is true). Name the pot if relevant." },
  },
  required: ["healthScore", "summary", "issues", "plants", "reservoirLevel", "waterTopUpMl", "lightAdjustment", "alert"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are the horticulturist brain of a small indoor hydroponic herb garden
(parsley and leafy greens). You receive photos from the grow chamber plus operating context.
Assess plant health, spot problems (wilting, yellowing, pests, low water, light stress, mould),
and decide on any small corrective watering or light change. Be conservative with water.
Report per-pot detail in "plants" (one entry per visible pot, numbered left to right from 1);
if an alert concerns a specific pot, name it in alertReason (e.g. "pot 3 cilantro wilting").
If a reservoir sight tube with a float bead is visible, read reservoirLevel ("ok" or "low"),
otherwise "unknown"; a low reservoir warrants an alert. Always answer by calling the record_verdict tool.`;

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

  // Weekly deep review: a stronger model looks at a week of photos + trend text
  // and returns a Telegram digest plus husbandry recommendations. Recommendations
  // that map to a settable config key carry configKey/configValue so the bot can
  // offer an [Apply] button (still routed through the same safety validation).
  async deepReview(photoPaths: string[], contextText: string): Promise<DeepReview> {
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

    const msg = await this.client.messages.create({
      model: this.cfg.brain.deepModel,
      max_tokens: Math.max(this.cfg.brain.maxTokens, 2048),
      system: DEEP_SYSTEM,
      tools: [
        {
          name: "record_review",
          description: "Record the weekly deep-review digest and recommendations.",
          input_schema: REVIEW_SCHEMA as unknown as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: "record_review" },
      messages: [{ role: "user", content: [...images, { type: "text", text: contextText }] }],
    });

    const raw = JSON.stringify(msg.content);
    const toolUse = msg.content.find((b) => b.type === "tool_use");
    if (toolUse && toolUse.type === "tool_use") {
      return { ...parseDeepReview(toolUse.input), raw };
    }
    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    return { ...parseDeepReview(extractJson(text)), raw: raw || text };
  }
}

export interface DeepRecommendation {
  text: string;
  configKey?: string; // a settable key, if this recommendation maps to a config change
  configValue?: string | number;
}

export interface DeepReview {
  digest: string;
  recommendations: DeepRecommendation[];
  raw: string;
}

const DEEP_SYSTEM = `You are the head horticulturist doing a WEEKLY deep review of a small indoor
hydroponic herb garden. You receive a week of sampled photos plus trend data (health, water, light).
Assess overall progress and give practical husbandry recommendations: pH/EC checks, thinning or
transplanting, harvest timing, and light/water schedule adjustments. Where a recommendation maps to
one of these config keys, set configKey/configValue so the operator can apply it with one tap:
${SETTABLE_KEYS.join(", ")}. Note that pump caps can only be lowered. Always answer by calling the
record_review tool.`;

const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    digest: { type: "string", description: "A few short paragraphs summarising the week and advice" },
    recommendations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "One concrete, actionable recommendation" },
          configKey: { type: "string", enum: SETTABLE_KEYS, description: "Config key this maps to, if any" },
          configValue: { type: ["string", "number"], description: "Proposed value for configKey" },
        },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  required: ["digest", "recommendations"],
  additionalProperties: false,
} as const;

export function parseDeepReview(raw: unknown): { digest: string; recommendations: DeepRecommendation[] } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const digest = typeof o.digest === "string" ? o.digest : "";
  const recommendations: DeepRecommendation[] = Array.isArray(o.recommendations)
    ? o.recommendations
        .map((r): DeepRecommendation | null => {
          const ro = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
          if (typeof ro.text !== "string" || !ro.text.trim()) return null;
          const rec: DeepRecommendation = { text: ro.text };
          if (typeof ro.configKey === "string" && isSettableKey(ro.configKey)) {
            rec.configKey = ro.configKey;
            if (typeof ro.configValue === "string" || typeof ro.configValue === "number") {
              rec.configValue = ro.configValue;
            }
          }
          return rec;
        })
        .filter((r): r is DeepRecommendation => r !== null)
    : [];
  return { digest, recommendations };
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
