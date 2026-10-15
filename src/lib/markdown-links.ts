/**
 * GitHub-flavored Markdown turns any bare URL, `www.` address or email in the text into a link ("autolink literals").
 * Agents write file paths, hosts and ports in running text (`http://localhost:3000/app`, `www.example.com`, `me@x.io`), and
 * none of that was meant as a link. This remark plugin turns such links back into the text that was written and keeps the
 * links the author asked for: `[label](url)`, `[label][ref]` and `<url>`.
 *
 * An autolink literal is told apart by its source: an explicit link starts with `[` or `<` where it was written, a
 * literal starts with the address itself.
 */

interface MarkdownNode {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

const isExplicitLink = (source: string) => source.startsWith("[") || source.startsWith("<");

function unwrapLiterals(node: MarkdownNode, source: string) {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "link") {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (start === undefined || end === undefined) return child;
      const written = source.slice(start, end);
      if (isExplicitLink(written)) {
        unwrapLiterals(child, source);
        return child;
      }
      return { type: "text", value: written };
    }
    unwrapLiterals(child, source);
    return child;
  });
}

/** A remark plugin: `remarkPlugins={[remarkGfm, remarkExplicitLinksOnly]}`. It must run after `remark-gfm`. */
export function remarkExplicitLinksOnly() {
  return (tree: MarkdownNode, file: { value?: unknown }) => {
    unwrapLiterals(tree, String(file.value ?? ""));
  };
}
