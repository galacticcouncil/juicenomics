// headless juicenomics for scripts and agents: every command prints one JSON document on stdout
import { evaluate, type ClosedResult } from "../src/engine/model/closedForm";
import { KNOBS, KNOB, METRIC, METRICS, pareto, search, type Constraints, type Knob } from "../src/engine/opt/explore";
import { LARK4, SNAPSHOT } from "../src/engine/params/defaults";
import { PRESETS } from "../src/engine/params/presets";
import { GROUPS, PARAMS, getPath } from "../src/engine/params/schema";
import type { Params } from "../src/engine/params/types";
import { decode, diff, encode } from "../src/engine/share/codec";
import { backtest } from "./lib/backtest.mts";
import { buildParams, flag, num, parseArgs, str, type Args } from "./lib/config.mts";
import { hollarState } from "./lib/hollar.mts";
import { runMc, seriesBands, summarize } from "./lib/mc.mts";

const SITE = "https://juicenomics.lark.hydration.cloud/";

const HELP = `juicenomics headless: npm run sim -- <command> [options]   (JSON on stdout, errors on stderr)

commands
  params [--group g] [--search text]   every setting: path, url code, unit, range, lever, default, help
  presets                              named scenarios
  cf                                   closed form for the config
  mc [--paths 64] [--horizon 365] [--workers n] [--exact] [--series] [--fields a,b]
                                       Monte Carlo, parallel; per-field mean/se/p5…p95 plus the closed form
  search [--tier today|contract|all] [--knobs a,b] [--metric worst] [--min-apr x] [--min-protocol x]
         [--max-breakeven d] [--min-liq x] [--no-stall] [--no-close] [--within-headroom] [--max-hollar usd]
         [--samples 1500] [--seed 1] [--top 5] [--verify paths]
                                       closed-form search over knobs; --verify re-runs the best with the Monte Carlo
  knobs                                what search can move, with ranges and levers
  live [--block n] [--rpc url]         chain state as a config (diff + share link)
  link [token|url]                     decode a share link, or encode the config when none is given
  backtest [--rpc url]                 replay Lark 4 history against the simulator (carry, deposit ramp)
  hollar [--evm url] [--ws url]        HOLLAR supply, facilitator buckets and HSM inventory on mainnet

config (applied in this order, all optional)
  --preset key | --link <share url or token> | --config file.json (nested params or {"path": value})
  --live [--block n]    start from the chain's state      --tvl usd   scale both vaults to a total TVL
  --set path=value      any parameter, repeatable (see: params)
  --pretty              indent the JSON

examples
  npm run sim -- cf --set loop.mode=lev --set loop.leverage=3
  npm run sim -- mc --tvl 1000000 --set sim.initial=ramped --paths 96
  npm run sim -- search --tier today --tvl 500000 --set sim.initial=ramped --min-protocol 0.05 --min-liq 0.05 --no-stall --verify 32
`;

const out = (a: Args, x: unknown) => process.stdout.write(`${JSON.stringify(x, (_, v) => (typeof v === "number" && !Number.isFinite(v) ? String(v) : v), flag(a, "pretty") ? 2 : 0)}\n`);

/** the closed form's headline numbers; --full prints everything */
export function cfSummary(r: ClosedResult) {
  const v = (k: "eth" | "btc") => {
    const x = r.vaults[k];
    return { tvlUsd: x.tvlUsd, avgTvlUsd: x.avgTvlUsd, net: x.net, horizonApr: x.horizonApr, year1: x.year1, gross: x.gross, churn: x.churn, flows: x.flows, feeTaken: x.feeTaken, avgLtv: x.avgLtv, breakEvenDays: x.breakEvenDays, rebalancesPerYear: x.bands.eventsPerYear };
  };
  return {
    leverage: r.lev.L, hfEff: r.lev.hfEff, liqDrop: r.lev.liqDrop,
    entryBps: r.costs.entryBps, unwindBps: r.costs.unwindBps, stall: r.costs.stall, deskCoverage: r.costs.deskCoverage,
    vaults: { eth: v("eth"), btc: v("btc") },
    breakEven: r.breakEven, deficit: r.deficit, protocol: r.protocol, hollar: r.hollar, totals: r.totals, scale: r.scale, issues: r.issues,
  };
}

async function link(p: Params) {
  const t = await encode(p);
  return t ? `${SITE}#s=${t}` : SITE;
}

function tierKnobs(a: Args): Knob[] {
  const list = flag(a, "knobs");
  if (typeof list === "string") {
    return list.split(",").map((k) => {
      const knob = KNOB.get(k.trim());
      if (!knob) throw new Error(`unknown knob ${k} (see: sim knobs)`);
      return knob;
    });
  }
  const tier = str(a, "tier", "today");
  const levers = tier === "today" ? ["admin", "ops"] : tier === "contract" ? ["admin", "ops", "contract"] : ["admin", "ops", "contract", "market"];
  // the HOLLAR rate is money-market wide, not Juicer's to set; market conditions only move under --tier all
  return KNOBS.filter((k) => levers.includes(k.lever) && (tier === "all" || k.key !== "market.hollarRate"));
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const cmd = a._[0];
  if (!cmd || cmd === "help" || flag(a, "help")) {
    process.stdout.write(HELP);
    return;
  }
  if (cmd === "params") {
    const g = str(a, "group", "");
    const q = str(a, "search", "").toLowerCase();
    out(a, PARAMS.filter((d) => (!g || d.group === g) && (!q || `${d.path} ${d.label} ${d.help}`.toLowerCase().includes(q))).map((d) => ({
      path: d.path, code: d.code, group: d.group, label: d.label, kind: d.kind, unit: d.unit, min: d.min, max: d.max, step: d.step,
      options: d.options?.map((o) => o.value), lever: d.lever, scope: d.scope, default: getPath(LARK4, d.path), help: d.help, source: d.source,
    })).concat([] as never[]));
    return;
  }
  if (cmd === "groups") return out(a, GROUPS);
  if (cmd === "presets") return out(a, PRESETS.map((x) => ({ key: x.key, label: x.label, note: x.note })));
  if (cmd === "knobs") return out(a, KNOBS.map((k) => ({ key: k.key, label: k.label, unit: k.unit, min: k.min, max: k.max, lever: k.lever, default: k.get(LARK4) })));
  if (cmd === "hollar") return out(a, await hollarState(str(a, "evm", "https://hdx.tarn.hydration.cloud"), str(a, "ws", "wss://hdx.tarn.hydration.cloud")));
  if (cmd === "backtest") return out(a, await backtest(str(a, "rpc", "https://node4.lark.hydration.cloud")));
  if (cmd === "link" && a._[1]) {
    const tokenArg = a._[1];
    const token = tokenArg.includes("#") ? (new URLSearchParams(tokenArg.slice(tokenArg.indexOf("#") + 1)).get("s") ?? "") : tokenArg;
    const d = await decode(token);
    return out(a, { error: d.error, ignored: d.ignored, clamped: d.clamped, diff: diff(d.params), params: flag(a, "full") ? d.params : undefined });
  }

  // the live command always reads the chain; --live does the same for every other command
  if (cmd === "live") a.flags.live = true;
  const { params, notes } = await buildParams(a);
  if (cmd === "link") return out(a, { link: await link(params), diff: diff(params), notes });
  if (cmd === "live") return out(a, { link: await link(params), diff: diff(params), notes, snapshotBlock: SNAPSHOT.evmBlock });
  if (cmd === "cf") {
    const r = evaluate(params);
    return out(a, { notes, link: await link(params), ...(flag(a, "full") ? { result: r } : cfSummary(r)) });
  }
  if (cmd === "mc") {
    const p = structuredClone(params);
    if (flag(a, "horizon")) p.sim.horizonDays = num(a, "horizon", 365);
    // one pool selection for the run, its metadata and its link
    if (flag(a, "exact")) p.sim.poolMode = "exact";
    const paths = num(a, "paths", 64);
    const run = await runMc(p, { paths, workers: flag(a, "workers") ? num(a, "workers", 1) : undefined, series: !!flag(a, "series") });
    const fields = flag(a, "fields");
    return out(a, {
      notes, link: await link(p), paths, days: run.days, ms: run.ms, pool: p.sim.poolMode,
      mc: summarize(run.summaries, typeof fields === "string" ? fields.split(",") : undefined),
      cf: cfSummary(evaluate(p)),
      series: flag(a, "series") ? seriesBands(run.series, run.days) : undefined,
    });
  }
  if (cmd === "search") {
    const knobs = tierKnobs(a);
    const metric = METRIC.get(str(a, "metric", "worst"));
    if (!metric) throw new Error(`unknown metric (one of ${METRICS.map((m) => m.key).join(", ")})`);
    const cons: Constraints = {
      minUserApr: num(a, "min-apr", -1), minProtocolPct: num(a, "min-protocol", -10), maxBreakEvenDays: num(a, "max-breakeven", Infinity),
      noStall: !!flag(a, "no-stall"), noClose: !!flag(a, "no-close"), minLiqDrop: num(a, "min-liq", 0),
      maxHollarUsd: flag(a, "max-hollar") ? num(a, "max-hollar", Infinity) : undefined, withinHeadroom: !!flag(a, "within-headroom"),
    };
    const res = search(params, knobs, metric, cons, num(a, "samples", 1500), num(a, "seed", 1));
    const top = res.best.slice(0, num(a, "top", 5));
    const verify = flag(a, "verify") ? num(a, "verify", 32) : 0;
    const rows = [];
    for (const c of top) {
      const row: Record<string, unknown> = { values: c.values, score: c.score, cf: cfSummary(c.result), link: await link(c.params) };
      if (verify) {
        const run = await runMc(c.params, { paths: verify });
        row.mc = summarize(run.summaries, ["aprEth", "aprBtc", "protocol", "entryAvgBps", "unwindAvgBps", "stallHours", "unwindStallHours", "arbDryHours", "stopHoursEth", "stopHoursBtc", "minHf", "hollarDebtPeakUsd", "arbHollarNetUsd", "conservationGapUsd"]);
      }
      rows.push(row);
    }
    const front = pareto(res.all.filter((c) => c.feasible)).slice(0, 40).map((c) => ({ worst: Math.min(c.result.vaults.eth.net, c.result.vaults.btc.net), protocol: c.result.protocol.total, values: c.values }));
    return out(a, { notes, knobs: knobs.map((k) => k.key), metric: metric.key, constraints: cons, feasible: res.all.filter((c) => c.feasible).length, evaluated: res.all.length, best: rows, front });
  }
  throw new Error(`unknown command ${cmd} (try: npm run sim -- help)`);
}

main().catch((e) => {
  process.stderr.write(`${(e as Error).message}\n`);
  process.exit(1);
});
