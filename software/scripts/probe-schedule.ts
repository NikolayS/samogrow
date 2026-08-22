// Discovery v3: component versions + structural variants of add_schedule_rule.
import { KlapConnection, klapAuthHash } from "../src/hardware.ts";
const host = process.argv[2] ?? "192.168.86.32";
const email = process.env.SAMOGROW_TPLINK_EMAIL ?? "";
const password = process.env.SAMOGROW_TPLINK_PASSWORD ?? "";
if (!email || !password) throw new Error("set creds");
const conn = new KlapConnection(host, klapAuthHash(email, password));
const ec = (r: unknown) => (r as { error_code?: number })?.error_code;

// 1) component negotiation — reveals the 'schedule' component version
try {
  const c = (await conn.request({ method: "component_nego" })) as {
    result?: { component_list?: Array<{ id: string; ver_code: number }> };
  };
  const sched = c.result?.component_list?.filter((x) =>
    /schedule|countdown|antitheft|auto/.test(x.id),
  );
  console.log("schedule-ish components:", JSON.stringify(sched));
} catch (e) {
  console.log("component_nego ERR", (e as Error).message);
}

// 2) structural variants
const variants: Array<{ tag: string; params: object }> = [
  { tag: "A s_action obj", params: { enable: true, s_min: 360, s_time_opt: 0, wday: [1,1,1,1,1,1,1], repeat: true, s_action: { type: "device_control", action: { device_on: true } }, day: 0, month: 0, year: 0 } },
  { tag: "B device_on flat", params: { enable: true, start_min: 360, week_day: 127, device_on: true, repeat: true } },
  { tag: "C nested rule", params: { rule: { enable: true, s_min: 360, wday: [1,1,1,1,1,1,1], repeat: true, s_action: { device_on: true } } } },
  { tag: "D minimal enable", params: { enable: true } },
  { tag: "E name+time_range", params: { enable: true, name: "on", time_range: { start_index: 360 }, action: { device_on: true }, week_day_list: [0,1,2,3,4,5,6] } },
];
for (const v of variants) {
  const r = await conn.request({ method: "add_schedule_rule", params: v.params });
  console.log(`add [${v.tag}] -> error_code=${ec(r)}  ${JSON.stringify(r).slice(0, 200)}`);
  if (ec(r) === 0) {
    const rl = await conn.request({ method: "get_schedule_rules", params: { start_index: 0 } });
    console.log("STORED:", JSON.stringify((rl as { result?: { rule_list?: unknown } }).result?.rule_list, null, 2).slice(0, 1500));
    await conn.request({ method: "remove_all_schedule_rules" });
    break;
  }
}
process.exit(0);
