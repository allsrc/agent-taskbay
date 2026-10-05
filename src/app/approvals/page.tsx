import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/a2a/primitives";

export default function ApprovalsIndexPage() {
  return (
    <div className="hidden min-h-0 flex-1 md:flex">
      <EmptyState icon={<ShieldCheck className="size-7" />} title="Select an approval">
        Review the exact action an agent wants to take, then approve, edit, reject or send it back. Approved actions are sent once and tracked to the agent&apos;s result.
      </EmptyState>
    </div>
  );
}
