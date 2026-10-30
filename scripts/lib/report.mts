import { worst, type ClosedResult } from "../../src/engine/model/closedForm";

/** the closed-form figures a study table needs */
export function cfSummaryLite(r: ClosedResult) {
  return {
    worst: worst(r, (v) => v.net),
    eth: r.vaults.eth.on ? r.vaults.eth.net : null,
    btc: r.vaults.btc.on ? r.vaults.btc.net : null,
    leverage: r.lev.L,
    liqDrop: r.lev.liqDrop,
    entryBps: r.costs.entryBps,
    unwindBps: r.costs.unwindBps,
    churnBtc: r.vaults.btc.churn,
    churnEth: r.vaults.eth.on ? r.vaults.eth.churn : null,
    headroomShare: r.exits.headroomShare,
    protocolUsd: r.protocol.total,
    // depositors plus protocol, % of TVL: what the configuration earns before anyone splits it
    pie: (r.totals.userNet + r.protocol.total) / Math.max(1, r.totals.avgTvlUsd),
    protocolPct: r.totals.avgTvlUsd > 0 ? r.protocol.total / r.totals.avgTvlUsd : 0,
    hollarInterest: r.protocol.hollarInterest,
    collateralFee: r.protocol.collateralFee,
    lpFees: r.protocol.lpFees,
    hollarDebtUsd: r.hollar.debtUsd,
    hollarPerDollar: r.hollar.perDollar,
    hollarOverHeadroom: r.hollar.overHeadroom,
    hollarSoldPerYear: r.hollar.soldPerYear,
    hollarBoughtPerYear: r.hollar.boughtPerYear,
    netting: r.scale.netting,
    issues: r.issues,
  };
}
