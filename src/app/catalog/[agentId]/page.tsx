"use client";

import { useEffect, useRef, useState, use } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { sendAndStream } from "@/lib/client-stream";
import { assembleArtifacts, assembleTasks, extractMessages, normalizeParts } from "@/lib/content";
import { useTaskStore, type ThreadMessage } from "@/store/task-store";

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

  if (loadError) return <div className="error-banner"><span>{loadError}</span></div>;
  if (!agent) return <div className="empty-card"><Loader2 className="spin" size={24} /><strong>Loading agent…</strong></div>;

  return (
    <section className="agent-detail-page">
      <header className="agent-hero">
        <div className="agent-icon">{(agent.card.name ?? "A").slice(0, 2).toUpperCase()}</div>
        <div>
          <h1>{agent.card.name ?? agent.id}</h1>
          <p>{agent.card.description}</p>
        </div>
      </header>

      {!!agent.card.skills?.length && (
        <section className="skills-section">
          <header><div><strong>Skills</strong></div><span>{agent.card.skills.length}</span></header>
          <div className="skills-grid">
            {agent.card.skills.map((skill) => (
              <article key={skill.id}>
                <h3>{skill.name}</h3>
                <p>{skill.description}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Describe what you need this agent to do…"
          disabled={sending}
        />
        <div className="composer-actions">
          <div>{sending && <span className="part-summary"><Loader2 className="spin" size={12} /> Starting…</span>}</div>
          <button className="button primary" onClick={startTask} disabled={sending || !draft.trim()}>
            <Send size={14} />Start task
          </button>
        </div>
      </section>
      {sendError && <div className="error-banner"><span>{sendError}</span></div>}
    </section>
  );
}
