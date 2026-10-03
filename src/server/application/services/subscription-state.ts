export const SUBSCRIPTION_LEASE_MS = 15_000;
export function observationPaused(state: string): boolean {
  return ["COMPLETED", "FAILED", "CANCELED", "REJECTED", "INPUT_REQUIRED", "AUTH_REQUIRED", "MESSAGE_ONLY"].includes(state.replace("TASK_STATE_", ""));
}
