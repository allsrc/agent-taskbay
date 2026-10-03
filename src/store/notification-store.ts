"use client";

import { useMemo } from "react";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { deriveNotifications, type AppNotification } from "../lib/notifications";
import { useTaskStore } from "./task-store";

interface ReadState {
  read: Record<string, true>;
  markRead: (ids: string[]) => void;
}

/** Session-only presentation state; durable per-user read state belongs to Phase 4. */
export const useReadStore = create<ReadState>()((set) => ({
  read: {},
  markRead: (ids) => set((state) => ({ read: { ...state.read, ...Object.fromEntries(ids.map((id) => [id, true as const])) } })),
}));

export function useNotifications(): { items: Array<AppNotification & { unread: boolean }>; unread: number } {
  const tasks = useTaskStore(useShallow((state) => Object.values(state.tasks)));
  const read = useReadStore((state) => state.read);
  return useMemo(() => {
    const items = deriveNotifications(tasks).map((item) => ({ ...item, unread: !read[item.id] }));
    return { items, unread: items.filter((item) => item.unread).length };
  }, [tasks, read]);
}
