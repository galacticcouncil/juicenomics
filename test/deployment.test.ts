import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";

const revision = "a".repeat(40);
const render = (target: string, suffix = target === "two-strategy" ? "-two-strategy" : "") => spawnSync(process.execPath, ["scripts/deploy-lark.mjs"], {
  encoding: "utf8",
  env: { ...process.env, DEPLOY_TARGET: target, DEPLOY_DRY_RUN: "1", DEPLOY_REVISION: revision, DEPLOY_IMAGE: `galacticcouncil/juicenomics:${revision}${suffix}@sha256:${"b".repeat(64)}` },
});

it("the preview has its own stack, router, service, hostname and image tag", () => {
  const r = render("two-strategy");
  expect(r.status, r.stderr).toBe(0);
  const p = JSON.parse(r.stdout);
  expect(p.name).toBe("juicenomics-two-strategy");
  expect(p.site).toBe("https://juicenomics-two-strategy.lark.hydration.cloud");
  expect(p.compose).toContain(p.image);
  expect(p.compose).toContain("routers.juicenomics-two-strategy.rule");
  expect(p.compose).not.toContain("Host(`juicenomics.lark.hydration.cloud`)");
  expect(p.compose).not.toContain("juicenomics-legacy");
  expect(p.compose).not.toContain("routers.juicenomics.");
});

it("production preserves its hostname and legacy redirect, and rejects preview images", () => {
  const r = render("production");
  expect(r.status, r.stderr).toBe(0);
  const p = JSON.parse(r.stdout);
  expect(p.name).toBe("juicenomics");
  expect(p.compose).toContain("Host(`juicenomics.lark.hydration.cloud`)");
  expect(p.compose).toContain("juicenomics-legacy");
  expect(render("production", "-two-strategy").status).not.toBe(0);
  expect(render("two-strategy", "").status).not.toBe(0);
  expect(render("prodution").status).not.toBe(0);
});
