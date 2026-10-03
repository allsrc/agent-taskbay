import { BUILT_IN_SIDEBAND_EXTENSION_URIS } from "../sideband/adapters";

export function sidebandExtensionUris() {
  const configured = process.env.A2A_SIDEBAND_EXTENSION_URIS ?? process.env.A2A_SIDEBAND_EXTENSION_URI;
  const deploymentUris = configured?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...new Set([...BUILT_IN_SIDEBAND_EXTENSION_URIS, ...deploymentUris])];
}
