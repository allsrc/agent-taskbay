"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import { deriveNotifications, type AppNotification } from "@/lib/notifications";
import { useTaskStore } from "@/store/task-store";

interface ReadState {
  read: Record<string, true>;
  markRead: (ids: string[]) => void;
}

export const useReadStore = create<ReadState>()(
  persist(
    (set) => ({
      read: {},
      markRead: (ids) => set((state) => ({ read: { ...state.read, ...Object.fromEntries(ids.map((id) => [id, true as const])) } })),
    }),
    { name: "a2a-agent-workflow-ui.notifications" },
  ),
);

export function useNotifications(): { items: Array<AppNotification & { unread: boolean }>; unread: number } {
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const read = useReadStore((state) => state.read);
  return useMemo(() => {
    const items = deriveNotifications(tasks).map((item) => ({ ...item, unread: !read[item.id] }));
    return { items, unread: items.filter((item) => item.unread).length };
  }, [tasks, read]);
}
