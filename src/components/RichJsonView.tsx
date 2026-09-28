"use client";

import { ExternalLink, Sparkles } from "lucide-react";
import {
  humanizeJsonKey,
  isIsoDateTime,
  isJsonRecord,
  isScalarJson,
  safeHttpUrl,
  tableColumns,
  type JsonRecord,
} from "@/lib/rich-json";

const MAX_DEPTH = 4;
const MAX_ITEMS = 50;
const MAX_COLUMNS = 12;

function ScalarValue({ value }: { value: unknown }) {
  if (value === null) return <span className="text-muted-foreground font-mono italic">null</span>;
  if (typeof value === "boolean") {
    return (
      <span
        className={
          value
            ? "bg-success/10 text-success rounded-full px-2 py-0.5 font-mono text-xs"
            : "bg-muted text-muted-foreground rounded-full px-2 py-0.5 font-mono text-xs"
        }
      >
        {String(value)}
      </span>
    );
  }
  if (typeof value === "number") {
    return (
      <strong className="text-foreground font-mono text-base tabular-nums">
        {Number.isFinite(value) ? value.toLocaleString() : String(value)}
      </strong>
    );
  }
  const text = String(value);
  const url = safeHttpUrl(text);
  if (url) {
    return (
      <a
        className="text-primary inline-flex items-center gap-1 break-words hover:underline"
        href={url}
        target="_blank"
        rel="noreferrer"
      >
        {text}
        <ExternalLink className="size-3" />
      </a>
    );
  }
  if (isIsoDateTime(text)) {
    return (
      <time className="tabular-nums" dateTime={text} title={text}>
        {new Date(text).toLocaleString()}
      </time>
    );
  }
  return <span className="whitespace-pre-wrap">{text}</span>;
}

function RecordTable({ rows }: { rows: JsonRecord[] }) {
  const columns = tableColumns(rows, MAX_COLUMNS);
  const totalColumns = new Set(rows.flatMap(Object.keys)).size;
  const visibleRows = rows.slice(0, MAX_ITEMS);
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className="border-border text-muted-foreground sticky top-0 border-b px-2 py-1.5 text-left font-medium">
                {humanizeJsonKey(column)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {columns.map((column) => (
                <td key={column} className="border-border border-b px-2 py-1.5 align-top">
                  {isScalarJson(row[column]) ? <ScalarValue value={row[column]} /> : <code className="font-mono text-xs">{JSON.stringify(row[column])}</code>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {(rows.length > visibleRows.length || totalColumns > columns.length) && (
        <p className="text-muted-foreground mt-1.5 text-xs">
          Showing {visibleRows.length} of {rows.length} rows and {columns.length} of {totalColumns} columns.
        </p>
      )}
    </div>
  );
}

function ArrayValue({ value, depth }: { value: unknown[]; depth: number }) {
  const visible = value.slice(0, MAX_ITEMS);
  if (value.length > 0 && value.every(isJsonRecord)) return <RecordTable rows={value} />;
  if (value.every(isScalarJson)) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {visible.map((item, index) => (
          <span key={index} className="border-border bg-muted/50 max-w-full rounded-full border px-2.5 py-1 text-xs break-words">
            <ScalarValue value={item} />
          </span>
        ))}
        {value.length > visible.length && (
          <span className="text-muted-foreground self-center text-xs">+{value.length - visible.length} more</span>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      {visible.map((item, index) => (
        <section key={index} className="border-border border-l-2 pl-2.5">
          <header className="text-muted-foreground mb-1 text-xs font-semibold uppercase tracking-wide">Item {index + 1}</header>
          <RichValue value={item} depth={depth + 1} />
        </section>
      ))}
      {value.length > visible.length && (
        <p className="text-muted-foreground text-xs">Showing {visible.length} of {value.length} items.</p>
      )}
    </div>
  );
}

function ObjectValue({ value, depth }: { value: JsonRecord; depth: number }) {
  const entries = Object.entries(value);
  const visibleEntries = entries.slice(0, MAX_ITEMS);
  const scalarEntries = visibleEntries.filter(([, item]) => isScalarJson(item));
  const nestedEntries = visibleEntries.filter(([, item]) => !isScalarJson(item));
  return (
    <div className="flex flex-col gap-2.5">
      {scalarEntries.length > 0 && (
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(145px,1fr))] gap-1.5">
          {scalarEntries.map(([key, item]) => (
            <div key={key} className="border-border bg-muted/40 min-w-0 rounded-lg border p-2.5">
              <dt className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase tracking-wide">{humanizeJsonKey(key)}</dt>
              <dd className="min-w-0 text-sm break-words">
                <ScalarValue value={item} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {nestedEntries.map(([key, item]) => (
        <section key={key} className="border-border overflow-hidden rounded-lg border">
          <header className="bg-muted/40 border-border flex items-center justify-between gap-2 border-b px-2.5 py-2">
            <strong className="text-sm">{humanizeJsonKey(key)}</strong>
            <span className="text-muted-foreground text-xs">{Array.isArray(item) ? `${item.length} item${item.length === 1 ? "" : "s"}` : "object"}</span>
          </header>
          <div className="p-2.5">
            <RichValue value={item} depth={depth + 1} />
          </div>
        </section>
      ))}
      {entries.length > MAX_ITEMS && <p className="text-muted-foreground text-xs">Showing the first {MAX_ITEMS} fields.</p>}
    </div>
  );
}

function RichValue({ value, depth }: { value: unknown; depth: number }) {
  if (depth >= MAX_DEPTH && !isScalarJson(value)) {
    return <pre className="bg-muted/40 max-h-56 overflow-auto rounded-lg p-2 text-xs">{JSON.stringify(value, null, 2)}</pre>;
  }
  if (Array.isArray(value)) return <ArrayValue value={value} depth={depth} />;
  if (isJsonRecord(value)) return <ObjectValue value={value} depth={depth} />;
  return <ScalarValue value={value} />;
}

export function RichJsonView({ value }: { value: unknown }) {
  return (
    <div className="border-primary/25 border-border overflow-hidden rounded-xl border">
      <header className="from-primary/10 to-muted/40 border-border flex items-center justify-between gap-2.5 border-b bg-gradient-to-r px-3 py-2">
        <div className="text-primary flex items-center gap-1.5">
          <Sparkles className="size-3.5" />
          <strong className="text-foreground text-sm">Rich JSON</strong>
          <span className="bg-background rounded-full px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase">Experimental</span>
        </div>
        <small className="text-muted-foreground text-xs">Deterministic, inferred presentation</small>
      </header>
      <div className="p-3">
        <RichValue value={value} depth={0} />
      </div>
      <footer className="border-border text-muted-foreground border-t px-3 py-2 text-xs">
        Presentation is inferred from value shapes. Use Structured or Raw to verify the exact agent payload.
      </footer>
    </div>
  );
}
