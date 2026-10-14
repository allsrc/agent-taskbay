import { detectContentKind, parseJsonObject, type ContentKind, type Detection } from "@/lib/content-sniff";

export type ViewKind = "text" | "markdown" | "json" | "csv" | "html";
export type ViewMode = "auto" | ViewKind;

export const VIEW_LABEL: Record<ViewKind, string> = { text: "Text", markdown: "Markdown", json: "JSON", csv: "CSV", html: "HTML" };

const DETECTED_VIEW: Record<ContentKind, ViewKind> = { json: "json", html: "html", markdown: "markdown", csv: "csv", plain: "text" };

export interface ContentProfile {
  /** Media type the sender declared. */
  declared: string;
  detection: Detection;
  /**
   * How the content is shown until the person chooses otherwise. It follows the declared type, except that plain text
   * that reads as Markdown is formatted when `inferMarkdown` is set. HTML is never a default.
   */
  defaultView: ViewKind;
  /** A different view that the content looks suited to, or null. */
  suggestion: ViewKind | null;
  /** Views the person can switch to. */
  options: ViewKind[];
  /** The parsed value when the text is a JSON object or array. */
  json: object | undefined;
  /** The sender declared HTML, or the text looks like HTML: a rich preview is worth offering. */
  html: boolean;
}

const baseType = (mediaType: string) => mediaType.toLowerCase().split(";")[0].trim();

function declaredView(mediaType: string): ViewKind {
  const type = baseType(mediaType);
  if (type === "text/markdown") return "markdown";
  if (type.includes("json")) return "json";
  if (type.includes("csv")) return "csv";
  return "text";
}

/**
 * `inferMarkdown` formats plain text that reads as Markdown. Agents built on language models send Markdown as
 * text/plain, so their text infers it; a person's own message follows the type they chose in the composer.
 */
export function profileContent(text: string, mediaType: string, { inferMarkdown = false }: { inferMarkdown?: boolean } = {}): ContentProfile {
  const detection = detectContentKind(text);
  const json = parseJsonObject(text);
  const declared = declaredView(mediaType);
  const detected = DETECTED_VIEW[detection.kind];
  // Formatting Markdown is safe: raw HTML is not rendered and remote images are not loaded.
  const readsAsMarkdown = inferMarkdown && declared === "text" && detected === "markdown";
  const defaultView = declared === "json" && !json ? "text" : readsAsMarkdown ? "markdown" : declared;
  const options = new Set<ViewKind>(["text", "markdown", "html"]);
  if (json) options.add("json");
  if (declared === "csv" || detected === "csv") options.add("csv");
  return {
    declared: mediaType,
    detection,
    defaultView,
    suggestion: detected !== defaultView && detected !== "text" ? detected : null,
    options: (["text", "markdown", "json", "csv", "html"] as const).filter((kind) => options.has(kind)),
    json,
    html: detected === "html" || baseType(mediaType) === "text/html",
  };
}

/** The view actually shown. A choice that no longer fits the content (it stopped being JSON mid-stream) falls back to text. */
export function resolveView(profile: ContentProfile, mode: ViewMode): ViewKind {
  const view = mode === "auto" ? profile.defaultView : mode;
  return profile.options.includes(view) ? view : "text";
}

/**
 * The formatted counterpart of plain text, used for the one-click toggle: the default view when it is formatted, else a
 * non-HTML suggestion. HTML is reached through the preview, never a toggle. Null when there is nothing to switch to.
 */
export function formattedView(profile: ContentProfile): ViewKind | null {
  if (profile.defaultView !== "text") return profile.defaultView;
  return profile.suggestion && profile.suggestion !== "html" ? profile.suggestion : null;
}
