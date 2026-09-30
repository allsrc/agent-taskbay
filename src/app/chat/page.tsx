import { ChatLanding } from "@/components/chat/chat-landing";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const { agent } = await searchParams;
  return <ChatLanding agentId={agent} />;
}
