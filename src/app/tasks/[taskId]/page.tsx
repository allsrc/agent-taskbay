"use client";

import { useRef, useState, use } from "react";
import { Loader2, Send, Workflow } from "lucide-react";
import { sendAndStream } from "@/lib/client-stream";
import { assembleArtifacts, assembleTasks, extractMessages, normalizeParts } from "@/lib/content";
import { taskBucket, useTaskStore, type ThreadMessage } from "@/store/task-store";
import { PartRenderer } from "@/components/PartRenderer";
import { ArtifactGallery } from "@/components/ArtifactGallery";

export default function TaskDetailPage({ params }: { params: Promise<{ taskId: string }> }) {
  const { taskId } = use(params);
  const task = useTaskStore((state) => state.tasks[taskId]);
  const patchTask = useTaskStore((state) => state.patchTask);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventsRef = useRef<unknown[]>([]);

  if (!task) {
    return (
      <div className="empty-card">
        <Workflow size={27} />
        <strong>Task not found</strong>
        <p>This task isn&apos;t in this browser&apos;s local state. Open it from the <a href="/inbox">inbox</a> that started it.</p>
      </div>
    );
  }

  const bucket = taskBucket(task.state);
  const needsInput = bucket === "needs-input";

  async function resume() {
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    eventsRef.current = [];
    const userMessage: ThreadMessage = {
      id: crypto.randomUUID(),
      role: "user",
      parts: normalizeParts([{ text: draft, mediaType: "text/plain" }]),
      timestamp: new Date().toISOString(),
    };
    patchTask(taskId, { messages: [...task.messages, userMessage] });
    const text = draft;
    setDraft("");
    try {
      await sendAndStream(task.agentId, { text, taskId: task.taskId, contextId: task.contextId }, {
        onEvent: (event) => {
          eventsRef.current = [...eventsRef.current, event];
          const [updated] = assembleTasks(eventsRef.current);
          if (!updated) return;
          const agentMessages: ThreadMessage[] = extractMessages(updated, { includeStatusMessages: false })
            .filter((message) => message.role !== "ROLE_USER")
            .map((message) => ({
              id: String(message.messageId ?? crypto.randomUUID()),
              role: "agent",
              parts: normalizeParts(message.parts),
              timestamp: new Date().toISOString(),
            }));
          patchTask(taskId, {
            state: (updated.status as { state?: string } | undefined)?.state ?? task.state,
            updatedAt: new Date().toISOString(),
            messages: [...task.messages, userMessage, ...agentMessages],
            artifacts: assembleArtifacts(eventsRef.current),
          });
        },
        onError: (message) => setError(message),
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to send the message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="task-detail-page">
      <header className="conversation-header">
        <div>
          <Workflow size={16} />
          <div>
            <strong>{task.agentName}</strong>
            <span>{task.taskId}</span>
          </div>
        </div>
        <span className={`status-badge ${bucket}`}>{task.state.replace("TASK_STATE_", "").toLowerCase().replaceAll("_", " ")}</span>
      </header>

      <div className="transcript">
        {task.messages.map((message) => (
          <div className={`message-row ${message.role === "user" ? "user" : ""}`} key={message.id}>
            <div className="avatar">{message.role === "user" ? "You" : "AI"}</div>
            <div className="message-body">
              <div className="message-parts">
                {message.parts.map((part, index) => <PartRenderer key={`${message.id}-${index}`} part={part} />)}
              </div>
            </div>
          </div>
        ))}
        <ArtifactGallery artifacts={task.artifacts} />
      </div>

      <section className="composer">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={needsInput ? "The agent is waiting on your input…" : "Send a follow-up message…"}
          disabled={sending}
        />
        <div className="composer-actions">
          <div>{sending && <span className="part-summary"><Loader2 className="spin" size={12} /> Sending…</span>}</div>
          <button className="button primary" onClick={resume} disabled={sending || !draft.trim()}>
            <Send size={14} />Send
          </button>
        </div>
      </section>
      {error && <div className="error-banner"><span>{error}</span></div>}
    </section>
  );
}
