"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

export function RemoveAgentButton({ agentId, agentName }: { agentId: string; agentName: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  async function handleRemove() {
    if (!window.confirm(`Remove "${agentName}" from the catalog?`)) return;
    setPending(true);
    try {
      const response = await fetch(`/api/agents/${agentId}`, { method: "DELETE" });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to remove agent.");
      toast.success("Agent removed", { description: agentName });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove agent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="text-muted-foreground hover:text-destructive size-7"
      aria-label={`Remove ${agentName}`}
      onClick={handleRemove}
      disabled={pending}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Trash2 />}
    </Button>
  );
}
