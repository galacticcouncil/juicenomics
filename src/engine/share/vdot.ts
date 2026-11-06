import { vdotParams, type VdotParams } from "../model/vdot";

export function encodeVdot(p: VdotParams): string {
  return "vd1." + btoa(JSON.stringify(vdotParams(p))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeVdot(token: string): VdotParams {
  if (!token.startsWith("vd1.") || token.length > 8000) throw new Error("unknown or invalid vDOT link version");
  return vdotParams(JSON.parse(atob(token.slice(4).replace(/-/g, "+").replace(/_/g, "/"))));
}
