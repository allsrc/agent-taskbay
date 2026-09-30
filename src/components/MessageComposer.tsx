"use client";

import { useRef, useState } from "react";
import { ChevronDown, Loader2, Paperclip, Send, X } from "lucide-react";
import {
  buildComposerParts,
  COMPOSER_FORMATS,
  composerFormatDefinition,
  mediaTypeIsAdvertised,
  type BinaryAttachment,
  type ComposerFormat,
  type OutgoingPart,
} from "@/lib/message-parts";
import type { SendConfig } from "@/store/task-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ComposerSubmit {
  parts: OutgoingPart[];
  config: SendConfig;
}

interface KnownTask {
  taskId: string;
  label: string;
}

interface MessageComposerProps {
  placeholder: string;
  submitLabel: string;
  submitIcon?: React.ReactNode;
  sending: boolean;
  sendingLabel?: string;
  disabled?: boolean;
  /** Media types the agent advertises in `defaultInputModes`; used to warn on mismatches. */
  inputModes?: string[];
  /** Tasks the user can cite through `referenceTaskIds`. */
  referenceableTasks?: KnownTask[];
  minRows?: "sm" | "md";
  onSubmit: (submission: ComposerSubmit) => void | Promise<void>;
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Could not read the file."));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function parseJsonObject(value: string, label: string): Record<string, unknown> | undefined {
  if (!value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be a JSON object");
    return parsed as Record<string, unknown>;
  } catch (cause) {
    throw new Error(`${label} ${cause instanceof Error ? cause.message : "is invalid JSON"}.`);
  }
}

/**
 * Composes one A2A `Message`: a text / Markdown / structured-data part, any
 * number of file parts, and the per-send `SendMessageConfiguration`.
 */
export function MessageComposer({
  placeholder,
  submitLabel,
  submitIcon,
  sending,
  sendingLabel = "Sending…",
  disabled,
  inputModes,
  referenceableTasks = [],
  minRows = "md",
  onSubmit,
}: MessageComposerProps) {
  const [format, setFormat] = useState<ComposerFormat>("plain");
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<BinaryAttachment[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [returnImmediately, setReturnImmediately] = useState(false);
  const [historyLength, setHistoryLength] = useState("");
  const [outputModes, setOutputModes] = useState("");
  const [referenceIds, setReferenceIds] = useState<string[]>([]);
  const [messageMetadata, setMessageMetadata] = useState("");
  const [requestMetadata, setRequestMetadata] = useState("");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const definition = composerFormatDefinition(format);

  const unsupported = inputModes?.length
    ? [definition.mediaType, ...attachments.map((file) => file.mediaType || "application/octet-stream")].filter(
        (mediaType) => !mediaTypeIsAdvertised(mediaType, inputModes),
      )
    : [];

  async function addFiles(files: FileList | null) {
    if (!files?.length) return;
    try {
      const next = await Promise.all(
        [...files].map(async (file) => ({ name: file.name, mediaType: file.type, raw: await toBase64(file) })),
      );
      setAttachments((current) => [...current, ...next]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read the file.");
    }
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit() {
    setError(null);
    try {
      const parts = buildComposerParts(value, format, attachments);
      if (!parts.length) return;
      const config: SendConfig = {};
      if (returnImmediately) config.returnImmediately = true;
      if (historyLength.trim()) {
        const parsed = Number(historyLength);
        if (!Number.isInteger(parsed) || parsed < 0) throw new Error("History length must be a whole number, 0 or more.");
        config.historyLength = parsed;
      }
      const modes = outputModes.split(",").map((mode) => mode.trim()).filter(Boolean);
      if (modes.length) config.acceptedOutputModes = modes;
      if (referenceIds.length) config.referenceTaskIds = referenceIds;
      config.metadata = parseJsonObject(messageMetadata, "Message metadata");
      config.requestMetadata = parseJsonObject(requestMetadata, "Request metadata");
      await onSubmit({ parts, config });
      setValue("");
      setAttachments([]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not build the message.");
    }
  }

  const canSubmit = !sending && !disabled && (value.trim().length > 0 || attachments.length > 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1" role="tablist" aria-label="Part type">
        {COMPOSER_FORMATS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={format === option.id}
            onClick={() => setFormat(option.id)}
            className={cn(
              "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              format === option.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
        <span className="text-muted-foreground ml-auto font-mono text-[11px]">
          {definition.partKind === "data" ? "data part" : "text part"} · {definition.mediaType}
        </span>
      </div>

      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSubmit) void submit();
        }}
        placeholder={format === "plain" ? placeholder : definition.placeholder}
        disabled={sending || disabled}
        className={cn(minRows === "md" ? "min-h-28" : "min-h-20", format === "json" && "font-mono text-xs")}
      />

      {attachments.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {attachments.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="border-border bg-muted/50 flex items-center gap-1.5 rounded-md border py-1 pr-1 pl-2 text-xs"
            >
              <Paperclip className="size-3" />
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-muted-foreground font-mono text-[10px]">{file.mediaType || "binary"}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                onClick={() => setAttachments((current) => current.filter((_, at) => at !== index))}
                className="text-muted-foreground hover:text-foreground rounded p-0.5"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {unsupported.length > 0 && (
        <p className="text-warning text-xs">
          This agent doesn&apos;t advertise {[...new Set(unsupported)].join(", ")} in its input modes; it may reject the message.
        </p>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowAdvanced((open) => !open)}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium"
          aria-expanded={showAdvanced}
        >
          <ChevronDown className={cn("size-3.5 transition-transform", !showAdvanced && "-rotate-90")} />
          Request options
        </button>
        {showAdvanced && (
          <div className="border-border mt-2 grid gap-3 rounded-lg border p-3 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                checked={returnImmediately}
                onChange={(event) => setReturnImmediately(event.target.checked)}
                className="accent-primary mt-0.5"
              />
              <span>
                <span className="font-medium">Return immediately</span>
                <span className="text-muted-foreground block">
                  Get the Task back as soon as it&apos;s created instead of waiting for it to finish or need input.
                </span>
              </span>
            </label>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="history-length" className="text-xs">History length</Label>
              <Input
                id="history-length"
                inputMode="numeric"
                placeholder="unset (no limit)"
                value={historyLength}
                onChange={(event) => setHistoryLength(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="output-modes" className="text-xs">Accepted output modes</Label>
              <Input
                id="output-modes"
                placeholder="default: text, json, images, files"
                value={outputModes}
                onChange={(event) => setOutputModes(event.target.value)}
              />
            </div>
            {referenceableTasks.length > 0 && (
              <fieldset className="flex flex-col gap-1.5 sm:col-span-2">
                <legend className="mb-1.5 text-xs font-medium">Reference other tasks</legend>
                <div className="flex flex-wrap gap-1.5">
                  {referenceableTasks.map((task) => {
                    const on = referenceIds.includes(task.taskId);
                    return (
                      <button
                        key={task.taskId}
                        type="button"
                        aria-pressed={on}
                        onClick={() =>
                          setReferenceIds((current) => (on ? current.filter((id) => id !== task.taskId) : [...current, task.taskId]))
                        }
                        className={cn(
                          "rounded-md border px-2 py-1 text-[11px] transition-colors",
                          on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {task.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="message-metadata" className="text-xs">Message metadata (JSON)</Label>
              <Textarea
                id="message-metadata"
                className="min-h-14 font-mono text-xs"
                placeholder='{"source": "web-chat", "locale": "en-IN"}'
                value={messageMetadata}
                onChange={(event) => setMessageMetadata(event.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="request-metadata" className="text-xs">Request metadata (JSON)</Label>
              <Textarea
                id="request-metadata"
                className="min-h-14 font-mono text-xs"
                placeholder='{"traceId": "trace-789"}'
                value={requestMetadata}
                onChange={(event) => setRequestMetadata(event.target.value)}
              />
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-destructive text-xs">{error}</p>}

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <input ref={fileInput} type="file" multiple hidden onChange={(event) => void addFiles(event.target.files)} />
          <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} disabled={sending || disabled}>
            <Paperclip />
            Attach
          </Button>
          <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
            {sending && (
              <>
                <Loader2 className="size-3.5 animate-spin" /> {sendingLabel}
              </>
            )}
          </span>
        </div>
        <Button onClick={() => void submit()} disabled={!canSubmit}>
          {submitIcon ?? <Send />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
