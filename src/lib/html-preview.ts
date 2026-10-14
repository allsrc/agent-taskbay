import createDOMPurify from "dompurify";

const CONTENT_TAGS = ["p", "br", "hr", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6", "strong", "b", "em", "i", "u", "s", "small", "sub", "sup", "mark", "pre", "code", "blockquote", "ul", "ol", "li", "dl", "dt", "dd", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "section", "article", "header", "footer", "main", "nav", "details", "summary"];

export const HTML_PREVIEW_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

export function sanitizeHtml(text: string, rich = false): string {
  if (typeof window === "undefined") return "";
  return createDOMPurify(window).sanitize(text, {
    ALLOWED_TAGS: rich ? [...CONTENT_TAGS, "style"] : CONTENT_TAGS,
    ALLOWED_ATTR: rich ? ["class", "style", "colspan", "rowspan", "open", "dir", "lang"] : ["colspan", "rowspan", "dir", "lang"],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    FORCE_BODY: true,
  });
}

export function htmlPreviewDocument(text: string): string {
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${sanitizeHtml(text, true)}</body></html>`;
}