"use client";

import { useSyncExternalStore } from "react";
import { findConversation, groupConversations } from "@/lib/conversations";
import { useTaskStore } from "@/store/task-store";

const subscribe = (notify: () => void) => useTaskStore.persist?.onFinishHydration(notify) ?? (() => undefined);
const hasHydrated = () => useTaskStore.persist?.hasHydrated() ?? true;

/** Tracked tasks live in persisted browser storage, so wait for hydration before declaring a conversation missing. */
export function useHasConversation(key: string): boolean | undefined {
  const exists = useTaskStore((state) => Boolean(findConversation(groupConversations(Object.values(state.tasks)), key)));
  const hydrated = useSyncExternalStore(subscribe, hasHydrated, () => false);
  return exists ? true : hydrated ? false : undefined;
}
