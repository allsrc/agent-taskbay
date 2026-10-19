/**
 * Copy text to the clipboard. `navigator.clipboard` exists only in secure contexts (HTTPS and localhost), and a console served
 * over plain HTTP on a private address is a normal deployment, so fall back to a hidden text area and `execCommand`.
 * Returns whether the text was copied.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* denied or unavailable: try the fallback */ }
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.appendChild(area);
  const active = document.activeElement as HTMLElement | null;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch { return false; }
  finally {
    area.remove();
    active?.focus?.();
  }
}
