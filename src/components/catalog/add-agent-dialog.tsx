"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function AddAgentDialog() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [cardUrl, setCardUrl] = React.useState("");
  const [pending, setPending] = React.useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardUrl }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? "Failed to register agent.");
      toast.success("Agent registered", { description: body.agent?.cardUrl });
      setCardUrl("");
      setOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to register agent.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus />
          Register agent
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Register an agent</DialogTitle>
            <DialogDescription>
              Add an agent to the catalog by its Agent Card URL. We&apos;ll discover it immediately to confirm it&apos;s reachable.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2">
            <Label htmlFor="card-url">Agent Card URL</Label>
            <Input
              id="card-url"
              type="url"
              required
              autoFocus
              placeholder="https://agents.example.com/.well-known/agent-card.json"
              value={cardUrl}
              onChange={(event) => setCardUrl(event.target.value)}
              disabled={pending}
            />
          </div>
          <DialogFooter className="mt-6">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending || !cardUrl.trim()}>
              {pending && <Loader2 className="animate-spin" />}
              Register
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
