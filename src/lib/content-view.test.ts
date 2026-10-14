import { describe, expect, it } from "vitest";
import { detectContentKind } from "@/lib/content-sniff";
import { formattedView, profileContent, resolveView } from "@/lib/content-view";

describe("detectContentKind", () => {
  it("recognizes JSON objects and arrays, not bare scalars or broken JSON", () => {
    expect(detectContentKind('{"a": [1, 2]}')).toEqual({ kind: "json", confidence: "high" });
    expect(detectContentKind("[1, 2, 3]").kind).toBe("json");
    expect(detectContentKind("42").kind).toBe("plain");
    expect(detectContentKind("{not json").kind).not.toBe("json");
  });

  it("recognizes HTML documents and fragments", () => {
    expect(detectContentKind("<!DOCTYPE html><html><body>Hi</body></html>")).toEqual({ kind: "html", confidence: "high" });
    expect(detectContentKind("<div><p>Hello <strong>there</strong></p></div>").kind).toBe("html");
    expect(detectContentKind("Use the <b> tag sparingly").kind).not.toBe("html");
  });

  it("recognizes Markdown and scores how sure it is", () => {
    expect(detectContentKind("# Title\n\n- one\n- two\n\n**bold**")).toEqual({ kind: "markdown", confidence: "high" });
    expect(detectContentKind("| a | b |\n| --- | --- |\n| 1 | 2 |").kind).toBe("markdown");
    expect(detectContentKind("Result: **done**")).toEqual({ kind: "markdown", confidence: "low" });
  });

  it("keeps HTML inside a Markdown code fence as Markdown", () => {
    expect(detectContentKind("Example:\n```html\n<div><p>x</p></div>\n```").kind).toBe("markdown");
  });

  it("recognizes delimited tables and otherwise falls back to plain text", () => {
    expect(detectContentKind("a,b,c\n1,2,3\n4,5,6").kind).toBe("csv");
    expect(detectContentKind("Hello, world\nGoodbye, world").kind).toBe("plain");
    expect(detectContentKind("Just a sentence.").kind).toBe("plain");
    expect(detectContentKind("   ").kind).toBe("plain");
  });
});

describe("profileContent", () => {
  it("formats an agent's Markdown sent as text/plain only when asked to infer it", () => {
    const agent = profileContent("Result: **done**", "text/plain", { infer: true });
    expect(agent.defaultView).toBe("markdown");
    expect(formattedView(agent)).toBe("markdown");
    expect(profileContent("Just a sentence.", "text/plain", { infer: true }).defaultView).toBe("text");
  });

  it("shows what was declared and only suggests what it detected", () => {
    const profile = profileContent("# Title\n\n- one\n- two", "text/plain");
    expect(profile.defaultView).toBe("text");
    expect(profile.suggestion).toBe("markdown");
    expect(resolveView(profile, "auto")).toBe("text");
    expect(resolveView(profile, "markdown")).toBe("markdown");
  });

  it("never defaults to HTML, even for declared or detected HTML", () => {
    const declared = profileContent("<p>hi</p><p>there</p>", "text/html");
    expect(declared.defaultView).toBe("text");
    expect(declared.suggestion).toBe("html");
    expect(declared.options).toContain("html");
    expect(declared.html).toBe(true);
    expect(formattedView(declared)).toBeNull();
    expect(profileContent("<p>x</p>", "text/html", { infer: true }).defaultView).toBe("text");
  });

  it("offers JSON only when the text parses", () => {
    expect(profileContent('{"a":1}', "text/plain").options).toContain("json");
    expect(profileContent("plain words", "text/plain").options).not.toContain("json");
  });

  it("falls back to text when declared JSON is not valid, and when a chosen view stops fitting", () => {
    const broken = profileContent('{"a":', "application/json");
    expect(broken.defaultView).toBe("text");
    expect(resolveView(broken, "json")).toBe("text");
  });

  it("makes no suggestion when the content matches what was declared", () => {
    expect(profileContent("# Title\n\n- one", "text/markdown").suggestion).toBeNull();
    expect(profileContent("Just a sentence.", "text/plain").suggestion).toBeNull();
  });
});
