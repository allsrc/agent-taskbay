"use client";

import { useId, useState } from "react";
import { Maximize2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { JsonTree } from "@/components/JsonTree";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResponsiveDialog } from "@/components/patterns/responsive-dialog";
import { isTabular, parseCsv } from "@/lib/content";
import { profileContent, resolveView, VIEW_LABEL, type ViewMode } from "@/lib/content-view";
import { htmlPreviewDocument, sanitizeHtml } from "@/lib/html-preview";

export function DataTable({ rows }: { rows: Record<string, unknown>[] }) {
  const columns = [...new Set(rows.flatMap(Object.keys))];
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead><tr>{columns.map((column) => <th key={column} className="border-border text-muted-foreground border-b px-2 py-1.5 text-left font-medium">{column}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column} className="border-border border-b px-2 py-1.5 align-top">{typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "")}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function CsvTable({ text }: { text: string }) {
  const rows = parseCsv(text);
  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-xs">
        <thead><tr>{rows[0]?.map((cell, index) => <th key={index} className="border-border border-b px-2 py-1.5 text-left">{cell}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className="border-border border-b px-2 py-1.5 align-top">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function RichHtmlPreview({ text }: { text: string }) {
  return <iframe title="Rich HTML preview" sandbox="" referrerPolicy="no-referrer" srcDoc={htmlPreviewDocument(text)} className="h-[70dvh] min-h-48 w-full border-0 bg-white" />;
}

export function ContentViewer({ text, mediaType = "text/plain", initialMode = "auto", streaming = false }: { text: string; mediaType?: string; initialMode?: ViewMode; streaming?: boolean }) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [previewOpen, setPreviewOpen] = useState(false);
  const id = useId();
  const profile = profileContent(text, mediaType);
  const view = resolveView(profile, mode);
  const selectedMode = mode === "auto" || profile.options.includes(mode) ? mode : "text";
  return (
    <div className="text-foreground min-w-0 max-w-full">
      {view === "markdown" ? (
        <div className="markdown-content break-words"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>{alt ? `Image: ${alt}` : "Remote image omitted"}</span> }}>{text}</ReactMarkdown></div>
      ) : view === "json" ? (
        <div className="overflow-auto">{isTabular(profile.json) ? <DataTable rows={profile.json} /> : <JsonTree value={profile.json} />}</div>
      ) : view === "csv" ? (
        <CsvTable text={text} />
      ) : view === "html" ? (
        <div className="markdown-content break-words" dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />
      ) : (
        <div className="text-sm leading-relaxed break-words whitespace-pre-wrap">{text}{streaming && <span className="text-brand-text animate-caret">▌</span>}</div>
      )}
      <div role="group" aria-label="Content format" className="text-muted-foreground mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 break-all" title={`Sent as ${profile.declared}`}><span className="sr-only">Sent as </span><span className="font-mono text-[11px]">{profile.declared}</span></span>
          {profile.suggestion && <span title={`${profile.detection.confidence} confidence`}>{VIEW_LABEL[profile.suggestion]} suggested</span>}
        </div>
        <div className="flex max-w-full items-center gap-1">
          <label htmlFor={id} className="sr-only">Content view</label>
          <NativeSelect id={id} value={selectedMode} onChange={(event) => setMode(event.target.value as ViewMode)} className="text-foreground h-11 max-w-44 border-transparent pl-2 text-xs sm:h-8 md:text-xs">
            <option value="auto">Auto ({VIEW_LABEL[profile.defaultView]})</option>
            {profile.options.map((option) => <option key={option} value={option}>{option === "html" ? "Sanitized HTML" : VIEW_LABEL[option]}</option>)}
          </NativeSelect>
          {(view === "html" || profile.detection.kind === "html" || profile.declared.split(";")[0].trim().toLowerCase() === "text/html") && (
            <Tooltip>
              <TooltipTrigger render={<Button variant="ghost" size="icon-sm" className="size-11 shrink-0 sm:size-8" aria-label="Rich HTML preview" onClick={() => setPreviewOpen(true)} />}><Maximize2 className="size-4" /></TooltipTrigger>
              <TooltipContent>Rich HTML preview</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
      <ResponsiveDialog open={previewOpen} onOpenChange={setPreviewOpen} title="Rich HTML preview" className="max-h-[90dvh] sm:max-w-5xl">
        <RichHtmlPreview text={text} />
      </ResponsiveDialog>
    </div>
  );
}