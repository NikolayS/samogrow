// Telegram bot (grammY). Only obeys cfg.telegramChatId; everyone else is ignored.
//
// Commands: /status /photo /water <ml> /light on|off|auto [min] /report /analyze /help
// It also pushes alerts and the daily report proactively to the chat.

import { Bot, InlineKeyboard, InputFile } from "grammy";
import type { Config } from "./config.ts";
import type { Controller } from "./controller.ts";
import type { Verdict } from "./brain.ts";

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
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

  constructor(
    private readonly cfg: Config,
    private readonly controller: Controller,
  ) {
    this.bot = new Bot(cfg.telegramToken);
    this.chatId = cfg.telegramChatId;

    // Gate: ignore anyone who isn't the configured owner.
    this.bot.use(async (ctx, next) => {
      const from = ctx.chat?.id ?? ctx.from?.id;
      if (String(from) === this.chatId) await next();
    });

    this.registerCommands();
    this.registerCallbacks();

    controller.setCallbacks({
      onAlert: (p) => void this.pushAlert(p.verdict, p.photos),
      onReport: (p) => void this.pushReport(p.text, p.photo),
    });
  }

  private registerCommands(): void {
    const b = this.bot;

    b.command("start", (ctx) => ctx.reply("🌿 samogrow online. /help for commands."));

    b.command("help", (ctx) =>
      ctx.reply(
        [
          "/status – light, last analysis, pump budget, uptime",
          "/photo – capture and send photos now",
          "/water <ml> – water now (default 100, asks to confirm)",
          "/light on|off|auto [minutes] – override the light",
          "/report – send the daily digest now",
          "/analyze – run an AI check now",
          "/help – this message",
        ].join("\n"),
      ),
    );

    b.command("status", (ctx) => {
      const s = this.controller.status();
      const lines = [
        `Light: ${s.lightOn ? "ON" : "OFF"}${s.override ? ` (override ${s.override.mode})` : ""}`,
        `Pump budget: ${s.pumpBudgetUsedSeconds}s / ${s.pumpBudgetTotalSeconds}s today`,
        `Uptime: ${fmtUptime(s.uptimeSeconds)}`,
        s.lastVerdict
          ? `Last check (${s.lastAnalysisTs}): health ${s.lastVerdict.healthScore}/10 — ${s.lastVerdict.summary}`
          : "No analysis yet.",
      ];
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
      const kb = new InlineKeyboard().text(`💧 Water ${ml} ml`, `water:${ml}`).text("Cancel", "cancel");
      return ctx.reply(`Confirm watering ${ml} ml?`, { reply_markup: kb });
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
  }

  private registerCallbacks(): void {
    this.bot.callbackQuery(/^water:(\d+(?:\.\d+)?)$/, async (ctx) => {
      const ml = Number(ctx.match![1]);
      await ctx.answerCallbackQuery();
      const actual = await this.controller.waterNow(ml);
      await ctx.editMessageText(actual > 0 ? `💧 Watered ${actual.toFixed(0)} ml.` : "Watering skipped (budget reached).");
    });

    this.bot.callbackQuery("cancel", async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.editMessageText("Cancelled.");
    });

    this.bot.callbackQuery("ignore", async (ctx) => {
      await ctx.answerCallbackQuery("Ignored");
      await ctx.editMessageReplyMarkup();
    });
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
