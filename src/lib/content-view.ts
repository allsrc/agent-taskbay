import { parseCsv } from "@/lib/content";
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
   * How the content is shown until the person chooses otherwise: the declared type when the content fits it, else what
   * the content is (JSON or Markdown) when inferring, else text. HTML is never a default.
   */
  defaultView: ViewKind;
  /** A different view that the content looks suited to, or null. */
  suggestion: ViewKind | null;
  /** Views the person can switch to. */
  options: ViewKind[];
  /** The parsed value when the text is a JSON object or array. */
  json: object | undefined;
  /** The text looks like HTML, or was declared HTML and contains markup: a rich preview is worth offering. */
  html: boolean;
}

const baseType = (mediaType: string) => mediaType.toLowerCase().split(";")[0].trim();

type DeclaredKind = ViewKind;

function declaredKind(mediaType: string): DeclaredKind {
  const type = baseType(mediaType);
  if (type === "text/markdown") return "markdown";
  if (type === "text/html" || type === "application/xhtml+xml") return "html";
  if (type.includes("json")) return "json";
  if (type.includes("csv")) return "csv";
  return "text";
}

const HAS_TAG = /<[a-z!/][^<>]*>/i;

/** At least two rows that each have the same number (two or more) of comma-separated columns. */
function isCsvShaped(text: string): boolean {
  const rows = parseCsv(text).filter((row) => row.some((cell) => cell.trim()));
  return rows.length >= 2 && rows[0].length >= 2 && rows.every((row) => row.length === rows[0].length);
}

/**
 * Agents often declare the wrong type: Markdown or JSON sent as text/plain, JSON labelled text/html, an HTML page
 * labelled text/markdown. The declared type is used when the content fits it. When it does not, `infer` lets the content
 * decide between JSON and Markdown; otherwise the text is shown as text. HTML is never chosen automatically, whatever
 * the label: it is shown as source with a preview on request. A person's own messages do not infer, so they appear the
 * way they were sent.
 */
export function profileContent(text: string, mediaType: string, { infer = false }: { infer?: boolean } = {}): ContentProfile {
  const detection = detectContentKind(text);
  const json = parseJsonObject(text);
  const declared = declaredKind(mediaType);
  const detected = DETECTED_VIEW[detection.kind];
  const htmlDocument = detection.kind === "html" && detection.confidence === "high";
  const fits: Record<ViewKind, boolean> = {
    text: true,
    json: Boolean(json),
    csv: isCsvShaped(text),
    // Markdown that is really a JSON value or a whole HTML page renders as noise.
    markdown: !json && !htmlDocument,
    html: false,
  };
  const inferred = infer && !htmlDocument && (detected === "json" || detected === "markdown") ? detected : null;
  const defaultView = declared !== "text" && fits[declared] ? declared : inferred ?? "text";
  const html = !json && (detection.kind === "html" || (declared === "html" && HAS_TAG.test(text)));
  const options = new Set<ViewKind>(["text", "markdown", "html"]);
  if (json) options.add("json");
  if (fits.csv) options.add("csv");
  return {
    declared: mediaType,
    detection,
    defaultView,
    suggestion: detected !== defaultView && detected !== "text" ? detected : null,
    options: (["text", "markdown", "json", "csv", "html"] as const).filter((kind) => options.has(kind)),
    json,
    html,
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
