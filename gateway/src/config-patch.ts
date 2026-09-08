import type { ConfigPatch } from "@glassys/protocol";

/** Bind, origins, and edge auth are yaml/env only — API/WS patches must not change them. */
export function stripOperatorRestricted(patch: ConfigPatch): ConfigPatch {
  const { network: _network, security: _security, ...rest } = patch;
  void _network;
  void _security;
  return rest;
}
