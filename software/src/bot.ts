// Telegram bot (grammY). Only obeys cfg.telegramChatId; everyone else is ignored.
//
// Commands: /status /photo /water <ml> /light on|off|auto [min] /report /analyze /help
// It also pushes alerts and the daily report proactively to the chat.

import { Bot, InlineKeyboard, InputFile } from "grammy";
import Anthropic from "@anthropic-ai/sdk";
import { join } from "node:path";
import type { Config } from "./config.ts";
import type { Controller, DeepReviewPayload } from "./controller.ts";
import type { Verdict, DeepRecommendation } from "./brain.ts";
import { runConversation } from "./conversation.ts";
import { buildTimelapse } from "./timelapse.ts";

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function fmtPlants(v: Verdict): string {
  return "Pots: " + v.plants.map((p) => `#${p.pot} ${p.species ?? "?"} ${p.stage} ${p.health}/10`).join(" | ");
}

function fmtVerdict(v: Verdict): string {
  const parts = [`health ${v.healthScore}/10`, v.summary];
  if (v.issues.length) parts.push(`issues: ${v.issues.join("; ")}`);
  if (v.waterTopUpMl) parts.push(`suggested top-up: ${v.waterTopUpMl} ml`);
  if (v.lightAdjustment !== "none") parts.push(`light: ${v.lightAdjustment}`);
  if (v.alert) parts.push(`⚠️ ${v.alertReason ?? "alert"}`);
  return parts.join("\n");
}

export class GardenBot {
  private bot: Bot;
  private readonly chatId: string;
  private readonly llm: Anthropic;
  // Rolling conversation history (text turns only), reset with /new.
  private convHistory: Anthropic.MessageParam[] = [];
  // Pending deep-review recommendations, keyed by an id embedded in the button.
  private pendingRecs = new Map<number, { key: string; value: string | number }>();
  private recCounter = 0;

  constructor(
    private readonly cfg: Config,
    private readonly controller: Controller,
  ) {
    this.bot = new Bot(cfg.telegramToken);
    this.chatId = cfg.telegramChatId;
    this.llm = new Anthropic({ apiKey: cfg.anthropicApiKey });

    // Gate: ignore anyone who isn't the configured owner.
    this.bot.use(async (ctx, next) => {
      const from = ctx.chat?.id ?? ctx.from?.id;
      if (String(from) === this.chatId) await next();
    });

    this.registerCommands();
    this.registerCallbacks();
    this.registerConversation();

    controller.setCallbacks({
      onAlert: (p) => void this.pushAlert(p.verdict, p.photos),
      onReport: (p) => void this.pushReport(p.text, p.photo),
      onDeepReview: (p) => void this.pushReview(p),
      onPumpAlert: (p) => void this.pushPumpAlert(p.reason),
    });
  }

  private registerCommands(): void {
    const b = this.bot;

    b.command("start", (ctx) => ctx.reply("🌿 samogrow online. /help for commands."));

    b.command("help", (ctx) =>
      ctx.reply(
        [
          "/status – light, last analysis (per-pot), pump budget, uptime",
          "/photo – capture and send photos now",
          "/water <ml> – water now (default 100, asks to confirm)",
          "/light on|off|auto [minutes] – override the light",
          "/report – send the daily digest now (with trend sparklines)",
          "/analyze – run an AI check now",
          "/timelapse [days] – build an MP4 timelapse of camera 0 (default 7)",
          "/review – run the weekly deep review now",
          "/set [<key> <value>] – list or change a tunable setting",
          "/pump [enable] – pump-health status; re-enable after a lockout",
          "/new – reset the chat conversation",
          "/help – this message",
          "",
          "Or just chat: send any message (e.g. \"how's the basil?\") and I'll answer.",
        ].join("\n"),
      ),
    );

    b.command("status", (ctx) => {
      const s = this.controller.status();
      const lines = [
        `Light: ${s.lightOn ? "ON" : "OFF"}${s.override ? ` (override ${s.override.mode})` : ""}`,
        `Pump budget: ${s.pumpBudgetUsedSeconds}s / ${s.pumpBudgetTotalSeconds}s today`,
        s.pumpLocked ? `⚠️ Pump LOCKED: ${s.pumpLockReason}` : "Pump: healthy",
        `Uptime: ${fmtUptime(s.uptimeSeconds)}`,
        s.lastVerdict
          ? `Last check (${s.lastAnalysisTs}): health ${s.lastVerdict.healthScore}/10 — ${s.lastVerdict.summary}`
          : "No analysis yet.",
      ];
      if (s.lastVerdict) lines.push(`Reservoir: ${s.lastVerdict.reservoirLevel}`);
      if (s.lastVerdict && s.lastVerdict.plants.length) lines.push(fmtPlants(s.lastVerdict));
      return ctx.reply(lines.join("\n"));
    });

    b.command("photo", async (ctx) => {
      await ctx.reply("📸 capturing…");
      const photos = await this.controller.photoNow();
      if (!photos.length) return ctx.reply("No cameras responded.");
      for (const p of photos) await ctx.replyWithPhoto(new InputFile(p));
    });

    b.command("water", (ctx) => {
      const arg = ctx.match.trim();
      const ml = arg ? Number(arg) : 100;
      if (!Number.isFinite(ml) || ml <= 0) return ctx.reply("Usage: /water <ml>");
      return ctx.reply(...this.waterConfirm(ml));
    });

    b.command("light", async (ctx) => {
      const [modeRaw, minRaw] = ctx.match.trim().split(/\s+/);
      const mode = modeRaw as "on" | "off" | "auto";
      if (mode !== "on" && mode !== "off" && mode !== "auto") {
        return ctx.reply("Usage: /light on|off|auto [minutes]");
      }
      const minutes = minRaw ? Number(minRaw) : 60;
      if (mode !== "auto" && (!Number.isFinite(minutes) || minutes <= 0)) {
        return ctx.reply("Minutes must be a positive number.");
      }
      await this.controller.lightOverride(mode, minutes);
      return ctx.reply(mode === "auto" ? "Light back on schedule." : `Light forced ${mode} for ${minutes} min.`);
    });

    b.command("report", (ctx) => ctx.reply(this.controller.reportText()));

    b.command("analyze", async (ctx) => {
      await ctx.reply("🔎 running an AI check…");
      const v = await this.controller.analyzeNow();
      return ctx.reply(v ? fmtVerdict(v) : "Analysis failed or no photos.");
    });

    b.command("timelapse", async (ctx) => {
      const arg = ctx.match.trim();
      const days = arg ? Number(arg) : 7;
      if (!Number.isFinite(days) || days <= 0) return ctx.reply("Usage: /timelapse [days]");
      await ctx.reply(`🎞️ building a ${days}-day timelapse…`);
      try {
        const out = join(this.cfg.dataDir, "timelapse.mp4");
        const res = await buildTimelapse(this.cfg, out, { days });
        if (!res) return ctx.reply("No archived photos for that window yet.");
        await ctx.replyWithVideo(new InputFile(res.outPath), { caption: `${res.frameCount} frames over ${days} day(s)` });
      } catch (e) {
        return ctx.reply(`Timelapse failed: ${e}`);
      }
    });

    b.command("review", async (ctx) => {
      await ctx.reply("🔬 running the deep review… (this can take a minute)");
      const r = await this.controller.runDeepReview();
      if (!r) return ctx.reply("Deep review failed.");
      // The onDeepReview callback delivers the digest + buttons.
    });

    b.command("set", (ctx) => {
      const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        const lines = this.controller.effectiveConfig().map((c) => `${c.key} = ${c.value}`);
        return ctx.reply(["Effective settings:", ...lines, "", "Usage: /set <key> <value>"].join("\n"));
      }
      const [key, ...rest] = parts;
      if (rest.length === 0) return ctx.reply("Usage: /set <key> <value>");
      const res = this.controller.setSetting(key!, rest.join(" "));
      return ctx.reply(res.ok ? `✅ ${res.key} = ${res.value}` : `❌ ${res.error}`);
    });

    b.command("pump", (ctx) => {
      const arg = ctx.match.trim().toLowerCase();
      if (arg === "enable" || arg === "reset") {
        this.controller.enablePump();
        return ctx.reply("✅ Pump re-enabled — automatic watering resumed.");
      }
      const s = this.controller.status();
      return ctx.reply(
        s.pumpLocked
          ? `⚠️ Pump is LOCKED: ${s.pumpLockReason}\nCheck the pump/reservoir, then send /pump enable.`
          : "Pump: healthy. Automatic watering is enabled.",
      );
    });

    b.command("new", (ctx) => {
      this.convHistory = [];
      return ctx.reply("🧹 conversation reset.");
    });
  }

  // Build the watering-confirmation prompt. When the pump is locked out, the
  // button carries the explicit-override callback instead of the normal one.
  private waterConfirm(ml: number): [string, { reply_markup: InlineKeyboard }] {
    if (this.controller.pumpLocked()) {
      const kb = new InlineKeyboard().text(`⚠️ Override & water ${ml} ml`, `owater:${ml}`).text("Cancel", "cancel");
      return [`Pump is LOCKED out. Watering needs an explicit override — confirm ${ml} ml?`, { reply_markup: kb }];
    }
    const kb = new InlineKeyboard().text(`💧 Water ${ml} ml`, `water:${ml}`).text("Cancel", "cancel");
    return [`Confirm watering ${ml} ml?`, { reply_markup: kb }];
  }

  private registerCallbacks(): void {
    this.bot.callbackQuery(/^water:(\d+(?:\.\d+)?)$/, async (ctx) => {
      const ml = Number(ctx.match![1]);
      await ctx.answerCallbackQuery();
      const actual = await this.controller.waterNow(ml);
      await ctx.editMessageText(actual > 0 ? `💧 Watered ${actual.toFixed(0)} ml.` : "Watering skipped (budget reached).");
    });

    // Explicit override watering while the pump is locked out.
    this.bot.callbackQuery(/^owater:(\d+(?:\.\d+)?)$/, async (ctx) => {
      const ml = Number(ctx.match![1]);
      await ctx.answerCallbackQuery();
      const actual = await this.controller.waterNow(ml, { override: true });
      await ctx.editMessageText(
        actual > 0 ? `💧 Override: watered ${actual.toFixed(0)} ml (pump stays locked).` : "Watering skipped (budget reached).",
      );
    });

    // Acknowledge a pump fix and re-enable automatic watering.
    this.bot.callbackQuery("pump:enable", async (ctx) => {
      await ctx.answerCallbackQuery();
      this.controller.enablePump();
      await ctx.editMessageText("✅ Pump re-enabled — automatic watering resumed.");
    });

    this.bot.callbackQuery("cancel", async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("Cancelled.");
    });

    this.bot.callbackQuery("ignore", async (ctx) => {
      await ctx.answerCallbackQuery("Ignored");
      await ctx.editMessageReplyMarkup();
    });

    // Deep-review recommendation buttons.
    this.bot.callbackQuery(/^rvapply:(\d+)$/, async (ctx) => {
      const id = Number(ctx.match![1]);
      await ctx.answerCallbackQuery();
      const rec = this.pendingRecs.get(id);
      if (!rec) return ctx.editMessageText("This recommendation is no longer available.");
      const res = this.controller.setSetting(rec.key, rec.value);
      this.pendingRecs.delete(id);
      await ctx.editMessageText(res.ok ? `✅ Applied ${res.key} = ${res.value}` : `❌ ${res.error}`);
    });

    this.bot.callbackQuery(/^rvskip:(\d+)$/, async (ctx) => {
      await ctx.answerCallbackQuery("Skipped");
      this.pendingRecs.delete(Number(ctx.match![1]));
      await ctx.editMessageReplyMarkup();
    });
  }

  // Non-command text messages go to Claude with tool use (conversational mode).
  private registerConversation(): void {
    this.bot.on("message:text", async (ctx) => {
      const text = ctx.message.text;
      if (!text || text.startsWith("/")) return; // slash commands are handled above
      await ctx.replyWithChatAction("typing").catch(() => {});
      try {
        const res = await runConversation(this.llm, this.cfg, this.controller, this.convHistory, text);
        this.convHistory = res.history;
        await ctx.reply(res.reply);
        for (const p of res.photos) await ctx.replyWithPhoto(new InputFile(p)).catch(() => {});
        if (res.confirmWaterMl !== undefined) {
          await ctx.reply(...this.waterConfirm(res.confirmWaterMl));
        }
      } catch (e) {
        await ctx.reply(`Sorry, I hit an error: ${e}`);
      }
    });
  }

  private async pushPumpAlert(reason: string): Promise<void> {
    const kb = new InlineKeyboard().text("Pump fixed — re-enable", "pump:enable");
    try {
      await this.bot.api.sendMessage(
        this.chatId,
        `⚠️ Pump health alert: ${reason}\nAutomatic watering is LOCKED until you re-enable (button below or /pump enable).`,
        { reply_markup: kb },
      );
    } catch (e) {
      console.error(`[bot] failed to push pump alert: ${e}`);
    }
  }

  private async pushReview(p: DeepReviewPayload): Promise<void> {
    const lines: string[] = ["🔬 Weekly deep review", "", p.digest];
    if (p.recommendations.length) {
      lines.push("", "Recommendations:");
      for (const r of p.recommendations) lines.push(`• ${r.text}`);
    }
    const kb = new InlineKeyboard();
    const actionable = p.recommendations.filter(
      (r): r is DeepRecommendation & { configKey: string; configValue: string | number } =>
        typeof r.configKey === "string" && r.configValue !== undefined,
    );
    for (const r of actionable) {
      const id = this.recCounter++;
      this.pendingRecs.set(id, { key: r.configKey, value: r.configValue });
      kb.text(`Apply ${r.configKey}=${r.configValue}`, `rvapply:${id}`).text("Skip", `rvskip:${id}`).row();
    }
    try {
      if (p.photo) await this.bot.api.sendPhoto(this.chatId, new InputFile(p.photo)).catch(() => {});
      await this.bot.api.sendMessage(this.chatId, lines.join("\n"), actionable.length ? { reply_markup: kb } : {});
    } catch (e) {
      console.error(`[bot] failed to push review: ${e}`);
    }
  }

  private async pushAlert(verdict: Verdict, photos: string[]): Promise<void> {
    const kb = new InlineKeyboard().text("💧 Water 100 ml", "water:100").text("Ignore", "ignore");
    const caption = `⚠️ Alert: ${verdict.alertReason ?? "issue detected"}\n${fmtVerdict(verdict)}`;
    try {
      if (photos[0]) {
        await this.bot.api.sendPhoto(this.chatId, new InputFile(photos[0]), { caption, reply_markup: kb });
      } else {
        await this.bot.api.sendMessage(this.chatId, caption, { reply_markup: kb });
      }
    } catch (e) {
      console.error(`[bot] failed to push alert: ${e}`);
    }
  }

  private async pushReport(text: string, photo?: string): Promise<void> {
    try {
      if (photo) await this.bot.api.sendPhoto(this.chatId, new InputFile(photo), { caption: text });
      else await this.bot.api.sendMessage(this.chatId, text);
    } catch (e) {
      console.error(`[bot] failed to push report: ${e}`);
    }
  }

  start(): void {
    // grammY long-polling; runs until stop().
    void this.bot.start({ onStart: () => console.log(`[${new Date().toISOString()}] [bot] started`) });
  }

  async stop(): Promise<void> {
    await this.bot.stop();
  }
}
