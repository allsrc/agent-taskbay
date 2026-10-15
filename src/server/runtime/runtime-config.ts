import { z } from "zod";
import { BUILT_IN_SIDEBAND_EXTENSION_URIS } from "../sideband/adapters";
import { DEFAULT_TASK_DISCOVERY_MODE, TASK_DISCOVERY_MODES, type TaskDiscoveryMode } from "../domain/discovery-mode";

export function sidebandExtensionUris() {
  const configured = process.env.A2A_SIDEBAND_EXTENSION_URIS ?? process.env.A2A_SIDEBAND_EXTENSION_URI;
  const deploymentUris = configured?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  return [...new Set([...BUILT_IN_SIDEBAND_EXTENSION_URIS, ...deploymentUris])];
}

const taskDiscoverySchema = z.enum(TASK_DISCOVERY_MODES as [TaskDiscoveryMode, ...TaskDiscoveryMode[]]);

/** The highest task discovery mode any agent may use in this deployment (`A2A_TASK_DISCOVERY`, default `browse`). */
export function taskDiscoveryCap(environment: Readonly<Record<string, string | undefined>> = process.env): TaskDiscoveryMode {
  const value = environment.A2A_TASK_DISCOVERY?.trim();
  if (!value) return DEFAULT_TASK_DISCOVERY_MODE;
  const parsed = taskDiscoverySchema.safeParse(value);
  if (!parsed.success) throw new Error(`Invalid task discovery configuration: A2A_TASK_DISCOVERY must be one of ${TASK_DISCOVERY_MODES.join(", ")}.`);
  return parsed.data;
}
