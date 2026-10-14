import { detectContentKind, parseJsonObject, type ContentKind, type Detection } from "@/lib/content-sniff";

export type ViewKind = "text" | "markdown" | "json" | "csv" | "html";
export type ViewMode = "auto" | ViewKind;

export const VIEW_LABEL: Record<ViewKind, string> = { text: "Text", markdown: "Markdown", json: "JSON", csv: "CSV", html: "HTML" };

const DETECTED_VIEW: Record<ContentKind, ViewKind> = { json: "json", html: "html", markdown: "markdown", csv: "csv", plain: "text" };

export interface ContentProfile {
  /** Media type the sender declared. */
  declared: string;
  detection: Detection;
  /** How the content is shown until the person chooses otherwise: what the sender declared. */
  defaultView: ViewKind;
  /** A different view that the content looks suited to, or null. */
  suggestion: ViewKind | null;
  /** Views the person can switch to. */
  options: ViewKind[];
  /** The parsed value when the text is a JSON object or array. */
  json: object | undefined;
}

/** HTML is never a default: it renders only when the person asks for it. */
function declaredView(mediaType: string): ViewKind {
  const type = mediaType.toLowerCase().split(";")[0].trim();
  if (type === "text/markdown") return "markdown";
  if (type.includes("json")) return "json";
  if (type.includes("csv")) return "csv";
  return "text";
}

export function profileContent(text: string, mediaType: string): ContentProfile {
  const detection = detectContentKind(text);
  const json = parseJsonObject(text);
  const declared = declaredView(mediaType);
  const defaultView = declared === "json" && !json ? "text" : declared;
  const detected = DETECTED_VIEW[detection.kind];
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
  };
}

/** The view actually shown. A choice that no longer fits the content (it stopped being JSON mid-stream) falls back to text. */
export function resolveView(profile: ContentProfile, mode: ViewMode): ViewKind {
  const view = mode === "auto" ? profile.defaultView : mode;
  return profile.options.includes(view) ? view : "text";
}
