/**
 * Copy persisted browser state into the A2A Ops namespace on first load.
 * The legacy entry is retained so the branding migration is non-destructive.
 */
export function migrateBrowserStorageKey(legacyKey: string, currentKey: string): void {
  if (typeof window === "undefined") return;

  try {
    if (window.localStorage.getItem(currentKey) !== null) return;
    const legacyValue = window.localStorage.getItem(legacyKey);
    if (legacyValue !== null) window.localStorage.setItem(currentKey, legacyValue);
  } catch {
    // Persist middleware will handle unavailable browser storage as usual.
  }
}
