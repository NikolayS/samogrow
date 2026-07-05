// Entry point: wire config, hardware, cameras, db, brain, controller, bot.
// Graceful shutdown turns the pump off and leaves the light as-is.

import { loadConfig } from "./config.ts";
import { Hardware } from "./hardware.ts";
import { Db } from "./state.ts";
import { Brain } from "./brain.ts";
import { Controller } from "./controller.ts";
import { GardenBot } from "./bot.ts";
import { applyOverrides, loadOverrides, type BaseCaps } from "./overrides.ts";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [main] ${msg}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  // Capture the config.json pump caps as the hard ceiling BEFORE merging any
  // remote overrides — overrides can only lower them, never raise.
  const baseCaps: BaseCaps = {
    maxSecondsPerRun: cfg.pump.maxSecondsPerRun,
    maxSecondsPerDay: cfg.pump.maxSecondsPerDay,
  };
  const overrides = loadOverrides(cfg.dataDir);
  applyOverrides(cfg, overrides, baseCaps); // effective config (caps clamped) before hardware is built
  log(`starting samogrow (mock=${cfg.mockHardware}, model=${cfg.brain.model})`);

  const hw = new Hardware(cfg);
  // Safety: force the pump plug OFF on startup in case a previous run crashed
  // mid-watering and left it on. In manual mode there is no pump to switch.
  if (hw.pump) await hw.pump.ensureOff();
  else log("manual watering mode (no pump.plugHost) — the AI will remind you to water by hand");
  const db = new Db(cfg);
  const brain = new Brain(cfg);
  const controller = new Controller(cfg, hw, db, brain, baseCaps, overrides);

  let bot: GardenBot | null = null;
  if (cfg.telegramToken) {
    bot = new GardenBot(cfg, controller);
    bot.start();
  } else {
    log("no telegram token set — running headless (controller only)");
  }

  controller.start();
  db.logEvent("startup", { mock: cfg.mockHardware });

  let shuttingDown = false;
  const shutdown = async (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`received ${sig}, shutting down`);
    controller.stop();
    // Safety: force the pump plug OFF (twice). Light is left as-is.
    if (hw.pump) await hw.pump.ensureOff().catch(() => {});
    if (bot) await bot.stop().catch(() => {});
    db.logEvent("shutdown", {});
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error(`[main] fatal: ${e}`);
  process.exit(1);
});
