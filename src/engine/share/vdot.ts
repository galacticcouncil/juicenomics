import { vdotParams, VDOT_DEFAULTS, VDOT_V1_DEFAULTS, VDOT_V3_DEFAULTS, type VdotParams } from "../model/vdot";

export function encodeVdot(p: VdotParams): string {
  return "vd4." + btoa(JSON.stringify(vdotParams(p))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeVdot(token: string): VdotParams {
  if (!/^vd[1234]\./.test(token) || token.length > 8000) throw new Error("unknown or invalid vDOT link version");
  const defaults = token.startsWith("vd1.") ? VDOT_V1_DEFAULTS : token.startsWith("vd4.") ? VDOT_DEFAULTS : VDOT_V3_DEFAULTS;
  return vdotParams(JSON.parse(atob(token.slice(4).replace(/-/g, "+").replace(/_/g, "/"))), defaults);
}
