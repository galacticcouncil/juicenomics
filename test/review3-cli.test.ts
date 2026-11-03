import { execFileSync, spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decode } from "../src/engine/share/codec";

it("the live command actually reads the supplied RPC", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/sim.mts", "live", "--block", "40000", "--rpc", "http://127.0.0.1:1"], { encoding: "utf8", timeout: 60000 });
  expect(r.error).toBeUndefined();
  expect(r.status).not.toBe(0);
});

const mc = (...args: string[]): { pool: string; link: string } => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/sim.mts", "mc", "--paths", "2", "--horizon", "7", "--workers", "1", "--fields", "aprBtc", ...args], { encoding: "utf8", timeout: 60000 }));

it("the CLI honors exact pool math selected through params", () => {
  const r = mc("--set", "sim.poolMode=exact");
  expect(r.pool).toBe("exact");
});

it("the exact CLI flag survives the generated share link", async () => {
  const r = mc("--exact");
  const token = new URLSearchParams(new URL(r.link).hash.slice(1)).get("s") ?? "";
  const back = await decode(token);
  expect(back.error).toBeUndefined();
  expect(r.pool).toBe("exact");
  expect(back.params.sim.poolMode).toBe("exact");
});

const sim = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "scripts/sim.mts", ...args], { encoding: "utf8", timeout: 60000 });

it("the CLI models Lark 0 with --deployment, and its links say so", async () => {
  const r = sim("mc", "--deployment", "lark0", "--paths", "2", "--horizon", "7", "--workers", "1", "--fields", "aprEth,aprBtc");
  expect(r.status, r.stderr).toBe(0);
  const out = JSON.parse(r.stdout) as { link: string; mc: Record<string, unknown> };
  expect(Object.keys(out.mc).sort()).toEqual(["aprEth", "aprWorst"]);
  const back = await decode(new URLSearchParams(new URL(out.link).hash.slice(1)).get("s") ?? "");
  expect(back.params.deployment).toBe("lark0");
  expect(back.params.vaults.eth.on && !back.params.vaults.btc.on).toBe(true);
});

it("the CLI refuses a preset or link from another deployment", async () => {
  expect(sim("cf", "--preset", "jbtc").stderr).toMatch(/preset jbtc is for lark0/);
  const lark0 = JSON.parse(sim("link", "--deployment", "lark0").stdout) as { link: string };
  expect(sim("cf", "--deployment", "lark4", "--link", lark0.link).stderr).toMatch(/--deployment lark4, but the preset, link or config is on lark0/);
  expect(sim("cf", "--deployment", "lark9").stderr).toMatch(/unknown deployment lark9/);
});
