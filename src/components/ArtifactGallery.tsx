"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, PackageOpen } from "lucide-react";
import type { AssembledArtifact } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PartRenderer } from "./PartRenderer";

export function ArtifactGallery({ artifacts, allowRaw = false, richJson = false }: { artifacts: AssembledArtifact[]; allowRaw?: boolean; richJson?: boolean }) {
  const [active, setActive] = useState(0);
  if (!artifacts.length) return null;
  const artifact = artifacts[Math.min(active, artifacts.length - 1)];

  return (
    <section className="border-border bg-card mx-auto w-full max-w-3xl rounded-2xl border p-3">
      <header className="flex items-center gap-2 px-1 pt-1">
        <PackageOpen className="text-primary size-4" />
        <span className="text-sm font-semibold">Artifacts</span>
        <Badge variant="secondary">{artifacts.length}</Badge>
      </header>

      {artifacts.length > 1 && (
        <div className="scrollbar-none -mx-1 mt-2 flex gap-1 overflow-x-auto px-1" role="tablist">
          {artifacts.map((item, index) => (
            <button
              key={item.artifactId}
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={cn(
                "border-b-2 border-transparent px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                index === active ? "border-primary text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item.name || `Artifact ${index + 1}`}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-start justify-between gap-3 px-1 py-3">
        <div className="min-w-0">
          <strong className="text-sm">{artifact.name || "Agent response"}</strong>
          {artifact.description && <p className="text-muted-foreground mt-0.5 text-xs">{artifact.description}</p>}
        </div>
        <span
          className={cn(
            "flex shrink-0 items-center gap-1 text-xs font-medium",
            artifact.complete ? "text-success" : "text-primary",
          )}
        >
          {artifact.complete ? <CheckCircle2 className="size-3.5" /> : <LoaderCircle className="size-3.5 animate-spin" />}
          {artifact.complete ? "Complete" : "Streaming"}
          {artifact.updateCount > 1 ? ` · ${artifact.updateCount} chunks` : ""}
        </span>
      </div>

      <div className="flex flex-col gap-2 px-1 pb-1">
        {artifact.parts.map((part, index) => (
          <PartRenderer key={`${artifact.artifactId}-${part.id}-${index}`} part={part} allowRaw={allowRaw} richJson={richJson} />
        ))}
      </div>
    </section>
  );
}
