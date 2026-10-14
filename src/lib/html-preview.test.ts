// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { HTML_PREVIEW_CSP, htmlPreviewDocument, sanitizeHtml } from "./html-preview";

describe("HTML previews", () => {
  const hostile = '<style>p {color:red;background:url(https://evil.test/a)}</style><p class="x" style="position:fixed" onclick="alert(1)">Hello <strong>world</strong></p><script>alert(1)</script><img src="https://evil.test/pixel"><iframe src="/api/tasks"></iframe><form action="/api/tasks"><input name="x"></form><a href="javascript:alert(1)">link</a><svg onload="alert(1)"></svg><meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test">';

  it("keeps inert formatting and strips styles, URLs and active elements inline", () => {
    const clean = sanitizeHtml(hostile);
    expect(clean).toContain("<strong>world</strong>");
    expect(clean).not.toMatch(/style|class=|onclick|script|<img|<iframe|<form|<input|href|<svg|<meta|<base/);
  });

  it("preserves rich styling only within a network-blocked document", () => {
    const document = htmlPreviewDocument(hostile);
    expect(document).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(document.indexOf("Content-Security-Policy")).toBeLessThan(document.indexOf("<style>"));
    expect(document).toContain('<p class="x" style="position:fixed">');
    expect(document).not.toMatch(/<script|onclick|<img|<iframe|<form|<input|<svg|<base|http-equiv="refresh"/);
    for (const directive of ["default-src 'none'", "script-src 'none'", "connect-src 'none'", "frame-src 'none'", "form-action 'none'", "base-uri 'none'"]) {
      expect(HTML_PREVIEW_CSP).toContain(directive);
    }
  });

  it("does not mutate the source", () => {
    const source = '<p onclick="x()">Original</p>';
    sanitizeHtml(source);
    htmlPreviewDocument(source);
    expect(source).toBe('<p onclick="x()">Original</p>');
  });
});