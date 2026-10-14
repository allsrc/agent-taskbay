"use client";

import { useState } from "react";
import { Clamp } from "@/components/long-content";

/** Entries shown before a "Show more" button, so a huge array does not render thousands of rows at once. */
const PAGE = 100;

/** A string that spans lines or runs long is shown as a block that keeps its line breaks, folded when it is long. */
function StringValue({ value }: { value: string }) {
  if (!value.includes("\n") && value.length <= 160) return <code className="text-foreground break-words">&quot;{value}&quot;</code>;
  return (
    <Clamp text={value} size="compact" className="mt-0.5">
      <pre className="bg-muted/40 text-foreground mt-0.5 rounded-md px-2 py-1.5 whitespace-pre-wrap break-words">{value}</pre>
    </Clamp>
  );
}

function Entries({ entries, depth }: { entries: Array<[string, unknown]>; depth: number }) {
  const [shown, setShown] = useState(PAGE);
  return (
    <>
      {entries.slice(0, shown).map(([key, item]) => (
        <JsonTree key={key} name={key} value={item} depth={depth + 1} />
      ))}
      {entries.length > shown && (
        <button type="button" className="text-muted-foreground hover:text-foreground py-0.5 underline-offset-2 hover:underline" onClick={() => setShown(shown + PAGE * 5)}>
          Show {Math.min(entries.length - shown, PAGE * 5).toLocaleString("en")} more of {(entries.length - shown).toLocaleString("en")}
        </button>
      )}
    </>
  );
}

export function JsonTree({ value, name, depth = 0 }: { value: unknown; name?: string; depth?: number }) {
  if (value === null || typeof value !== "object") {
    return (
      <div className="py-0.5 font-mono text-xs">
        {name && <span className="text-muted-foreground">{name}: </span>}
        {typeof value === "string" ? <StringValue value={value} /> : <code className="text-foreground">{String(value)}</code>}
      </div>
    );
  }
  const entries = Object.entries(value);
  return (
    <details className="my-0.5 font-mono text-xs" open={depth < 2}>
      <summary className="text-foreground cursor-pointer">
        {name && <span>{name} </span>}
        <span className="text-muted-foreground">{Array.isArray(value) ? `Array(${entries.length})` : `{${entries.length}}`}</span>
      </summary>
      <div className="border-border ml-1.5 border-l pl-3">
        <Entries entries={entries} depth={depth} />
      </div>
    </details>
  );
}
