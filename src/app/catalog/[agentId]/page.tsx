"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MessageSquare } from "lucide-react";
import { runSend, userThreadMessage } from "@/lib/run-message";
import { useTaskStore } from "@/store/task-store";
import { MessageComposer, type ComposerSubmit } from "@/components/MessageComposer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";

interface AgentDetail {
  id: string;
  cardUrl: string;
  card: {
    name?: string;
    description?: string;
    skills?: Array<{ id: string; name: string; description: string; tags: string[] }>;
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    capabilities?: { streaming?: boolean; pushNotifications?: boolean };
  };
}

export default function AgentDetailPage({ params }: { params: Promise<{ agentId: string }> }) {
  const { agentId } = use(params);
  const router = useRouter();
  const upsertTask = useTaskStore((state) => state.upsertTask);
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/agents/${agentId}`)
      .then((response) => {
        if (!response.ok) return response.json().then((body) => { throw new Error(body?.error?.message ?? "Agent discovery failed."); });
        return response.json();
      })
      .then(setAgent)
      .catch((error: Error) => setLoadError(error.message));
  }, [agentId]);

  /** Sends the first message. The agent decides whether to answer directly (Message) or open a Task. */
  async function startTask({ parts, config }: ComposerSubmit) {
    if (sending) return;
    setSending(true);
    setSendError(null);
    const userMessage = userThreadMessage(parts, {}, config);
    let landedOn: string | undefined;
    try {
      await runSend(
        { agentId, agentName: agent?.card.name ?? agentId, parts, config, userMessage },
        {
          onUpdate: (next) => {
            landedOn = next.taskId;
            upsertTask(next);
          },
          onError: setSendError,
        },
      );
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "Failed to start the task.");
    } finally {
      setSending(false);
      if (landedOn) router.push(`/tasks/${landedOn}`);
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
            <div className="mt-3 flex flex-wrap gap-1.5">
              {agent.card.capabilities?.streaming && <Badge variant="secondary">streaming</Badge>}
              {agent.card.capabilities?.pushNotifications && <Badge variant="secondary">push notifications</Badge>}
              {agent.card.defaultInputModes?.map((mode) => (
                <Badge key={`in-${mode}`} variant="outline">in · {mode}</Badge>
              ))}
              {agent.card.defaultOutputModes?.map((mode) => (
                <Badge key={`out-${mode}`} variant="outline">out · {mode}</Badge>
              ))}
            </div>
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
          <MessageComposer
            placeholder="Describe what you need this agent to do…"
            submitLabel="Send"
            sending={sending}
            sendingLabel="Sending…"
            inputModes={agent.card.defaultInputModes}
            onSubmit={startTask}
          />
          <p className="text-muted-foreground flex items-start gap-1.5 border-t pt-3 text-xs">
            <MessageSquare className="mt-0.5 size-3.5 shrink-0" />
            <span>
              The agent decides how to answer: a plain <strong>Message</strong> for simple questions, or a tracked{" "}
              <strong>Task</strong> (with status, input requests and artifacts) for real work.
            </span>
          </p>
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
