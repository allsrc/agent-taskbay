export type ContentKind = "json" | "html" | "markdown" | "csv" | "plain";
export type Confidence = "high" | "medium" | "low";
export interface Detection {
  kind: ContentKind;
  confidence: Confidence;
}

const SAMPLE_LIMIT = 100_000;
const JSON_LIMIT = 200_000;

const HTML_DOCUMENT = /^\s*(?:<!doctype\s+html|<html[\s>])/i;
const HTML_TAG = /<\/?(?:a|b|i|u|p|br|hr|div|span|em|strong|code|pre|ul|ol|li|table|thead|tbody|tr|th|td|h[1-6]|img|blockquote|section|article|header|footer|nav|style|script|body|head|html|small|sub|sup|mark)(?:\s[^<>]*)?\/?>/gi;
const FENCE = /^\s*(?:```|~~~)/m;

const MARKDOWN_SIGNALS: Array<[RegExp, number]> = [
  [/^#{1,6}\s+\S/m, 2],
  [FENCE, 2],
  [/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/m, 2],
  [/\*\*[^*\n]+\*\*/, 1],
  [/^\s*(?:[-*+]|\d+\.)\s+\S/m, 1],
  [/\[[^\]\n]+\]\([^)\s]+\)/, 1],
  [/^>\s+\S/m, 1],
  [/`[^`\n]+`/, 1],
];

/** Parses `text` as a JSON object or array; anything else, including bare scalars, is not treated as structured data. */
export function parseJsonObject(text: string): object | undefined {
  const first = text.trimStart()[0];
  if (first !== "{" && first !== "[") return undefined;
  if (text.length > JSON_LIMIT) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null ? value : undefined;
  } catch {
    return undefined;
  }
}

function markdownScore(sample: string): number {
  return MARKDOWN_SIGNALS.reduce((score, [pattern, weight]) => score + (pattern.test(sample) ? weight : 0), 0);
}

/** Characters that mark code or markup, which also has commas but is not a table. */
const CODE_LIKE = /[{};=<>]/;

function looksLikeCsv(sample: string): boolean {
  const lines = sample.split(/\r?\n/).filter((line) => line.trim()).slice(0, 6);
  if (lines.length < 3 || lines.some((line) => CODE_LIKE.test(line))) return false;
  return [","].some((delimiter) => {
    const columns = lines[0].split(delimiter).length;
    return columns > 1 && lines.every((line) => line.split(delimiter).length === columns);
  });
}

/** Guesses what a piece of text is. This only informs a suggestion; it never changes how content is shown by itself. */
export function detectContentKind(text: string): Detection {
  if (!text.trim()) return { kind: "plain", confidence: "high" };
  if (parseJsonObject(text)) return { kind: "json", confidence: "high" };

  const sample = text.slice(0, SAMPLE_LIMIT);
  if (HTML_DOCUMENT.test(sample)) return { kind: "html", confidence: "high" };

  const score = markdownScore(sample);
  const tags = sample.match(HTML_TAG)?.length ?? 0;
  if (tags >= 2 && !FENCE.test(sample) && score < 3) return { kind: "html", confidence: "medium" };
  if (score >= 1) return { kind: "markdown", confidence: score >= 3 ? "high" : score === 2 ? "medium" : "low" };
  if (looksLikeCsv(sample)) return { kind: "csv", confidence: "medium" };
  return { kind: "plain", confidence: "medium" };
}
