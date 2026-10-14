"use client";

import { useState } from "react";
import { Ellipsis, Maximize2, Pilcrow, WandSparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { JsonTree } from "@/components/JsonTree";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResponsiveDialog } from "@/components/patterns/responsive-dialog";
import { isTabular, parseCsv } from "@/lib/content";
import { formattedView, profileContent, resolveView, VIEW_LABEL, type ContentProfile, type ViewKind, type ViewMode } from "@/lib/content-view";
import { htmlPreviewDocument, sanitizeHtml } from "@/lib/html-preview";
import { cn } from "@/lib/utils";

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
        <thead><tr>{rows[0]?.map((cell, index) => <th key={index} className="border-border text-muted-foreground border-b px-2 py-1.5 text-left font-medium">{cell}</th>)}</tr></thead>
        <tbody>{rows.slice(1).map((row, index) => <tr key={index}>{row.map((cell, column) => <td key={column} className="border-border border-b px-2 py-1.5 align-top">{cell}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function RichHtmlPreview({ text }: { text: string }) {
  return <iframe title="Rich HTML preview" sandbox="" referrerPolicy="no-referrer" srcDoc={htmlPreviewDocument(text)} className="h-[70dvh] min-h-48 w-full rounded-lg border-0 bg-white" />;
}

const MENU_LABEL: Record<ViewKind, string> = { ...VIEW_LABEL, html: "Sanitized HTML" };

function ContentBody({ text, view, profile, streaming }: { text: string; view: ViewKind; profile: ContentProfile; streaming: boolean }) {
  const caret = streaming && <span className="text-brand-text animate-caret">▌</span>;
  if (view === "markdown") {
    return (
      <div className="markdown-content break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ img: ({ alt }) => <span>{alt ? `Image: ${alt}` : "Remote image omitted"}</span> }}>{text}</ReactMarkdown>
        {caret}
      </div>
    );
  }
  if (view === "json") return <div className="overflow-auto">{isTabular(profile.json) ? <DataTable rows={profile.json} /> : <JsonTree value={profile.json} />}</div>;
  if (view === "csv") return <CsvTable text={text} />;
  if (view === "html") return <div className="markdown-content break-words" dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />;
  // HTML shown as text is source code: keep it contained instead of letting markup fill the conversation.
  if (profile.html) return <pre className="bg-muted/40 max-h-48 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">{text}{caret}</pre>;
  return <div className="break-words whitespace-pre-wrap">{text}{caret}</div>;
}

/**
 * Text from a message, status update or result. It is shown as its sender declared it (an agent's plain text that reads as
 * Markdown is formatted), and the person can view it another way. Controls appear only when there is another useful
 * view, so ordinary sentences carry no chrome. Choices live in component state: they never change the stored content,
 * its media type, or what is sent to an agent. HTML is only ever rendered sanitized, on request.
 */
export function ContentViewer({
  text,
  mediaType = "text/plain",
  initialMode = "auto",
  streaming = false,
  controls = true,
  align = "start",
  inferMarkdown = true,
}: {
  text: string;
  mediaType?: string;
  initialMode?: ViewMode;
  streaming?: boolean;
  /** False hides every control, for compact logs where the text is secondary. */
  controls?: boolean;
  /** Which side the controls sit on; a sent message aligns them with its bubble. */
  align?: "start" | "end";
  /** Format plain text that reads as Markdown. Off for a person's own messages, which follow the type they chose. */
  inferMarkdown?: boolean;
}) {
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const [previewOpen, setPreviewOpen] = useState(false);
  const profile = profileContent(text, mediaType, { inferMarkdown });
  const view = resolveView(profile, mode);
  const selectedMode = mode === "auto" || profile.options.includes(mode) ? mode : "text";
  const formatted = formattedView(profile);
  const showControls = controls && !streaming && (formatted !== null || profile.html || view !== profile.defaultView);
  return (
    <div className="min-w-0 max-w-full">
      <ContentBody text={text} view={view} profile={profile} streaming={streaming} />
      {showControls && (
        <div role="group" aria-label="Content format" className={cn("-mx-1.5 mt-1 flex items-center gap-0.5", align === "end" && "justify-end")}>
          {formatted && (view === "text" ? (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setMode(formatted)} title={`Looks like ${VIEW_LABEL[formatted]} (${profile.detection.confidence} confidence)`}>
              <WandSparkles /> Format as {VIEW_LABEL[formatted]}
            </Button>
          ) : (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setMode("text")}>
              <Pilcrow /> Plain text
            </Button>
          ))}
          {profile.html && (
            <Button variant="ghost" size="xs" className="text-muted-foreground" onClick={() => setPreviewOpen(true)}>
              <Maximize2 /> Preview HTML
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label="Content view" />}>
              <Ellipsis />
            </DropdownMenuTrigger>
            <DropdownMenuContent align={align} className="w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  Sent as <span className="font-mono">{profile.declared}</span>
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup value={selectedMode} onValueChange={(value) => setMode(value as ViewMode)}>
                  <DropdownMenuRadioItem value="auto">Auto ({VIEW_LABEL[profile.defaultView]})</DropdownMenuRadioItem>
                  {profile.options.map((option) => (
                    <DropdownMenuRadioItem key={option} value={option}>
                      {MENU_LABEL[option]}
                      {option === profile.suggestion && <span className="text-muted-foreground ml-auto text-[11px]">suggested</span>}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              {profile.html && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setPreviewOpen(true)}>
                    <Maximize2 /> Rich HTML preview
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {profile.html && (
        <ResponsiveDialog open={previewOpen} onOpenChange={setPreviewOpen} title="Rich HTML preview" description="Sanitized and isolated: scripts, links and remote resources are blocked." className="max-h-[90dvh] sm:max-w-5xl">
          <RichHtmlPreview text={text} />
        </ResponsiveDialog>
      )}
    </div>
  );
}
