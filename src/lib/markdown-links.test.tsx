import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentViewer } from "@/components/content-viewer";

const render = (text: string) => renderToStaticMarkup(<ContentViewer text={text} mediaType="text/markdown" />);
const links = (html: string) => [...html.matchAll(/<a [^>]*>/g)].map((match) => match[0]);

describe("links in Markdown", () => {
  it("leaves bare addresses, hosts, ports, paths and emails as text", () => {
    for (const text of [
      "Open http://localhost:3000/chat/abc to continue.",
      "The console is at https://my-host.internal:8443/app?x=1#top now.",
      "See www.example.com for details.",
      "Mail me@example.com about it.",
      "It lives in /home/user/app/src/index.ts and C:\\work\\app.",
      "Listening on 127.0.0.1:4010 (http://127.0.0.1:4010/card.json).",
    ]) {
      const html = render(text);
      expect(links(html), text).toEqual([]);
      expect(html).toContain(text.split(" ")[0]);
    }
  });

  it("keeps the exact text, including trailing punctuation, when it unwraps an address", () => {
    expect(render("Visit https://example.com/a, then http://localhost:3000.")).toContain("Visit https://example.com/a, then http://localhost:3000.");
  });

  it("keeps links the author wrote, opening them safely", () => {
    const html = render("Read the [docs](https://example.com/docs) or <https://example.com/raw> or [ref link][r].\n\n[r]: https://example.com/ref");
    const found = links(html);
    expect(found).toHaveLength(3);
    for (const link of found) expect(link).toContain('target="_blank" rel="noopener noreferrer nofollow"');
    expect(html).toContain(">docs</a>");
  });

  it("does not turn an unsafe address into a link", () => {
    const html = render("[click](javascript:alert(1)) and [data](data:text/html;base64,AAAA)");
    expect(links(html)).toEqual([]);
    expect(html).toContain("click");
  });

  it("applies inside lists, tables and quotes", () => {
    const html = render("- run http://localhost:3000\n\n| host | url |\n| --- | --- |\n| a | https://a.example.com |\n\n> see www.example.com");
    expect(links(html)).toEqual([]);
    expect(html).toContain("<li>");
    expect(html).toContain("<table");
    expect(html).toContain("https://a.example.com");
  });

  it("still suppresses remote images", () => {
    expect(render("![x](https://evil.test/pixel.png)")).not.toContain("<img");
  });
});
