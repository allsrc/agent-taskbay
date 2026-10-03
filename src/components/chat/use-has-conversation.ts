"use client";

import { findConversation, groupConversations } from "@/lib/conversations";
import { useTaskStore } from "@/store/task-store";

/** Only a successful server read can establish that a conversation is missing. */
export function useHasConversation(key: string): boolean | undefined {
  return useTaskStore((state) => {
    const exists = Boolean(findConversation(groupConversations(Object.values(state.tasks)), key));
    return exists ? true : state.loaded ? false : undefined;
  });
}
