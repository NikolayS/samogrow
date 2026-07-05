// Entry point: wire config, hardware, cameras, db, brain, controller, bot.
// Graceful shutdown turns the pump off and leaves the light as-is.

import { loadConfig } from "./config.ts";
import { Hardware } from "./hardware.ts";
import { Db } from "./state.ts";
import { Brain } from "./brain.ts";
import { Controller } from "./controller.ts";
import { GardenBot } from "./bot.ts";

function log(msg: string): void {
  console.log(`[${new Date().toISOString()}] [main] ${msg}`);
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  log(`starting samogrow (mock=${cfg.mockHardware}, model=${cfg.brain.model})`);

  const hw = new Hardware(cfg);
  const db = new Db(cfg);
  const brain = new Brain(cfg);
  const controller = new Controller(cfg, hw, db, brain);

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
    try {
      // Safety: ensure the pump is off. Light is left as-is.
      await hw.pump.timedPumpRun(0);
    } catch {
      /* ignore */
    }
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
