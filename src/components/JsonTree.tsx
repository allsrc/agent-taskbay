"use client";

export function JsonTree({ value, name, depth = 0 }: { value: unknown; name?: string; depth?: number }) {
  if (value === null || typeof value !== "object") {
    return (
      <div className="py-0.5 font-mono text-xs">
        {name && <span className="text-muted-foreground">{name}: </span>}
        <code className="text-foreground">{typeof value === "string" ? `"${value}"` : String(value)}</code>
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
        {entries.map(([key, item]) => (
          <JsonTree key={key} name={key} value={item} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}
