"use client";

import { use } from "react";
import { ChatView } from "@/components/chat/chat-view";
import { ChatMissing } from "@/components/chat/chat-landing";
import { useHasConversation } from "@/components/chat/use-has-conversation";

export default function ConversationPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const has = useHasConversation(key);
  return has ? <ChatView conversationKey={key} /> : <ChatMissing />;
}
