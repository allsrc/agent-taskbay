import { LayoutGrid } from "lucide-react";
import { EmptyState } from "@/components/a2a/primitives";

export default function AgentsIndex() {
  return (
    <EmptyState icon={LayoutGrid} title="Pick an agent">
      See its Agent Card — capabilities, interfaces, skills and security — then start a chat.
    </EmptyState>
  );
}
