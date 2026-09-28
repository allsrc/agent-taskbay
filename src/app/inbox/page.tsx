"use client";

import Link from "next/link";
import { CheckCircle2, CircleAlert, Inbox as InboxIcon, LoaderCircle, UserRound } from "lucide-react";
import { taskBucket, useTaskStore, type TaskBucket } from "@/store/task-store";

const SECTIONS: Array<{ bucket: TaskBucket; label: string; icon: typeof InboxIcon }> = [
  { bucket: "needs-input", label: "Needs my input", icon: UserRound },
  { bucket: "in-progress", label: "In progress", icon: LoaderCircle },
  { bucket: "completed", label: "Completed", icon: CheckCircle2 },
  { bucket: "failed", label: "Failed / canceled", icon: CircleAlert },
];

export default function InboxPage() {
  const tasks = useTaskStore((state) => Object.values(state.tasks));
  const sorted = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <section className="inbox-page">
      <header className="section-heading">
        <div>
          <h1>Task inbox</h1>
          <p>Tasks you started, grouped by what needs to happen next. This is browser-local state until a shared, durable task store is wired up (see README).</p>
        </div>
      </header>
      {!sorted.length ? (
        <div className="empty-card">
          <InboxIcon size={27} />
          <strong>No tasks yet</strong>
          <p>Open the <Link href="/catalog">catalog</Link> and start a task with a registered agent.</p>
        </div>
      ) : (
        SECTIONS.map(({ bucket, label, icon: Icon }) => {
          const items = sorted.filter((task) => taskBucket(task.state) === bucket);
          if (!items.length) return null;
          return (
            <section className="inbox-section" key={bucket}>
              <h2><Icon size={16} />{label}<span className="count-pill">{items.length}</span></h2>
              <div className="inbox-list">
                {items.map((task) => (
                  <Link className="inbox-row" href={`/tasks/${task.taskId}`} key={task.taskId}>
                    <div>
                      <strong>{task.agentName}</strong>
                      <span>{task.messages.at(-1)?.parts[0]?.value ? String(task.messages.at(-1)?.parts[0]?.value).slice(0, 140) : "No preview available"}</span>
                    </div>
                    <time>{new Date(task.updatedAt).toLocaleString()}</time>
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </section>
  );
}
