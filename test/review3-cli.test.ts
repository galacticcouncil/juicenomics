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
