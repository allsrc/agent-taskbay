"use client";

import { useRef, useState } from "react";
import { ArrowUp, FileUp, Link2, Loader2, Braces, Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { mediaTypeIsAdvertised, type OutgoingPart } from "@/lib/message-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type PartKind = "FILE" | "URL" | "DATA";
interface DraftPart {
  id: number;
  kind: PartKind;
  name: string;
  mime: string;
  meta: string;
  wire: OutgoingPart;
}

const TEXT_TYPES = [
  { key: "text", label: "Text", mime: "text/plain", hint: "Message the agent…" },
  { key: "md", label: "Markdown", mime: "text/markdown", hint: "**Markdown** message…" },
] as const;

const KIND_TONE: Record<PartKind, string> = { FILE: "text-primary", URL: "text-primary", DATA: "text-primary" };

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/**
 * One A2A message: a text or Markdown part plus any number of file / URL /
 * structured-data parts, checked against the agent's `defaultInputModes`.
 */
export function Composer({
  inputModes,
  hint,
  sending,
  disabled,
  seed,
  onSend,
}: {
  inputModes: string[];
  /** Overrides the placeholder, e.g. while a task waits on the user. */
  hint?: string;
  sending: boolean;
  disabled?: boolean;
  /** Prefills the text box (e.g. a skill example); change `seed.id` to re-apply. */
  seed?: { id: number; text: string };
  onSend: (parts: OutgoingPart[]) => void | Promise<void>;
}) {
  const preferred: (typeof TEXT_TYPES)[number]["key"] = inputModes[0] === "text/markdown" ? "md" : "text";
  const [text, setText] = useState("");
  const [seedId, setSeedId] = useState<number | undefined>();
  const [textType, setTextType] = useState<"text" | "md" | null>(null);
  const [parts, setParts] = useState<DraftPart[]>([]);
  const [menu, setMenu] = useState<null | "menu" | "url" | "data">(null);
  const [urlDraft, setUrlDraft] = useState("");
  const [dataDraft, setDataDraft] = useState('{\n  "env": "prod"\n}');
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  if (seed && seed.id !== seedId) {
    setSeedId(seed.id);
    setText(seed.text);
  }

  const current = TEXT_TYPES.find((type) => type.key === (textType ?? preferred)) ?? TEXT_TYPES[0];
  const outside = (mime: string) => inputModes.length > 0 && !mediaTypeIsAdvertised(mime, inputModes);
  const anyOutside = parts.some((part) => outside(part.mime));
  const canSend = !sending && !disabled && (text.trim().length > 0 || parts.length > 0);

  const addPart = (part: Omit<DraftPart, "id">) => {
    setParts((list) => [...list, { ...part, id: nextId.current++ }]);
    setMenu(null);
  };

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      for (const file of files) {
        const raw = await toBase64(file);
        const mime = file.type || "application/octet-stream";
        addPart({
          kind: "FILE",
          name: file.name,
          mime,
          meta: `raw · ${(file.size / 1024).toFixed(file.size > 1024 * 100 ? 0 : 1)} KB`,
          wire: { raw, mediaType: mime, filename: file.name },
        });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the file.");
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  function addUrl() {
    try {
      const url = new URL(urlDraft.trim());
      addPart({ kind: "URL", name: url.host + url.pathname.replace(/\/$/, ""), mime: "text/html", meta: "url", wire: { url: url.toString(), mediaType: "text/html" } });
      setUrlDraft("");
    } catch {
      setError("Enter a full URL, including https://");
    }
  }

  function addData() {
    try {
      const data: unknown = JSON.parse(dataDraft);
      addPart({ kind: "DATA", name: "data.json", mime: "application/json", meta: JSON.stringify(data).slice(0, 40), wire: { data, mediaType: "application/json" } });
    } catch (cause) {
      setError(`Invalid JSON: ${cause instanceof SyntaxError ? cause.message : "could not parse"}`);
    }
  }

  async function submit() {
    if (!canSend) return;
    setError(null);
    const out: OutgoingPart[] = [];
    if (text.trim()) out.push({ text, mediaType: current.mime });
    out.push(...parts.map((part) => part.wire));
    setText("");
    setParts([]);
    setMenu(null);
    await onSend(out);
  }

  const note = `Card accepts ${inputModes.length ? inputModes.join(", ") : "any media type"}. ${
    anyOutside ? "Amber parts are outside the card; sending anyway." : current.key === preferred ? "Using the preferred type." : "Text type overridden."
  }`;

  return (
    <div className="border-border shrink-0 border-t">
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-2.5 md:px-6">
        <span className="label-mono mr-0.5">Text as</span>
        {TEXT_TYPES.map((type) => {
          const on = current.key === type.key;
          return (
            <button
              key={type.key}
              type="button"
              onClick={() => setTextType(type.key)}
              aria-pressed={on}
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-xs font-medium transition-colors",
                on ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {type.label}
              {type.key === preferred && <span className="text-brand"> ★</span>}
            </button>
          );
        })}
      </div>
      <p className="text-muted-foreground px-4 py-1 font-mono text-[11px] md:px-6">{note}</p>

      <AnimatePresence initial={false}>
        {parts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="flex flex-wrap gap-2 overflow-hidden px-4 pt-1.5 md:px-6"
          >
            {parts.map((part) => {
              const bad = outside(part.mime);
              return (
                <div
                  key={part.id}
                  className={cn("bg-card flex max-w-full items-center gap-2 rounded-[10px] border px-2.5 py-1.5", bad ? "border-warning" : "border-border")}
                >
                  <span className={cn("font-mono text-[10px] font-bold", bad ? "text-warning" : KIND_TONE[part.kind])}>{part.kind}</span>
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs font-medium">{part.name}</div>
                    <div className={cn("font-mono text-[10.5px]", bad ? "text-warning" : "text-muted-foreground")}>
                      {part.meta} · {part.mime}
                      {bad ? " · not in card" : ""}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Remove ${part.name}`}
                    onClick={() => setParts((list) => list.filter((item) => item.id !== part.id))}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {menu && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            className="bg-popover border-border mx-4 mt-1.5 flex w-[290px] max-w-[calc(100%-2rem)] flex-col gap-1 rounded-xl border p-1.5 md:mx-6"
          >
            {menu === "menu" && (
              <>
                <MenuItem icon={<FileUp className="size-4" />} title="Upload file" desc="raw · base64, with filename + mediaType" onClick={() => fileInput.current?.click()} />
                <MenuItem icon={<Link2 className="size-4" />} title="Add file URL" desc="url · reference, agent fetches it" onClick={() => setMenu("url")} />
                <MenuItem icon={<Braces className="size-4" />} title="Add structured data" desc="data · JSON the agent can read directly" onClick={() => setMenu("data")} />
              </>
            )}
            {menu === "url" && (
              <div className="flex flex-col gap-2 p-1.5">
                <Input autoFocus value={urlDraft} onChange={(event) => setUrlDraft(event.target.value)} placeholder="https://github.com/acme/platform" className="font-mono text-xs" />
                <Button size="sm" onClick={addUrl} disabled={!urlDraft.trim()}>Add URL part</Button>
              </div>
            )}
            {menu === "data" && (
              <div className="flex flex-col gap-2 p-1.5">
                <textarea
                  autoFocus
                  value={dataDraft}
                  onChange={(event) => setDataDraft(event.target.value)}
                  rows={5}
                  className="border-input bg-inset rounded-md border p-2 font-mono text-xs outline-none"
                />
                <Button size="sm" onClick={addData}>Add data part</Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {error && <p className="text-brand px-4 pt-1 font-mono text-xs md:px-6">{error}</p>}

      <div className="flex items-end gap-2 px-4 pt-1.5 pb-3 md:px-6">
        <input ref={fileInput} type="file" multiple hidden onChange={(event) => void onFiles(event.target.files)} />
        <button
          type="button"
          aria-label="Add a part"
          aria-expanded={menu !== null}
          onClick={() => setMenu((open) => (open ? null : "menu"))}
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[10px] border transition-colors",
            menu ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <Plus className={cn("size-5 transition-transform", menu && "rotate-45")} />
        </button>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          rows={1}
          disabled={sending || disabled}
          placeholder={hint ?? current.hint}
          aria-label="Message"
          className="bg-card border-input placeholder:text-muted-foreground focus-visible:border-ring field-sizing-content max-h-40 min-h-10 min-w-0 flex-1 resize-none rounded-[10px] border px-3 py-2.5 text-sm outline-none disabled:opacity-60"
        />
        <Button variant="brand" size="icon" className="size-10 rounded-[10px]" disabled={!canSend} onClick={() => void submit()} aria-label="Send">
          {sending ? <Loader2 className="animate-spin" /> : <ArrowUp className="size-5" strokeWidth={2.5} />}
        </Button>
      </div>
    </div>
  );
}

function MenuItem({ icon, title, desc, onClick }: { icon: React.ReactNode; title: string; desc: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="hover:bg-accent flex items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors">
      <span className="text-primary mt-0.5">{icon}</span>
      <span>
        <span className="block font-medium">{title}</span>
        <span className="text-muted-foreground block font-mono text-[11px]">{desc}</span>
      </span>
    </button>
  );
}
