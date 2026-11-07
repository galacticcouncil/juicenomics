import { vdotParams, VDOT_DEFAULTS, VDOT_V1_DEFAULTS, type VdotParams } from "../model/vdot";

export function encodeVdot(p: VdotParams): string {
  return "vd2." + btoa(JSON.stringify(vdotParams(p))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeVdot(token: string): VdotParams {
  if (!/^vd[12]\./.test(token) || token.length > 8000) throw new Error("unknown or invalid vDOT link version");
  return vdotParams(JSON.parse(atob(token.slice(4).replace(/-/g, "+").replace(/_/g, "/"))), token.startsWith("vd1.") ? VDOT_V1_DEFAULTS : VDOT_DEFAULTS);
}
