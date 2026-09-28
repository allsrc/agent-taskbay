"use client";

import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { sendAndStream } from "@/lib/client-stream";
import { assembleArtifacts, assembleTasks, extractMessages, normalizeParts } from "@/lib/content";
import { useTaskStore, type ThreadMessage } from "@/store/task-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface AgentDetail {
  id: string;
  cardUrl: string;
  card: { name?: string; description?: string; skills?: Array<{ id: string; name: string; description: string; tags: string[] }> };
}

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const router = useRouter();
  const upsertTask = useTaskStore((state) => state.upsertTask);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const eventsRef = useRef<unknown[]>([]);

  useEffect(() => {
    fetch(`/api/agents/${agentId}`)
      .then((response) => {
        if (!response.ok) return response.json().then((body) => { throw new Error(body?.error?.message ?? "Agent discovery failed."); });
        return response.json();
      })
      .then(setAgent)
      .catch((error: Error) => setLoadError(error.message));
  }, [agentId]);

  async function startTask() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setSendError(null);
    eventsRef.current = [];
    const userMessage: ThreadMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: normalizeParts([{ text: draft, mediaType: "text/plain" }]),
      timestamp: new Date().toISOString(),
    };
    const text = draft;
    setDraft("");
    let taskId: string | undefined;
    try {
      await sendAndStream(agentId, { text }, {
        onEvent: (event) => {
          eventsRef.current = [...eventsRef.current, event];
          const [task] = assembleTasks(eventsRef.current);
          if (!task) return;
          taskId = String(task.id);
          const agentMessages: ThreadMessage[] = extractMessages(task, { includeStatusMessages: false })
            .filter((message) => message.role !== "ROLE_USER")
            .map((message) => ({
              id: String(message.messageId ?? crypto.randomUUID()),
              role: "agent",
              parts: normalizeParts(message.parts),
              timestamp: new Date().toISOString(),
            }));
          upsertTask({
            taskId,
            agentId,
            agentName: agent?.card.name ?? agentId,
            contextId: typeof task.contextId === "string" ? task.contextId : undefined,
            state: (task.status as { state?: string } | undefined)?.state ?? "TASK_STATE_UNSPECIFIED",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            messages: [userMessage, ...agentMessages],
            artifacts: assembleArtifacts(eventsRef.current),
          });
        },
        onError: (message) => setSendError(message),
      });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to start the task.");
    } finally {
      setSending(false);
      if (taskId) router.push(`/tasks/${taskId}`);
    }
  }

  if (loadError) {
    return (
      <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
        {loadError}
      </div>
    );
  }
  if (!agent) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 py-16 text-sm">
        <Loader2 className="size-4 animate-spin" /> Loading agent…
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <Card className="bg-gradient-to-br from-card to-muted/40">
        <CardContent className="flex items-start gap-4">
          <div className="bg-primary text-primary-foreground flex size-12 shrink-0 items-center justify-center rounded-2xl text-lg font-bold">
            {(agent.card.name ?? "A").slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{agent.card.name ?? agent.id}</h1>
            <p className="text-muted-foreground mt-1 text-sm">{agent.card.description}</p>
          </div>
        </CardContent>
      </Card>

      {!!agent.card.skills?.length && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <h2 className="font-semibold">Skills</h2>
            <Badge variant="secondary">{agent.card.skills.length}</Badge>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {agent.card.skills.map((skill) => (
                <div key={skill.id} className="border-border rounded-xl border p-3.5">
                  <h3 className="text-sm font-semibold">{skill.name}</h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">{skill.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Describe what you need this agent to do…"
            disabled={sending}
            className="min-h-28"
          />
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
              {sending && (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Starting…
                </>
              )}
            </span>
            <Button onClick={startTask} disabled={sending || !draft.trim()}>
              <Send />
              Start task
            </Button>
          </div>
        </CardContent>
      </Card>
      {sendError && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-lg border px-4 py-3 text-sm">
          {sendError}
        </div>
      )}
    </section>
  );
}
