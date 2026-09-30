"use client";

import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { EmptyState, StateChip } from "@/components/a2a/primitives";
import { Button } from "@/components/ui/button";
import { relativeTime } from "@/lib/task-view";
import { useNotifications, useReadStore } from "@/store/notification-store";
import { cn } from "@/lib/utils";

export default function NotificationsPage() {
  const router = useRouter();
  const { items, unread } = useNotifications();
  const markRead = useReadStore((state) => state.markRead);

  return (
    <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
      <div className="flex items-center gap-2.5">
        <h1 className="flex-1 font-mono text-lg font-bold tracking-tight">Notifications</h1>
        <Button variant="outline" size="sm" disabled={unread === 0} onClick={() => markRead(items.map((item) => item.id))}>
          Mark all read
        </Button>
      </div>

      <div className="bg-card border-border my-3.5 flex flex-wrap items-center gap-2.5 rounded-xl border p-3.5">
        <span className="bg-muted-foreground size-2 rounded-full" />
        <span className="text-muted-foreground min-w-40 flex-1 font-mono text-xs">
          Push is not configured: updates are read from task streams while this app is open. Webhook delivery needs the Phase 1 receiver.
        </span>
        <span className="bg-secondary border-border rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium">taskPushNotificationConfig</span>
      </div>

      {items.length === 0 ? (
        <EmptyState icon={<Bell className="size-7" />} title="All quiet">
          Input requests, finished tasks and ready artifacts show up here.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-1.5">
          <AnimatePresence initial={false}>
            {items.map((item) => (
              <motion.button
                key={item.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                type="button"
                onClick={() => {
                  markRead([item.id]);
                  router.push(`/tasks/${item.taskId}`);
                }}
                className={cn(
                  "border-border flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                  item.unread ? "bg-card hover:bg-accent/60" : "hover:bg-accent/30",
                )}
              >
                <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.unread ? "bg-brand" : "bg-transparent")} />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{item.title}</div>
                  <div className="text-muted-foreground text-[13px]">{item.body}</div>
                  <div className="text-muted-foreground mt-0.5 font-mono text-[11px]">
                    {item.kind} · {item.taskId.slice(0, 8)} · {relativeTime(item.at)}
                  </div>
                </div>
                <StateChip state={item.state} />
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
