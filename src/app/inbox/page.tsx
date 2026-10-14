import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/a2a/primitives";

export default function InboxIndexPage() {
  return (
    <EmptyState icon={Inbox} title="Select an item">
      Tasks and approvals you are allowed to see appear in one list. Open an item to review it, decide, or take ownership.
    </EmptyState>
  );
}
